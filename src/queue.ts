import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getConfig, updateConfig } from './config.js'
import { getSettings, setSettings } from './settings.js'
import { fetchPlaylistSongs } from './youtube/index.js'
import { Settings, QueueItem, Song, PlayerState, FallbackStateResponse, FallbackTrackView, NextTrackView } from './types.js'

type StateFile = {
  current: QueueItem | null
  queue: QueueItem[]
  settings: Settings
}

const DATA_DIR = join(process.cwd(), 'cache')
const STATE_FILE = join(DATA_DIR, 'queue-state.json')
const STATE_TMP_FILE = `${STATE_FILE}.tmp`

const SAVE_DEBOUNCE_MS = 250

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []
const queueVideoIds = new Set<string>()

let isPaused = false

let fallbackSourceTracks: Song[] = []
let fallbackOrder: string[] = []
let fallbackCursor = -1
let loadedFallbackPlaylistId: string | null = null
let lastFallbackRefreshAt: number | null = null

const userLastRequestTime = new Map<string, number>()

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()

function log(message: string): void {
  console.log(`[QUEUE] ${message}`)
}

function loadState(): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }

    if (!existsSync(STATE_FILE)) {
      return
    }

    const raw = readFileSync(STATE_FILE, 'utf8')
    const data = JSON.parse(raw) as Partial<StateFile>

    if (data.current) {
      currentSong = data.current
    }

    if (Array.isArray(data.queue)) {
      queue.length = 0
      queueVideoIds.clear()
      for (const item of data.queue) {
        queue.push(item)
        queueVideoIds.add(item.videoId)
      }
    }

    if (data.settings) {
      setSettings(data.settings)
    }

    log('State loaded from disk')
  } catch (error) {
    console.error('[QUEUE] Failed to load state:', error instanceof Error ? error.message : error)
  }
}

async function persistStateNow(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }

  const state: StateFile = {
    current: currentSong,
    queue: [...queue],
    settings: getSettings()
  }

  await writeFile(STATE_TMP_FILE, JSON.stringify(state), 'utf8')
  await rename(STATE_TMP_FILE, STATE_FILE)
}

function saveState(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    saveTimer = null
    saveChain = saveChain.then(persistStateNow).catch((error) => {
      console.error('[QUEUE] Failed to save state:', error instanceof Error ? error.message : error)
    })
  }, SAVE_DEBOUNCE_MS)
}

export async function flushQueueState(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    saveChain = saveChain.then(persistStateNow)
  }
  await saveChain
}

loadState()

function shuffle<T>(items: T[]): T[] {
  const array = [...items]

  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }

  return array
}

function buildOrder(tracks: Song[], shuffleOn: boolean, currentVideoId: string | null): string[] {
  const ids = tracks.map((track) => track.videoId)

  if (!shuffleOn) {
    return ids
  }

  if (!currentVideoId || !ids.includes(currentVideoId)) {
    return shuffle(ids)
  }

  const rest = ids.filter((id) => id !== currentVideoId)
  return [currentVideoId, ...shuffle(rest)]
}

function findTrack(videoId: string): Song | undefined {
  return fallbackSourceTracks.find((track) => track.videoId === videoId)
}

function activeFallbackVideoId(): string | null {
  return fallbackOrder[fallbackCursor] ?? null
}

export async function refreshFallback(): Promise<FallbackStateResponse> {
  const playlistId = getConfig().fallbackPlaylist.playlistId

  if (!playlistId) {
    fallbackSourceTracks = []
    fallbackOrder = []
    fallbackCursor = -1
    loadedFallbackPlaylistId = null
    lastFallbackRefreshAt = null
    return getFallbackState()
  }

  const newTracks = await fetchPlaylistSongs(playlistId)
  const isFirstLoad = loadedFallbackPlaylistId !== playlistId
  const config = getConfig()
  const activeId = activeFallbackVideoId()

  if (isFirstLoad) {
    fallbackSourceTracks = newTracks
    fallbackOrder = buildOrder(newTracks, config.fallbackPlaylist.shuffle, null)
    fallbackCursor = -1
  } else {
    const newIds = new Set(newTracks.map((track) => track.videoId))
    const oldIds = new Set(fallbackSourceTracks.map((track) => track.videoId))

    const addedIds = newTracks.map((track) => track.videoId).filter((id) => !oldIds.has(id))
    const removedCount = fallbackSourceTracks.filter((track) => !newIds.has(track.videoId)).length

    fallbackSourceTracks = newTracks

    const activeIndexBefore = activeId ? fallbackOrder.indexOf(activeId) : -1
    fallbackOrder = fallbackOrder.filter((id) => newIds.has(id))
    fallbackOrder.push(...(config.fallbackPlaylist.shuffle ? shuffle(addedIds) : addedIds))

    if (activeId && newIds.has(activeId)) {
      fallbackCursor = fallbackOrder.indexOf(activeId)
    } else if (activeIndexBefore >= 0) {
      fallbackCursor = Math.min(activeIndexBefore, Math.max(fallbackOrder.length - 1, 0))
    }

    log(`[FALLBACK] Refreshed: +${addedIds.length} added, -${removedCount} removed, ${fallbackOrder.length} in rotation`)
  }

  loadedFallbackPlaylistId = playlistId
  lastFallbackRefreshAt = Date.now()

  log(`[FALLBACK] Loaded ${fallbackSourceTracks.length} tracks from playlist ${playlistId}`)
  return getFallbackState()
}

