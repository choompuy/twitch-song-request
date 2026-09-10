import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getConfig, updateConfig } from './config.js'
import { getSettings, setSettings } from './settings.js'
import { fetchPlaylistSongs } from './youtube/index.js'
import { createFileStore } from './persist.js'
import { Settings, QueueItem, Song, PlayerState, FallbackStateResponse, FallbackTrackView, AppError } from './types.js'

type StateFile = {
  current: QueueItem | null
  queue: QueueItem[]
  settings: Settings
  fallback: {
    sourceTracks: Song[]
    order: string[]
    cursor: number
    playlistId: string | null
    lastRefreshedAt: number | null
  }
}

const DATA_DIR = join(process.cwd(), 'cache')
const STATE_FILE = join(DATA_DIR, 'queue-state.json')
const store = createFileStore(STATE_FILE)

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []
const queueVideoIds = new Set<string>()
const userQueueCounts = new Map<string, number>()

let isPaused = false

let fallbackSourceTracks: Song[] = []
let fallbackOrder: string[] = []
let fallbackCursor = -1
let loadedFallbackPlaylistId: string | null = null
let lastFallbackRefreshAt: number | null = null

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
      userQueueCounts.clear()
      for (const item of data.queue) {
        queue.push(item)
        queueVideoIds.add(item.videoId)
        incUserCount(item.requestedBy)
      }
    }

    if (data.settings) {
      setSettings(data.settings)
    }

    if (data.fallback) {
      fallbackSourceTracks = data.fallback.sourceTracks ?? []
      fallbackOrder = data.fallback.order ?? []
      fallbackCursor = data.fallback.cursor ?? -1
      loadedFallbackPlaylistId = data.fallback.playlistId ?? null
      lastFallbackRefreshAt = data.fallback.lastRefreshedAt ?? null
    }

    log('State loaded from disk')
  } catch (error) {
    console.error('[QUEUE] Failed to load state:', error instanceof Error ? error.message : error)
  }
}

function stateSnapshot(): StateFile {
  return {
    current: currentSong,
    queue: [...queue],
    settings: getSettings(),
    fallback: {
      sourceTracks: fallbackSourceTracks,
      order: fallbackOrder,
      cursor: fallbackCursor,
      playlistId: loadedFallbackPlaylistId,
      lastRefreshedAt: lastFallbackRefreshAt
    }
  }
}

function saveState(): void {
  store.scheduleSave(stateSnapshot, (error) => {
    console.error('[QUEUE] Failed to save state:', error instanceof Error ? error.message : error)
  })
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
    saveState()
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
  saveState()
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
  saveState()
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
        return { ...track, isPlayed: index < fallbackCursor }
      })
      .filter((track): track is FallbackTrackView => track !== null)
  }
}

export function getNextTrack(): QueueItem | null {
  const queued = queue[0]

  if (queued) {
    return queued
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

  return { ...upcoming, requestedBy: 'Jam', isFallback: true }
}

function toFallbackQueueItem(song: Song): QueueItem {
  return {
    ...song,
    requestedBy: 'Jam',
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
      fallbackCursor = fallbackOrder.length
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

function incUserCount(requestedBy: string): void {
  const key = requestedBy.toLowerCase()
  userQueueCounts.set(key, (userQueueCounts.get(key) ?? 0) + 1)
}

function decUserCount(requestedBy: string): void {
  const key = requestedBy.toLowerCase()
  const count = (userQueueCounts.get(key) ?? 0) - 1
  if (count > 0) {
    userQueueCounts.set(key, count)
  } else {
    userQueueCounts.delete(key)
  }
}

function getUserActiveCount(username: string): number {
  return userQueueCounts.get(username.toLowerCase()) ?? 0
}

export function getState(): PlayerState & { nextTrack: QueueItem | null } {
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

function assertCanAddSong(song: Song, requestedBy: string, addToQueue: boolean): void {
  const config = getConfig()
  const normalized = requestedBy.toLowerCase()

  if (currentSong?.videoId === song.videoId && !currentSong.isFallback) {
    throw new AppError('DUPLICATE', 'этот трек уже находится в очереди')
  }

  if (queueVideoIds.has(song.videoId)) {
    throw new AppError('DUPLICATE', 'этот трек уже находится в очереди')
  }

  if (addToQueue && queue.length >= config.maxQueueSize) {
    throw new AppError('QUEUE_FULL', 'очередь заполнена')
  }

  const activeCount = getUserActiveCount(normalized)
  if (config.maxRequestsPerUser > 0 && activeCount >= config.maxRequestsPerUser) {
    throw new AppError(
      'USER_LIMIT',
      `вы можете заказать только ${config.maxRequestsPerUser} трек${config.maxRequestsPerUser > 1 ? 'а' : ''} одновременно`
    )
  }
}

export function addSong(song: Song, requestedBy: string, addToQueue: boolean = true): QueueItem {
  log(`[REQUEST] ${requestedBy} → "${song.title}"`)

  assertCanAddSong(song, requestedBy, addToQueue)

  const item: QueueItem = {
    ...song,
    requestedBy
  }

  if (addToQueue) {
    queue.push(item)
    queueVideoIds.add(item.videoId)
    incUserCount(requestedBy)
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
    decUserCount(next.requestedBy)
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
    decUserCount(item.requestedBy)
    log(`[QUEUE] removed "${item.title}" at position ${index + 1}`)
  }

  saveState()

  return item ?? null
}

export function clearQueue(): QueueItem[] {
  const cleared = [...queue]
  queue.length = 0
  queueVideoIds.clear()
  userQueueCounts.clear()

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
