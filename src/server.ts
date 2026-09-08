import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import open from 'open'

import { getPublicSecretsView, updateSecrets } from './secrets.js'
import { getRuntimeConfig, updateRuntimeConfig } from './runtimeConfig.js'
import { searchSongs, getVideoById, selectBestSong } from './youtube/index.js'
import {
  getState,
  addSong,
  removeAt,
  clearQueue,
  moveToNext,
  skipCurrent,
  setCurrent,
  refreshFallbackPlaylist,
  shuffleFallback,
  setPaused,
  getFallbackState
} from './queue.js'
import { getSettings, updateSettings } from './settings.js'

const app = express()
const PORT = Number(process.env.PORT) || 3000

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)

      try {
        const { hostname } = new URL(origin)
        const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1'
        const isLan = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)

        if (isLocalHost || isLan) return callback(null, true)
      } catch {
        // не валидный origin - падаем в отказ ниже
      }

      callback(new Error('Not allowed by CORS'))
    }
  })
)
app.use(express.json())
app.use(express.static('public'))

function log(message: string) {
  console.log(`[SERVER] ${message}`)
}

/**
 * Разбирает YouTube-ссылку: определяет, что это вообще YouTube,
 * и если да - пытается вытащить video ID.
 *
 * Поддерживает:
 * - youtube.com/watch?v=...
 * - www.youtube.com/watch?v=...
 * - m.youtube.com/watch?v=...
 * - youtu.be/...
 * - youtube.com/shorts/...
 * - youtube.com/embed/...
 * - youtube.com/v/...
 */
function parseYouTubeUrl(input: string): { isYouTube: boolean; videoId: string | null } {
  let url: URL

  try {
    url = new URL(input)
  } catch {
    return { isYouTube: false, videoId: null }
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '')

  const isYouTube = hostname === 'youtube.com' || hostname === 'youtube-nocookie.com' || hostname === 'youtu.be'

  if (!isYouTube) return { isYouTube: false, videoId: null }

  if (hostname === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return { isYouTube: true, videoId: isValidVideoId(id) ? id : null }
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v')
    return { isYouTube: true, videoId: isValidVideoId(id) ? id : null }
  }

  const pathMatch = url.pathname.match(/^\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/)
  return { isYouTube: true, videoId: pathMatch ? pathMatch[1] : null }
}

function isValidVideoId(value: string | null | undefined): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{11}$/.test(value))
}

function getErrorInfo(error: unknown): {
  code: string
  status: number
  message: string
} {
  const message = error instanceof Error ? error.message : 'не удалось добавить трек'
  const errorTable = [
    { test: (m: string) => m.includes('уже находится'), code: 'DUPLICATE', status: 409 },
    { test: (m: string) => m.includes('очередь заполнена'), code: 'QUEUE_FULL', status: 409 },
    { test: (m: string) => m.includes('вы можете заказать'), code: 'USER_LIMIT', status: 409 },
    { test: (m: string) => m.includes('слишком часто'), code: 'COOLDOWN', status: 409 },
    { test: (m: string) => m.includes('лимит YouTube API'), code: 'YOUTUBE_QUOTA', status: 503 },
    { test: (m: string) => m.includes('YouTube'), code: 'YOUTUBE_ERROR', status: 503 }
  ]
  const matched = errorTable.find((entry) => entry.test(message))
  return {
    code: matched?.code ?? 'SERVER_ERROR',
    status: matched?.status ?? 500,
    message
  }
}

app.get('/preview', (_req, res) => {
  res.sendFile('preview.html', {
    root: 'public'
  })
})

app.get('/api/state', (_req, res) => {
  res.json(getState())
})

app.get('/api/settings', (_req, res) => {
  res.json(getSettings())
})

app.put('/api/settings', (req, res) => {
  const updates = req.body ?? {}
  const updated = updateSettings(updates)
  res.json(updated)
})

app.get('/api/config', (_req, res) => {
  res.json(getRuntimeConfig())
})

app.put('/api/config', async (req, res) => {
  const previous = getRuntimeConfig()
  const updated = updateRuntimeConfig(req.body ?? {})

  if (updated.fallbackPlaylistId !== previous.fallbackPlaylistId) {
    try {
      await refreshFallbackPlaylist()
    } catch (error) {
      log(`[ERROR] Failed to refresh fallback playlist: ${error instanceof Error ? error.message : error}`)
      return res.json({
        ...updated,
        fallbackPlaylistWarning: 'не удалось загрузить плейлист, проверьте ID'
      })
    }
  }

  res.json(updated)
})

app.get('/api/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''

  if (query.length < 2) {
    return res.status(400).json({
      success: false,
      error: 'запрос должен содержать минимум 2 символа',
      code: 'INVALID_QUERY'
    })
  }

  try {
    const songs = await searchSongs(query)
    return res.json({
      success: true,
      results: songs
    })
  } catch (error) {
    log(`[ERROR] Search: ${error instanceof Error ? error.message : error}`)
    const info = getErrorInfo(error)
    return res.status(info.status).json({
      success: false,
      error: info.message,
      code: info.code,
      results: []
    })
  }
})

