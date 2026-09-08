export type PlaylistItem = {
  snippet?: {
    resourceId?: {
      videoId?: string
    }
    title?: string
    channelTitle?: string
    thumbnails?: {
      medium?: {
        url?: string
      }
    }
  }
}

export type VideoItem = {
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

export type SearchItem = {
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
