import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFileStore } from '../persist.js'
import { CacheFile, Song } from '../types.js'

const DATA_DIR = join(process.cwd(), 'cache')
const CACHE_FILE = join(DATA_DIR, 'youtube-cache.json')
const store = createFileStore(CACHE_FILE)

export const CACHE_LIMITS = {
  VIDEO_CACHE_TTL: 10 * 60 * 1000,
  SEARCH_CACHE_TTL: 3600 * 1000, // 1 hour
  MAX_DAILY_SEARCHES: 80 // Maximum number of searches allowed per day
}

const SWEEP_INTERVAL = 60 * 60 * 1000

function getQuotaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function createEmptyCache(): CacheFile {
  return {
    searches: {},
    videos: {},
    quota: { date: getQuotaDate(), searches: 0 }
  }
}

function loadCache(): CacheFile {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }

    if (!existsSync(CACHE_FILE)) {
      return createEmptyCache()
    }

    const raw = readFileSync(CACHE_FILE, 'utf8')
    const data = JSON.parse(raw) as Partial<CacheFile>

    return {
      searches: data.searches ?? {},
      videos: data.videos ?? {},
      quota: {
        date: data.quota?.date ?? getQuotaDate(),
        searches: data.quota?.searches ?? 0
      }
    }
  } catch (error) {
    console.error('[CACHE] Failed to load cache:', error instanceof Error ? error.message : error)
    return createEmptyCache()
  }
}

let cache = loadCache()

function saveCache(): void {
  store.scheduleSave(
    () => cache,
    (error) => console.error('[CACHE] Failed to save cache:', error instanceof Error ? error.message : error)
  )
}

function sweepExpired(): void {
  const now = Date.now()
  let hasChanges = false

  for (const key in cache.searches) {
    if (cache.searches[key].expiresAt <= now) {
      delete cache.searches[key]
      hasChanges = true
    }
  }

  for (const key in cache.videos) {
    if (cache.videos[key].expiresAt <= now) {
      delete cache.videos[key]
      hasChanges = true
    }
  }

  if (hasChanges) {
    saveCache()
  }
}

setInterval(sweepExpired, SWEEP_INTERVAL).unref()

function resetQuotaIfNeeded(): void {
  const today = getQuotaDate()

  if (cache.quota.date === today) {
    return
  }

  cache.quota = { date: today, searches: 0 }
  saveCache()
}

export function getSearchCache(query: string): Song[] | null {
  const entry = cache.searches[query]

  if (!entry || entry.expiresAt <= Date.now()) {
    return null
  }

  return entry.results
}

export function setSearchCache(query: string, results: Song[]): void {
  cache.searches[query] = {
    results,
    expiresAt: Date.now() + CACHE_LIMITS.SEARCH_CACHE_TTL
  }

  saveCache()
}

export function getVideoCache(videoId: string): Song | null | undefined {
  const entry = cache.videos[videoId]

  if (!entry || entry.expiresAt <= Date.now()) {
    return undefined
  }

  return entry.song
}

export function setVideoCache(videoId: string, song: Song | null): void {
  cache.videos[videoId] = {
    song,
    expiresAt: Date.now() + CACHE_LIMITS.VIDEO_CACHE_TTL
  }

  saveCache()
}

export function canSearch(): boolean {
  resetQuotaIfNeeded()
  return cache.quota.searches < CACHE_LIMITS.MAX_DAILY_SEARCHES
}

export function consumeSearchQuota(): void {
  resetQuotaIfNeeded()
  cache.quota.searches += 1
  saveCache()
  console.log(`[QUOTA] Search usage: ${cache.quota.searches}/${CACHE_LIMITS.MAX_DAILY_SEARCHES}`)
}
