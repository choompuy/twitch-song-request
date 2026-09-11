import { getSecrets } from '../secrets.js'
import { getConfig } from '../config.js'
import { Song } from '../types.js'
import { VideoItem } from './types.js'
import { isoDurationToSeconds } from './scoring.js'

type YouTubeErrorResponse = {
  error?: {
    code?: number
    errors?: Array<{ reason?: string }>
    message?: string
  }
}

export async function youtube<T>(path: string, params: Record<string, string>): Promise<T> {
  const { youtubeApiKey } = getSecrets()

  if (!youtubeApiKey) {
    throw new Error('YouTube API ключ не настроен, добавь его в панели управления')
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)

  for (const [key, value] of Object.entries({ ...params, key: youtubeApiKey })) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url)
  const data = (await response.json()) as T & YouTubeErrorResponse

  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason

    if (reason === 'quotaExceeded') {
      throw new Error('YouTube API quota exceeded')
    }

    throw new Error(data.error?.message || `YouTube API error ${response.status}`)
  }

  return data
}

export function videoToSong(video: VideoItem): Song {
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

export type PlaylistMeta = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
}

export async function fetchPlaylistMeta(playlistId: string): Promise<PlaylistMeta | null> {
  const data = await youtube<{
    items: Array<{ id: string; snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } }; contentDetails?: { itemCount?: number } }>
  }>('playlists', { part: 'snippet,contentDetails', id: playlistId })

  const item = data.items?.[0]
  if (!item) return null

  return {
    id: item.id,
    title: item.snippet?.title ?? 'Untitled playlist',
    thumbnail: item.snippet?.thumbnails?.medium?.url ?? '',
    itemCount: item.contentDetails?.itemCount ?? 0
  }
}

export function isValidSong(song: Song, video: VideoItem): boolean {
  const config = getConfig()

  const isMusic = video.snippet?.categoryId === '10'
  const isEmbeddable = video.status?.embeddable !== false
  const validDuration = song.duration >= config.minDurationSeconds && song.duration <= config.maxDurationSeconds
  const validViews = song.views >= config.minViews

  if (!isMusic || !isEmbeddable || !validDuration || !validViews) {
    return false
  }

  return true
}
