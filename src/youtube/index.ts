import { Song, AppError } from '../types.js'
import { youtube, videoToSong, isValidSong, fetchPlaylistMeta, PlaylistMeta } from './client.js'
import { normalize, combinedScore, formatViews } from './scoring.js'
import { getSearchCache, setSearchCache, getVideoCache, setVideoCache, canSearch, consumeSearchQuota, CACHE_LIMITS } from './cache.js'
import { VideoItem, SearchItem, PlaylistItem } from './types.js'
import { getConfig } from '../config.js'

const pendingSearches = new Map<string, Promise<Song[]>>()
const pendingVideos = new Map<string, Promise<Song | null>>()
const pendingPlaylists = new Map<string, Promise<Song[]>>()

function dedupInFlight<T>(pending: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = pending.get(key)

  if (existing) {
    return existing
  }

  const request = run()
  pending.set(key, request)
  return request.finally(() => pending.delete(key))
}

/** Ключ версии фильтров - меняется при правке любого из полей, влияющих на isValidSong. Инвалидирует кэш при смене настроек. */
function filtersVersion(): string {
  const c = getConfig()
  return `${c.minViews}:${c.minDurationSeconds}:${c.maxDurationSeconds}`
}

export async function getVideoById(videoId: string, bypassFilters = false): Promise<Song | null> {
  console.log(`[VIDEO] Fetching video by ID: ${videoId}`)
  const cached = bypassFilters ? undefined : getVideoCache(videoId, filtersVersion())

  if (cached !== undefined) {
    console.log(`[CACHE] Video ${videoId}`)
    return cached
  }

  return dedupInFlight(pendingVideos, `${bypassFilters ? 'raw:' : ''}${videoId}`, () => fetchVideoById(videoId, bypassFilters))
}

async function fetchVideoById(videoId: string, bypassFilters: boolean): Promise<Song | null> {
  try {
    const details = await youtube<{ items: VideoItem[] }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: videoId
    })

    const video = details.items?.[0]

    if (!video) {
      console.log(`[VIDEO] Video not found: ${videoId}`)
      if (!bypassFilters) setVideoCache(videoId, null, filtersVersion())
      return null
    }

    const song = videoToSong(video)

    if (!bypassFilters && !isValidSong(song, video)) {
      console.log(`[VIDEO] Video rejected: "${song.title}"`)
      setVideoCache(videoId, null, filtersVersion())
      return null
    }

    console.log(`[VIDEO] Valid: "${song.title}" - ${formatViews(song.views)} views`)
    if (!bypassFilters) setVideoCache(videoId, song, filtersVersion())

    return song
  } catch (error) {
    console.error('[ERROR] YouTube API:', error instanceof Error ? error.message : error)

    if (error instanceof Error && error.message === 'YouTube API quota exceeded') {
      throw new AppError('YOUTUBE_QUOTA', 'лимит YouTube API исчерпан')
    }

    throw new AppError('YOUTUBE_ERROR', 'не удалось получить видео с YouTube')
  }
}

export async function searchSongs(query: string, bypassFilters = false): Promise<Song[]> {
  const normalizedQuery = normalize(query)

  console.log(`[SEARCH] Query: "${normalizedQuery}"`)

  if (!normalizedQuery) {
    return []
  }

  const cacheKey = bypassFilters ? `raw:${normalizedQuery}` : normalizedQuery
  const cached = bypassFilters ? null : getSearchCache(normalizedQuery, filtersVersion())

  if (cached !== null) {
    console.log(`[CACHE] Search: "${normalizedQuery}" - ${cached.length} results`)
    return cached
  }

  if (!canSearch()) {
    console.warn(`[QUOTA] Daily search limit reached: ${CACHE_LIMITS.MAX_DAILY_SEARCHES}`)
    throw new AppError('YOUTUBE_QUOTA', 'дневной лимит поиска YouTube исчерпан, используйте ссылку.')
  }

  return dedupInFlight(pendingSearches, cacheKey, () => performSearch(normalizedQuery, bypassFilters))
}

function mapValidSongs(videos: VideoItem[], bypassFilters = false): Song[] {
  return videos
    .map((video) => ({ video, song: videoToSong(video) }))
    .filter(({ video, song }) => bypassFilters || isValidSong(song, video))
    .map(({ song }) => song)
}

async function performSearch(query: string, bypassFilters: boolean): Promise<Song[]> {
  try {
    consumeSearchQuota()
    const search = await youtube<{ items: SearchItem[] }>('search', {
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
      if (!bypassFilters) setSearchCache(query, [], filtersVersion())
      return []
    }

    const details = await youtube<{ items: VideoItem[] }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: ids.join(',')
    })

    const songs = mapValidSongs(details.items ?? [], bypassFilters)

    console.log(`[FILTER] ${songs.length} suitable results`)
    songs.sort((a, b) => combinedScore(b, query) - combinedScore(a, query))
    if (!bypassFilters) {
      setSearchCache(query, songs, filtersVersion())
      console.log(`[CACHE] Saved "${query}" - ${songs.length} results`)
    }
    return songs
  } catch (error) {
    console.error('[ERROR] YouTube search:', error instanceof Error ? error.message : error)

    if (error instanceof Error && error.message === 'YouTube API quota exceeded') {
      throw new AppError('YOUTUBE_QUOTA', 'лимит YouTube API исчерпан. Попробуйте позже или используйте YouTube-ссылку.')
    }

    throw new AppError('YOUTUBE_ERROR', 'не удалось выполнить поиск YouTube')
  }
}

export function selectBestSong(songs: Song[], query: string): Song | null {
  if (!songs.length) {
    return null
  }

  const ranked = songs.map((song) => ({ song, score: combinedScore(song, query) })).sort((a, b) => b.score - a.score)
  const selected = ranked[0].song
  console.log(`[SELECT] "${selected.title}" - ${formatViews(selected.views)} views`)
  return selected
}

export { fetchPlaylistMeta }
export type { PlaylistMeta }

export async function fetchPlaylistSongs(playlistId: string): Promise<Song[]> {
  if (!playlistId) {
    return []
  }

  return dedupInFlight(pendingPlaylists, playlistId, () => performPlaylistFetch(playlistId))
}

async function performPlaylistFetch(playlistId: string): Promise<Song[]> {
  try {
    console.log(`[PLAYLIST] Fetching playlist: ${playlistId}`)
    const playlist = await youtube<{ items: PlaylistItem[] }>('playlistItems', {
      part: 'snippet',
      playlistId,
      maxResults: '50'
    })
    const videoIds = (playlist.items ?? []).map((item) => item.snippet?.resourceId?.videoId).filter((id): id is string => Boolean(id))

    if (!videoIds.length) {
      console.log(`[PLAYLIST] No videos in playlist: ${playlistId}`)
      return []
    }

    const details = await youtube<{ items: VideoItem[] }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: videoIds.join(',')
    })

    const songs = mapValidSongs(details.items ?? [])

    console.log(`[PLAYLIST] Fetched ${songs.length} valid songs from playlist: ${playlistId}`)
    return songs
  } catch (error) {
    console.error('[ERROR] Playlist fetch:', error instanceof Error ? error.message : error)
    return []
  }
}
