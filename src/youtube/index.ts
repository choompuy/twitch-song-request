import { Song } from '../types.js'
import { youtube, videoToSong, isValidSong } from './client.js'
import { normalize, combinedScore, formatViews } from './scoring.js'
import { getSearchCache, setSearchCache, getVideoCache, setVideoCache, canSearch, consumeSearchQuota, CACHE_LIMITS } from './cache.js'
import { VideoItem, SearchItem, PlaylistItem } from './types.js'

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

export async function getVideoById(videoId: string): Promise<Song | null> {
  console.log(`[VIDEO] Fetching video by ID: ${videoId}`)
  const cached = getVideoCache(videoId)

  if (cached !== undefined) {
    console.log(`[CACHE] Video ${videoId}`)
    return cached
  }

  return dedupInFlight(pendingVideos, videoId, () => fetchVideoById(videoId))
}

async function fetchVideoById(videoId: string): Promise<Song | null> {
  try {
    const details = await youtube<{ items: VideoItem[] }>('videos', {
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
    console.warn(`[QUOTA] Daily search limit reached: ${CACHE_LIMITS.MAX_DAILY_SEARCHES}`)
    throw new Error('дневной лимит поиска YouTube исчерпан, используйте ссылку.')
  }

  return dedupInFlight(pendingSearches, normalizedQuery, () => performSearch(normalizedQuery))
}

async function performSearch(query: string): Promise<Song[]> {
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
      setSearchCache(query, [])
      return []
    }

    const details = await youtube<{ items: VideoItem[] }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: ids.join(',')
    })

    const songs = (details.items ?? [])
      .map((video) => ({ video, song: videoToSong(video) }))
      .filter(({ video, song }) => isValidSong(song, video))
      .map(({ song }) => song)

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

  const ranked = songs.map((song) => ({ song, score: combinedScore(song, query) })).sort((a, b) => b.score - a.score)
  const selected = ranked[0].song
  console.log(`[SELECT] "${selected.title}" - ${formatViews(selected.views)} views`)
  return selected
}

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

    const songs = (details.items ?? [])
      .map((video) => ({ video, song: videoToSong(video) }))
      .filter(({ video, song }) => isValidSong(song, video))
      .map(({ song }) => song)
    console.log(`[PLAYLIST] Fetched ${songs.length} valid songs from playlist: ${playlistId}`)
    return songs
  } catch (error) {
    console.error('[ERROR] Playlist fetch:', error instanceof Error ? error.message : error)
    return []
  }
}