export function toggleFallbackShuffle(): FallbackStateResponse {
  const config = getConfig()
  const shuffleOn = !config.fallbackPlaylist.shuffle
  updateConfig({ fallbackPlaylist: { ...config.fallbackPlaylist, shuffle: shuffleOn } })

  const activeId = currentSong?.isFallback ? currentSong.videoId : activeFallbackVideoId()
  fallbackOrder = buildOrder(fallbackSourceTracks, shuffleOn, activeId)
  fallbackCursor = activeId ? fallbackOrder.indexOf(activeId) : -1

  log(`[FALLBACK] Shuffle: ${shuffleOn}`)
  return getFallbackState()
}

export function toggleFallbackRepeat(): FallbackStateResponse {
  const config = getConfig()
  const repeat = !config.fallbackPlaylist.repeat
  updateConfig({ fallbackPlaylist: { ...config.fallbackPlaylist, repeat } })
  log(`[FALLBACK] Repeat: ${repeat}`)
  return getFallbackState()
}

export function toggleFallbackEnabled(): FallbackStateResponse {
  const config = getConfig()
  const enabled = !config.fallbackPlaylist.enabled
  updateConfig({ fallbackPlaylist: { ...config.fallbackPlaylist, enabled } })
  log(`[FALLBACK] Enabled: ${enabled}`)
  return getFallbackState()
}

export function getFallbackState(): FallbackStateResponse {
  const config = getConfig()

  return {
    playlistId: loadedFallbackPlaylistId,
    lastRefreshedAt: lastFallbackRefreshAt,
    enabled: config.fallbackPlaylist.enabled,
    shuffle: config.fallbackPlaylist.shuffle,
    repeat: config.fallbackPlaylist.repeat,
    sourceCount: fallbackSourceTracks.length,
    activeVideoId: currentSong?.isFallback ? currentSong.videoId : null,
    upNext: fallbackOrder
      .map((videoId, index) => {
        const track = findTrack(videoId)
        if (!track) return null
        return { ...pickTrackView(track), isPlayed: index < fallbackCursor }
      })
      .filter((track): track is FallbackTrackView => track !== null)
  }
}

function pickTrackView(track: Song): Pick<Song, 'videoId' | 'title' | 'channelTitle' | 'thumbnail' | 'duration'> {
  return {
    videoId: track.videoId,
    title: track.title,
    channelTitle: track.channelTitle,
    thumbnail: track.thumbnail,
    duration: track.duration
  }
}

export function getNextTrack(): NextTrackView | null {
  const queued = queue[0]

  if (queued) {
    return {
      source: 'queue',
      videoId: queued.videoId,
      title: queued.title,
      channelTitle: queued.channelTitle,
      thumbnail: queued.thumbnail,
      requestedBy: queued.requestedBy,
      duration: queued.duration
    }
  }

  const config = getConfig()

  if (!config.fallbackPlaylist.enabled || !fallbackOrder.length) {
    return null
  }

  const nextIndex = fallbackCursor + 1
  const nextId = nextIndex < fallbackOrder.length ? fallbackOrder[nextIndex] : config.fallbackPlaylist.repeat ? fallbackOrder[0] : null

  const upcoming = nextId ? findTrack(nextId) : undefined

  if (!upcoming) {
    return null
  }

  return {
    source: 'fallback',
    videoId: upcoming.videoId,
    title: upcoming.title,
    channelTitle: upcoming.channelTitle,
    thumbnail: upcoming.thumbnail,
    requestedBy: null,
    duration: upcoming.duration
  }
}

