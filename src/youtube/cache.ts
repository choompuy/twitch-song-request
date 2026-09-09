import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CacheFile, Song } from '../types.js'

const DATA_DIR = join(process.cwd(), 'cache')
const CACHE_FILE = join(DATA_DIR, 'youtube-cache.json')
const CACHE_TMP_FILE = `${CACHE_FILE}.tmp`

export const CACHE_LIMITS = {
  VIDEO_CACHE_TTL: 10 * 60 * 1000,
  SEARCH_CACHE_TTL: 3600 * 1000, // 1 hour
  MAX_DAILY_SEARCHES: 80 // Maximum number of searches allowed per day
}

const SWEEP_INTERVAL = 60 * 60 * 1000
const SAVE_DEBOUNCE_MS = 250

let cache = loadCache()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()

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

async function persistCacheNow(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }

  await writeFile(CACHE_TMP_FILE, JSON.stringify(cache), 'utf8')
  await rename(CACHE_TMP_FILE, CACHE_FILE)
}

function scheduleSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    saveTimer = null
    saveChain = saveChain.then(persistCacheNow).catch((error) => {
      console.error('[CACHE] Failed to save cache:', error instanceof Error ? error.message : error)
    })
  }, SAVE_DEBOUNCE_MS)
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
    scheduleSave()
  }
}

setInterval(sweepExpired, SWEEP_INTERVAL).unref()

function resetQuotaIfNeeded(): void {
  const today = getQuotaDate()

  if (cache.quota.date === today) {
    return
  }

  cache.quota = { date: today, searches: 0 }
  scheduleSave()
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

  scheduleSave()
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

  scheduleSave()
}

export function canSearch(): boolean {
  resetQuotaIfNeeded()
  return cache.quota.searches < CACHE_LIMITS.MAX_DAILY_SEARCHES
}

export function consumeSearchQuota(): void {
  resetQuotaIfNeeded()
  cache.quota.searches += 1
  scheduleSave()
  console.log(`[QUOTA] Search usage: ${cache.quota.searches}/${CACHE_LIMITS.MAX_DAILY_SEARCHES}`)
}