app.post('/api/queue/request', async (req, res) => {
  const { query, requestedBy } = req.body ?? {}

  if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 200) {
    return res.status(400).json({
      success: false,
      error: 'запрос должен быть от 2 до 200 символов',
      code: 'INVALID_QUERY'
    })
  }

  if (typeof requestedBy !== 'string' || requestedBy.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'имя пользователя обязательно',
      code: 'INVALID_REQUEST'
    })
  }

  const trimmedQuery = query.trim()
  const trimmedRequestedBy = requestedBy.trim()

  try {
    let song = null
    const { isYouTube, videoId } = parseYouTubeUrl(trimmedQuery)

    if (isYouTube && !videoId) {
      log(`[REJECT] ${trimmedRequestedBy} → INVALID_YOUTUBE_URL`)
      return res.status(400).json({
        success: false,
        error: 'некорректная ссылка на YouTube',
        code: 'INVALID_YOUTUBE_URL'
      })
    }

    if (videoId) {
      log(`[REQUEST] ${trimmedRequestedBy} → YouTube URL: ${videoId}`)
      song = await getVideoById(videoId)
    } else {
      log(`[REQUEST] ${trimmedRequestedBy} → Search: "${trimmedQuery}"`)
      const songs = await searchSongs(trimmedQuery)
      song = selectBestSong(songs, trimmedQuery)
    }

    if (!song) {
      log(`[REJECT] ${trimmedRequestedBy} → SONG_NOT_FOUND`)
      return res.status(404).json({
        success: false,
        error: 'не удалось найти подходящий трек',
        code: 'SONG_NOT_FOUND'
      })
    }

    const stateBefore = getState()
    const wasEmpty = stateBefore.current === null
    const item = addSong(song, trimmedRequestedBy, !wasEmpty)

    if (wasEmpty) {
      setCurrent(item)
      log(`[ACCEPT] ${trimmedRequestedBy} → "${song.title}" - now playing`)
    } else {
      log(`[ACCEPT] ${trimmedRequestedBy} → "${song.title}" - queued`)
    }

    const state = getState()
    const position = wasEmpty ? 0 : state.queue.length
    return res.status(201).json({
      success: true,
      message: wasEmpty ? `добавлено: ${song.title} - сейчас играет` : `добавлено: ${song.title} - позиция #${position}`,
      song: item,
      started: wasEmpty,
      position,
      state
    })
  } catch (error) {
    const info = getErrorInfo(error)
    log(`[REJECT] ${trimmedRequestedBy} → ${info.code}: ${info.message}`)
    return res.status(info.status).json({
      success: false,
      error: info.message,
      code: info.code
    })
  }
})

app.post('/api/player/ended', (_req, res) => {
  moveToNext()
  return res.json({
    success: true,
    state: getState()
  })
})

app.post('/api/player/skip', (req, res) => {
  skipCurrent()
  return res.json({
    success: true,
    state: getState()
  })
})

app.post('/api/player/pause', (_req, res) => {
  setPaused(true)
  return res.json({
    success: true,
    state: getState()
  })
})

app.post('/api/player/resume', (_req, res) => {
  setPaused(false)
  return res.json({
    success: true,
    state: getState()
  })
})

app.get('/api/fallback', (_req, res) => {
  res.json(getFallbackState())
})

app.post('/api/fallback/refresh', async (_req, res) => {
  try {
    await refreshFallbackPlaylist()
    res.json({ success: true, ...getFallbackState() })
  } catch {
    res.status(400).json({ success: false, error: 'не удалось обновить плейлист, проверь ID' })
  }
})

app.post('/api/fallback/shuffle', (_req, res) => {
  shuffleFallback()
  res.json({ success: true, ...getFallbackState() })
})

app.delete('/api/queue/:index', (req, res) => {
  const index = Number(req.params.index)

  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({
      success: false,
      error: 'некорректный индекс',
      code: 'INVALID_INDEX'
    })
  }

  const removed = removeAt(index)

  if (!removed) {
    return res.status(404).json({
      success: false,
      error: 'элемент очереди не найден',
      code: 'QUEUE_ITEM_NOT_FOUND'
    })
  }

  return res.json({
    success: true,
    removed,
    state: getState()
  })
})

app.post('/api/queue/clear', (_req, res) => {
  clearQueue()
  return res.json({
    success: true,
    state: getState()
  })
})

app.get('/api/secrets', (_req, res) => {
  res.json(getPublicSecretsView())
})

app.put('/api/secrets', (req, res) => {
  updateSecrets(req.body ?? {})
  res.json(getPublicSecretsView())
})

app.use('/api', (_req, res) => {
  return res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    code: 'NOT_FOUND'
  })
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log(`[ERROR] ${err.message}`)
  return res.status(500).json({
    success: false,
    error: 'внутренняя ошибка сервера',
    code: 'SERVER_ERROR'
  })
})

app.listen(PORT, async () => {
  log(`Server running on http://localhost:${PORT}`)
  await refreshFallbackPlaylist()
  if (!getState().current) {
    moveToNext()
  }
  open(`http://localhost:${PORT}`).catch(() => {})
})
