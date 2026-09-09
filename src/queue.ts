import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getConfig } from './config.js'
import { getSettings, setSettings } from './settings.js'
import { fetchPlaylistSongs } from './youtube/index.js'
import { Settings, QueueItem, Song, PlayerState } from './types.js'

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

let fallbackTracks: Song[] = []
let fallbackIndex = 0
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

/**
 * Дебounced и сериализованная запись состояния. Несколько мутаций подряд
 * (например, серия addSong) схлопываются в одну запись на диск, а сами
 * запуски persistStateNow выстроены в цепочку промисов, чтобы две записи
 * никогда не выполнялись параллельно и не перемешали друг друга на диске.
 */
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

/**
 * Форсирует немедленное выполнение отложенной записи и дожидается её.
 * Вызывайте это из обработчика SIGTERM/SIGINT перед выходом процесса,
 * чтобы изменение очереди, сделанное прямо перед остановкой, не потерялось.
 */
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

export async function refreshFallbackPlaylist(): Promise<void> {
  const playlistId = getConfig().fallbackPlaylistId

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
    isPaused
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

/**
 * Прогоняет все проверки, необходимые перед добавлением трека, и бросает
 * пользовательскую (русскоязычную) ошибку на первой же неудаче. Вынесено
 * из addSong, чтобы основной путь читался как плоская линейная логика.
 */
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
