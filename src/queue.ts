import { config } from './config.js'
import type { Song } from './youtube.js'

export type QueueItem = Song & {
  requestedBy: string
  addedAt: number
}

export type PlayerState = {
  current: QueueItem | null
  queue: QueueItem[]
  isPlaying: boolean
}

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []

function log(message: string) {
  console.log(`[QUEUE] ${message}`)
}

function getUserActiveCount(username: string): number {
  const normalized = username.toLowerCase()
  let count = 0

  if (currentSong && currentSong.requestedBy.toLowerCase() === normalized) {
    count++
  }

  count += queue.filter((item) => item.requestedBy.toLowerCase() === normalized).length

  return count
}

export function getState(): PlayerState {
  return {
    current: currentSong,
    queue: [...queue],
    isPlaying: currentSong !== null
  }
}

export function getQueue() {
  return [...queue]
}

export function getCurrent() {
  return currentSong
}

export function addSong(song: Song, requestedBy: string, addToQueue: boolean = true): QueueItem {
  const now = Date.now()

  log(`[REQUEST] ${requestedBy} → "${song.title}"`)

  if (currentSong?.videoId === song.videoId) {
    throw new Error('этот трек уже находится в очереди')
  }

  if (queue.some((item) => item.videoId === song.videoId)) {
    throw new Error('этот трек уже находится в очереди')
  }

  if (addToQueue && queue.length >= config.maxQueueSize) {
    throw new Error('очередь заполнена')
  }

  const activeCount = getUserActiveCount(requestedBy)
  if (config.maxRequestsPerUser > 0 && activeCount >= config.maxRequestsPerUser) {
    throw new Error(`вы можете заказать только ${config.maxRequestsPerUser} трек${config.maxRequestsPerUser > 1 ? 'а' : ''} одновременно`)
  }

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

  return item
}

export function setCurrent(item: QueueItem | null): void {
  currentSong = item

  if (item) {
    log(`[PLAYER] started "${item.title}"`)
  } else {
    log(`[PLAYER] stopped`)
  }
}

export function moveToNext(): QueueItem | null {
  const next = queue.shift() ?? null

  if (next) {
    setCurrent(next)
    log(`[PLAYER] moved to next: "${next.title}"`)
  } else {
    setCurrent(null)
  }

  return next
}

export function removeAt(index: number): QueueItem | null {
  if (index < 0 || index >= queue.length) {
    return null
  }

  const [item] = queue.splice(index, 1)

  if (item) {
    log(`[QUEUE] removed "${item.title}" at position ${index + 1}`)
  }

  return item ?? null
}

export function clearQueue(): QueueItem[] {
  const cleared = [...queue]
  queue.length = 0

  log(`[QUEUE] cleared ${cleared.length} songs`)

  return cleared
}

export function skipCurrent(): QueueItem | null {
  const skipped = currentSong

  if (skipped) {
    log(`[PLAYER] skipped "${skipped.title}"`)
  }

  return moveToNext()
}
