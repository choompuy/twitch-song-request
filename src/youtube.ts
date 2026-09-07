import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSecrets } from './secrets.js'
import { getRuntimeConfig } from './runtimeConfig.js'

type SearchItem = {
  id?: {
    videoId?: string
  }
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: {
      medium?: {
        url?: string
      }
    }
  }
}

type VideoItem = {
  id: string
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: {
      medium?: {
        url?: string
      }
    }
    categoryId?: string
  }
  contentDetails?: {
    duration?: string
  }
  statistics?: {
    viewCount?: string
  }
  status?: {
    embeddable?: boolean
  }
}

export type Song = {
  videoId: string
  title: string
  channelTitle: string
  thumbnail: string
  duration: number
  views: number
  url: string
}

type SearchCacheEntry = {
  results: Song[]
  expiresAt: number
}

type VideoCacheEntry = {
  song: Song | null
  expiresAt: number
}

type CacheFile = {
  searches: Record<string, SearchCacheEntry>
  videos: Record<string, VideoCacheEntry>
  playlists: Record<string, PlaylistCacheEntry>
  quota: {
    date: string
    searches: number
  }
}

type PlaylistCacheEntry = {
  songs: Song[]
  expiresAt: number
}

const DATA_DIR = join(process.cwd(), 'cache')
const CACHE_FILE = join(DATA_DIR, 'youtube-cache.json')

const VIDEO_CACHE_TTL = 10 * 60 * 1000
const SEARCH_CACHE_TTL = 3600 * 1000 // 1 hour
const MAX_DAILY_SEARCHES = 80 // Maximum number of searches allowed per day

const pendingSearches = new Map<string, Promise<Song[]>>()
const pendingVideos = new Map<string, Promise<Song | null>>()
const pendingPlaylists = new Map<string, Promise<Song[]>>()

function createEmptyCache(): CacheFile {
  return {
    searches: {},
    videos: {},
    playlists: {},
    quota: {
      date: getQuotaDate(),
      searches: 0
    }
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

    const cache: CacheFile = {
      searches: data.searches ?? {},
      videos: data.videos ?? {},
      playlists: data.playlists ?? {},
      quota: {
        date: data.quota?.date ?? getQuotaDate(),
        searches: data.quota?.searches ?? 0
      }
    }

    if (cache.quota.date !== getQuotaDate()) {
      cache.quota = {
        date: getQuotaDate(),
        searches: 0
      }

      saveCache(cache)
    }

    return cache
  } catch (error) {
    console.error('[CACHE] Failed to load cache:', error instanceof Error ? error.message : error)

    return createEmptyCache()
  }
}

function saveCache(cache: CacheFile): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }

    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8')
  } catch (error) {
    console.error('[CACHE] Failed to save cache:', error instanceof Error ? error.message : error)
  }
}

let cache = loadCache()

function getQuotaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function resetQuotaIfNeeded(): void {
  const today = getQuotaDate()

  if (cache.quota.date === today) {
    return
  }

  cache.quota = {
    date: today,
    searches: 0
  }

  saveCache(cache)
}

function getSearchCache(query: string): Song[] | null {
  const entry = cache.searches[query]

  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    delete cache.searches[query]
    saveCache(cache)

    return null
  }

  return entry.results
}

function setSearchCache(query: string, results: Song[]): void {
  cache.searches[query] = {
    results,
    expiresAt: Date.now() + SEARCH_CACHE_TTL
  }

  saveCache(cache)
}

function getVideoCache(videoId: string): Song | null | undefined {
  const entry = cache.videos[videoId]

  if (!entry) {
    return undefined
  }

  if (entry.expiresAt <= Date.now()) {
    delete cache.videos[videoId]
    saveCache(cache)

    return undefined
  }

  return entry.song
}

function setVideoCache(videoId: string, song: Song | null): void {
  cache.videos[videoId] = {
    song,
    expiresAt: Date.now() + VIDEO_CACHE_TTL
  }

  saveCache(cache)
}

function canSearch(): boolean {
  resetQuotaIfNeeded()

  return cache.quota.searches < MAX_DAILY_SEARCHES
}

function consumeSearchQuota(): void {
  resetQuotaIfNeeded()

  cache.quota.searches += 1

  saveCache(cache)

  console.log(`[QUOTA] Search usage: ${cache.quota.searches}/${MAX_DAILY_SEARCHES}`)
}

