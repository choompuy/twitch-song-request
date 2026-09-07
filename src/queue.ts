import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getRuntimeConfig } from './runtimeConfig.js'
import type { Song } from './youtube.js'
import { getSettings, setSettings } from './settings.js'
import type { Settings } from './settings.js'
import { fetchPlaylistSongs } from './youtube.js'

export type QueueItem = Song & {
  requestedBy: string
  addedAt: number
  isFallback?: boolean
}

export type PlayerState = {
  current: QueueItem | null
  queue: QueueItem[]
  isPlaying: boolean
  isPaused: boolean
}

type StateFile = {
  current: QueueItem | null
  queue: QueueItem[]
  settings: Settings
}

const DATA_DIR = join(process.cwd(), 'cache')
const STATE_FILE = join(DATA_DIR, 'queue-state.json')

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []

let isPaused = false

let fallbackTracks: Song[] = []
let fallbackIndex = 0
let loadedFallbackPlaylistId: string | null = null
let lastFallbackRefreshAt: number | null = null

const userLastRequestTime = new Map<string, number>()

function log(message: string) {
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

    if (data.queue && Array.isArray(data.queue)) {
      queue.length = 0
      queue.push(...data.queue)
    }

    if (data.settings) {
      setSettings(data.settings)
    }

    log('State loaded from disk')
  } catch (error) {
    console.error('[QUEUE] Failed to load state:', error instanceof Error ? error.message : error)
  }
}

function saveState(): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }

    const state: StateFile = {
      current: currentSong,
      queue: [...queue],
      settings: getSettings()
    }

    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    console.error('[QUEUE] Failed to save state:', error instanceof Error ? error.message : error)
  }
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

export async function refreshFallbackPlaylist(): Promise<void> {
  const playlistId = getRuntimeConfig().fallbackPlaylistId

  if (!playlistId) {
    fallbackTracks = []
    fallbackIndex = 0
    loadedFallbackPlaylistId = null
    lastFallbackRefreshAt = null
    return
  }

  const songs = await fetchPlaylistSongs(playlistId)

  fallbackTracks = songs.map((song) => ({
    ...song,
    requestedBy: 'Jam',
    addedAt: 0,
    isFallback: true
  }))
  fallbackIndex = 0
  loadedFallbackPlaylistId = playlistId
  lastFallbackRefreshAt = Date.now()

  log(`[FALLBACK] Loaded ${fallbackTracks.length} tracks from playlist ${playlistId}`)
}

export function shuffleFallback(): void {
  fallbackTracks = shuffle(fallbackTracks)
  fallbackIndex = 0
  log(`[FALLBACK] Shuffled ${fallbackTracks.length} tracks`)
}

export function getFallbackState() {
  return {
    playlistId: loadedFallbackPlaylistId,
    lastRefreshedAt: lastFallbackRefreshAt,
    nextIndex: fallbackIndex,
    tracks: fallbackTracks.map((track) => ({
      videoId: track.videoId,
      title: track.title,
      channelTitle: track.channelTitle,
      thumbnail: track.thumbnail,
      duration: track.duration
    }))
  }
}

function nextFallbackTrack(): QueueItem | null {
  if (!fallbackTracks.length) return null

  if (fallbackIndex >= fallbackTracks.length) {
    fallbackTracks = shuffle(fallbackTracks)
    fallbackIndex = 0
  }

  const song = fallbackTracks[fallbackIndex++]
  return {
    ...song,
    requestedBy: 'Jam',
    addedAt: Date.now(),
    isFallback: true
  }
}

function getUserActiveCount(username: string): number {
  const normalized = username.toLowerCase()
  return queue.filter((item) => item.requestedBy.toLowerCase() === normalized).length
}

export function getState(): PlayerState {
  return {
    current: currentSong,
    queue: [...queue],
    isPlaying: currentSong !== null,
    isPaused
  }
}

export function getQueue() {
  return [...queue]
}

export function getCurrent() {
  return currentSong
}

export function setPaused(value: boolean): void {
  isPaused = value
}

export function getIsPaused(): boolean {
  return isPaused
}

export function addSong(song: Song, requestedBy: string, addToQueue: boolean = true): QueueItem {
  const now = Date.now()
  const normalized = requestedBy.toLowerCase()
  const runtimeConfig = getRuntimeConfig()

  log(`[REQUEST] ${requestedBy} → "${song.title}"`)

  const lastRequestTime = userLastRequestTime.get(normalized) ?? 0
  if (runtimeConfig.cooldownSeconds > 0 && lastRequestTime > 0 && now - lastRequestTime < runtimeConfig.cooldownSeconds * 1000) {
    const left = Math.ceil((runtimeConfig.cooldownSeconds * 1000 - (now - lastRequestTime)) / 1000)
    throw new Error(`слишком часто. попробуйте через ${left} сек.`)
  }

  if (currentSong?.videoId === song.videoId && !currentSong.isFallback) {
    throw new Error('этот трек уже находится в очереди')
  }

  if (queue.some((item) => item.videoId === song.videoId)) {
    throw new Error('этот трек уже находится в очереди')
  }

  if (addToQueue && queue.length >= runtimeConfig.maxQueueSize) {
    throw new Error('очередь заполнена')
  }

  const activeCount = getUserActiveCount(requestedBy)
  if (runtimeConfig.maxRequestsPerUser > 0 && activeCount >= runtimeConfig.maxRequestsPerUser) {
    throw new Error(
      `вы можете заказать только ${runtimeConfig.maxRequestsPerUser} трек${runtimeConfig.maxRequestsPerUser > 1 ? 'а' : ''} одновременно`
    )
  }

  userLastRequestTime.set(normalized, now)

  const item: QueueItem = {
    ...song,
    requestedBy,
    addedAt: now
  }

  if (addToQueue) {
    queue.push(item)
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
    setCurrent(next)
    log(`[PLAYER] moved to next: "${next.title}"`)
  } else {
    const fallback = nextFallbackTrack()
    if (fallback) {
      setCurrent(fallback)
      log(`[PLAYER] started fallback: "${fallback.title}"`)
    } else {
      setCurrent(null)
    }
  }

  return next ?? currentSong
}

export function removeAt(index: number): QueueItem | null {
  if (index < 0 || index >= queue.length) {
    return null
  }

  const [item] = queue.splice(index, 1)

  if (item) {
    log(`[QUEUE] removed "${item.title}" at position ${index + 1}`)
  }

  saveState()

  return item ?? null
}

export function clearQueue(): QueueItem[] {
  const cleared = [...queue]
  queue.length = 0

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