function toFallbackQueueItem(song: Song): QueueItem {
  return {
    ...song,
    requestedBy: 'Jam',
    addedAt: Date.now(),
    isFallback: true
  }
}
function nextFallbackTrack(): QueueItem | null {
  const config = getConfig()
  if (!config.fallbackPlaylist.enabled || !fallbackOrder.length) {
    return null
  }

  const nextIndex = fallbackCursor + 1

  if (nextIndex >= fallbackOrder.length) {
    if (!config.fallbackPlaylist.repeat) {
      fallbackCursor = fallbackOrder.length + 1
      return null
    }
    fallbackCursor = 0
  } else {
    fallbackCursor = nextIndex
  }

  const song = findTrack(fallbackOrder[fallbackCursor])

  if (!song) {
    return null
  }

  return toFallbackQueueItem(song)
}

function getUserActiveCount(username: string): number {
  const normalized = username.toLowerCase()
  return queue.filter((item) => item.requestedBy.toLowerCase() === normalized).length
}

export function getState(): PlayerState & { nextTrack: NextTrackView | null } {
  return {
    current: currentSong,
    queue: [...queue],
    isPaused,
    nextTrack: getNextTrack()
  }
}

export function getQueue(): QueueItem[] {
  return [...queue]
}

export function getCurrent(): QueueItem | null {
  return currentSong
}

export function setPaused(value: boolean): void {
  isPaused = value
}

export function getIsPaused(): boolean {
  return isPaused
}

function assertCanAddSong(song: Song, requestedBy: string, addToQueue: boolean, now: number): void {
  const config = getConfig()
  const normalized = requestedBy.toLowerCase()

  if (currentSong?.videoId === song.videoId && !currentSong.isFallback) {
    throw new Error('этот трек уже находится в очереди')
  }

  if (queueVideoIds.has(song.videoId)) {
    throw new Error('этот трек уже находится в очереди')
  }

  if (addToQueue && queue.length >= config.maxQueueSize) {
    throw new Error('очередь заполнена')
  }

  const activeCount = getUserActiveCount(normalized)
  if (config.maxRequestsPerUser > 0 && activeCount >= config.maxRequestsPerUser) {
    throw new Error(`вы можете заказать только ${config.maxRequestsPerUser} трек${config.maxRequestsPerUser > 1 ? 'а' : ''} одновременно`)
  }
}

export function addSong(song: Song, requestedBy: string, addToQueue: boolean = true): QueueItem {
  const now = Date.now()

  log(`[REQUEST] ${requestedBy} → "${song.title}"`)

  assertCanAddSong(song, requestedBy, addToQueue, now)
  userLastRequestTime.set(requestedBy.toLowerCase(), now)

  const item: QueueItem = {
    ...song,
    requestedBy,
    addedAt: now
  }

  if (addToQueue) {
    queue.push(item)
    queueVideoIds.add(item.videoId)
    log(`[QUEUE] added "${song.title}" at position ${queue.length}`)
  } else {
    log(`[QUEUE] "${song.title}" will be set as current (not added to queue)`)
  }

  saveState()

  return item
}

export function setCurrent(item: QueueItem | null): void {
  currentSong = item

  if (item) {
    log(`[PLAYER] started "${item.title}"`)
  } else {
    log(`[PLAYER] stopped`)
  }

  saveState()
}

export function moveToNext(): QueueItem | null {
  const next = queue.shift() ?? null

  if (next) {
    queueVideoIds.delete(next.videoId)
    setCurrent(next)
    log(`[PLAYER] moved to next: "${next.title}"`)
  } else {
    const fallback = nextFallbackTrack()
    setCurrent(fallback)
    if (fallback) {
      log(`[PLAYER] started fallback: "${fallback.title}"`)
    }
  }

  return currentSong
}

export function removeAt(index: number): QueueItem | null {
  if (index < 0 || index >= queue.length) {
    return null
  }

  const [item] = queue.splice(index, 1)

  if (item) {
    queueVideoIds.delete(item.videoId)
    log(`[QUEUE] removed "${item.title}" at position ${index + 1}`)
  }

  saveState()

  return item ?? null
}

export function clearQueue(): QueueItem[] {
  const cleared = [...queue]
  queue.length = 0
  queueVideoIds.clear()

  log(`[QUEUE] cleared ${cleared.length} songs`)

  saveState()

  return cleared
}

export function skipCurrent(): QueueItem | null {
  const skipped = currentSong

  if (skipped) {
    log(`[PLAYER] skipped "${skipped.title}"`)
  }

  return moveToNext()
}