function isoDurationToSeconds(value = ''): number {
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)

  if (!match) {
    return Infinity
  }

  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleScore(title: string, query: string, channelTitle?: string): number {
  const normalizedTitle = normalize(title)
  const normalizedQuery = normalize(query)

  if (!normalizedTitle || !normalizedQuery) {
    return 0
  }

  if (normalizedTitle === normalizedQuery) {
    return 1500
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 1000
  }

  const queryWords = normalizedQuery.split(' ')
  const titleWords = new Set(normalizedTitle.split(' '))

  const meaningfulWords = queryWords.filter((word) => word.length >= 2)

  const matchedWords = meaningfulWords.filter((word) => titleWords.has(word)).length

  let score = matchedWords * 180

  for (const word of meaningfulWords) {
    if (normalizedTitle.includes(word)) {
      score += 40
    }
  }

  if (meaningfulWords.length > 1 && matchedWords === meaningfulWords.length) {
    score += 300
  }

  if (channelTitle) {
    const normalizedChannel = normalize(channelTitle)

    const officialKeywords = ['official', 'topic', 'vevo', 'records', 'music', 'audio']

    if (officialKeywords.some((keyword) => normalizedChannel.includes(keyword))) {
      score += 50
    }
  }

  return score
}

function popularityScore(views: number): number {
  return Math.log10(views + 1) * 50
}

function durationScore(duration: number): number {
  if (duration >= 150 && duration <= 420) {
    return 100
  }

  if (duration < 150) {
    return Math.max(0, 100 - (150 - duration) * 0.5)
  }

  return Math.max(0, 100 - (duration - 420) * 0.5)
}

function combinedScore(song: Song, query: string): number {
  return titleScore(song.title, query, song.channelTitle) + popularityScore(song.views) + durationScore(song.duration)
}

function isValidSong(song: Song, video: VideoItem): boolean {
  const runtimeConfig = getRuntimeConfig()
  const isMusic = video.snippet?.categoryId === '10'
  const isEmbeddable = video.status?.embeddable !== false
  const validDuration = song.duration >= 60 && song.duration <= runtimeConfig.maxDurationSeconds
  const validViews = song.views >= runtimeConfig.minViews

  return isMusic && isEmbeddable && validDuration && validViews
}

function videoToSong(video: VideoItem): Song {
  return {
    videoId: video.id,
    title: video.snippet?.title ?? 'Unknown title',
    channelTitle: video.snippet?.channelTitle ?? 'Unknown channel',
    thumbnail: video.snippet?.thumbnails?.medium?.url ?? '',
    duration: isoDurationToSeconds(video.contentDetails?.duration),
    views: Number(video.statistics?.viewCount ?? 0),
    url: `https://www.youtube.com/watch?v=${video.id}`
  }
}

async function youtube<T>(path: string, params: Record<string, string>): Promise<T> {
  const { youtubeApiKey } = getSecrets()

  if (!youtubeApiKey) {
    throw new Error('YouTube API ключ не настроен, добавь его в панели управления')
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)

  Object.entries({
    ...params,
    key: youtubeApiKey
  }).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  const response = await fetch(url)

  const data = (await response.json()) as T & {
    error?: {
      code?: number
      errors?: Array<{
        reason?: string
      }>
      message?: string
    }
  }

  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason

    if (reason === 'quotaExceeded') {
      throw new Error('YouTube API quota exceeded')
    }

    throw new Error(data.error?.message || `YouTube API error ${response.status}`)
  }

  return data
}

export async function getVideoById(videoId: string): Promise<Song | null> {
  console.log(`[VIDEO] Fetching video by ID: ${videoId}`)

  const cached = getVideoCache(videoId)

  if (cached !== undefined) {
    console.log(`[CACHE] Video ${videoId}`)

    return cached
  }

  const pending = pendingVideos.get(videoId)

  if (pending) {
    return pending
  }

  const request = fetchVideoById(videoId)

  pendingVideos.set(videoId, request)

  try {
    return await request
  } finally {
    pendingVideos.delete(videoId)
  }
}

async function fetchVideoById(videoId: string): Promise<Song | null> {
  try {
    const details = await youtube<{
      items: VideoItem[]
    }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: videoId
    })

    const video = details.items?.[0]

    if (!video) {
      console.log(`[VIDEO] Video not found: ${videoId}`)

      setVideoCache(videoId, null)

      return null
    }

    const song = videoToSong(video)

    if (!isValidSong(song, video)) {
      console.log(`[VIDEO] Video rejected: "${song.title}"`)

      setVideoCache(videoId, null)

      return null
    }

    console.log(`[VIDEO] Valid: "${song.title}" - ${formatViews(song.views)} views`)

    setVideoCache(videoId, song)

    return song
  } catch (error) {
    console.error('[ERROR] YouTube API:', error instanceof Error ? error.message : error)

    if (error instanceof Error && error.message === 'YouTube API quota exceeded') {
      throw new Error('лимит YouTube API исчерпан')
    }

    throw new Error('не удалось получить видео с YouTube')
  }
}

