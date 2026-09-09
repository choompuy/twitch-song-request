export type Config = {
  minViews: number
  minDurationSeconds: number
  maxDurationSeconds: number
  maxQueueSize: number
  maxRequestsPerUser: number
  fallbackPlaylistId: string
}

export type Settings = {
  showVideo: boolean
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
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

export type QueueItem = Song & {
  requestedBy: string
  addedAt: number
  isFallback?: boolean
}

export type PlayerState = {
  current: QueueItem | null
  queue: QueueItem[]
  isPaused: boolean
}

type SearchCacheEntry = {
  results: Song[]
  expiresAt: number
}

type VideoCacheEntry = {
  song: Song | null
  expiresAt: number
}

export type CacheFile = {
  searches: Record<string, SearchCacheEntry>
  videos: Record<string, VideoCacheEntry>
  quota: {
    date: string
    searches: number
  }
}

export type ApiError = { success: false; error: string; code: string }
export type ApiOk<T> = { success: true } & T
export type ApiResult<T> = ApiOk<T> | ApiError

export type AppErrorCode = 'DUPLICATE' | 'QUEUE_FULL' | 'USER_LIMIT' | 'YOUTUBE_QUOTA' | 'YOUTUBE_ERROR'
export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string
  ) {
    super(message)
  }
}

export type StateResponse = PlayerState
export type SettingsResponse = Settings
export type PreviewStateResponse = { state: PlayerState; settings: Settings }
export type ConfigResponse = Config & { fallbackPlaylistWarning?: string }
export type SearchResponse = { results: Song[] }
export type QueueRequestResponse = {
  message: string
  song: QueueItem
  started: boolean
  position: number
  state: PlayerState
}
export type FallbackTrackView = Pick<Song, 'videoId' | 'title' | 'channelTitle' | 'thumbnail' | 'duration'>
export type FallbackStateResponse = {
  playlistId: string | null
  lastRefreshedAt: number | null
  nextIndex: number
  tracks: FallbackTrackView[]
}
export type QueueRemoveResponse = { removed: QueueItem; state: PlayerState }
export type SecretsResponse = { youtubeApiKey: string; hasYoutubeApiKey: boolean }
