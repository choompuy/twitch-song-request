export type RuntimeConfig = {
  minViews: number
  maxDurationSeconds: number
  maxQueueSize: number
  maxRequestsPerUser: number
  cooldownSeconds: number
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

export type ApiError = { success: false; error: string; code: string }
export type ApiOk<T> = { success: true } & T
export type ApiResult<T> = ApiOk<T> | ApiError

export type AppErrorCode = 'DUPLICATE' | 'QUEUE_FULL' | 'USER_LIMIT' | 'COOLDOWN' | 'YOUTUBE_QUOTA' | 'YOUTUBE_ERROR'
export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string
  ) {
    super(message)
  }
}