export async function searchSongs(query: string): Promise<Song[]> {
  const normalizedQuery = normalize(query)

  console.log(`[SEARCH] Query: "${normalizedQuery}"`)

  if (!normalizedQuery) {
    return []
  }

  const cached = getSearchCache(normalizedQuery)

  if (cached !== null) {
    console.log(`[CACHE] Search: "${normalizedQuery}" - ${cached.length} results`)

    return cached
  }

  if (!canSearch()) {
    console.warn(`[QUOTA] Daily search limit reached: ${MAX_DAILY_SEARCHES}`)

    throw new Error('дневной лимит поиска YouTube исчерпан, используйте ссылку.')
  }

  const pending = pendingSearches.get(normalizedQuery)

  if (pending) {
    console.log(`[SEARCH] Waiting for existing request: "${normalizedQuery}"`)

    return pending
  }

  const request = performSearch(normalizedQuery)

  pendingSearches.set(normalizedQuery, request)

  try {
    return await request
  } finally {
    pendingSearches.delete(normalizedQuery)
  }
}

async function performSearch(query: string): Promise<Song[]> {
  try {
    consumeSearchQuota()

    const search = await youtube<{
      items: SearchItem[]
    }>('search', {
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: '10',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      maxResults: '20',
      order: 'relevance',
      safeSearch: 'moderate'
    })

    const ids = (search.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id))

    console.log(`[SEARCH] Found ${ids.length} candidates`)

    if (!ids.length) {
      setSearchCache(query, [])

      return []
    }

    const details = await youtube<{
      items: VideoItem[]
    }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: ids.join(',')
    })

    const songs: Song[] = []

    for (const video of details.items ?? []) {
      const song = videoToSong(video)

      if (!isValidSong(song, video)) continue

      songs.push(song)
    }

    console.log(`[FILTER] ${songs.length} suitable results`)

    songs.sort((a, b) => combinedScore(b, query) - combinedScore(a, query))

    setSearchCache(query, songs)

    console.log(`[CACHE] Saved "${query}" - ${songs.length} results`)

    return songs
  } catch (error) {
    console.error('[ERROR] YouTube search:', error instanceof Error ? error.message : error)

    if (error instanceof Error && error.message === 'YouTube API quota exceeded') {
      throw new Error('лимит YouTube API исчерпан. Попробуйте позже или используйте YouTube-ссылку.')
    }

    throw new Error('не удалось выполнить поиск YouTube')
  }
}

export function selectBestSong(songs: Song[], query: string): Song | null {
  if (!songs.length) {
    return null
  }

  const ranked = songs
    .map((song) => ({
      song,
      score: combinedScore(song, query)
    }))
    .sort((a, b) => b.score - a.score)

  const selected = ranked[0].song

  console.log(`[SELECT] "${selected.title}" - ${formatViews(selected.views)} views`)

  return selected
}

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`
  return views.toString()
}

export async function fetchPlaylistSongs(playlistId: string): Promise<Song[]> {
  const { fallbackPlaylistId } = getRuntimeConfig()

  if (!fallbackPlaylistId) {
    return []
  }

  const cached = cache.playlists[playlistId]
  // if (cached && cached.expiresAt > Date.now()) {
  //   console.log(`[PLAYLIST] Using cached playlist: ${playlistId}`)
  //   return cached.songs
  // }

  const existing = pendingPlaylists.get(playlistId)
  if (existing) {
    return existing
  }

  const request = (async () => {
    try {
      console.log(`[PLAYLIST] Fetching playlist: ${playlistId}`)

      const playlist = await youtube<{
        items: Array<{
          snippet?: {
            resourceId?: {
              videoId?: string
            }
          }
        }>
      }>('playlistItems', {
        part: 'snippet',
        playlistId,
        maxResults: '50'
      })

      const videoIds = (playlist.items ?? []).map((item) => item.snippet?.resourceId?.videoId).filter((id): id is string => Boolean(id))

      if (!videoIds.length) {
        console.log(`[PLAYLIST] No videos in playlist: ${playlistId}`)
        return []
      }

      const details = await youtube<{
        items: VideoItem[]
      }>('videos', {
        part: 'snippet,contentDetails,statistics',
        id: videoIds.join(',')
      })

      const songs: Song[] = []

      for (const video of details.items ?? []) {
        const song = videoToSong(video)
        if (song) {
          songs.push(song)
        }
      }

      const ttl = 6 * 60 * 60 * 1000 // Cache for 6 hours
      cache.playlists[playlistId] = {
        songs,
        expiresAt: Date.now() + ttl
      }
      saveCache(cache)

      console.log(`[PLAYLIST] Fetched ${songs.length} songs from playlist: ${playlistId}`)

      return songs
    } catch (error) {
      console.error('[ERROR] Playlist fetch:', error instanceof Error ? error.message : error)
      return []
    }
  })()

  pendingPlaylists.set(playlistId, request)

  try {
    return await request
  } finally {
    pendingPlaylists.delete(playlistId)
  }
}
