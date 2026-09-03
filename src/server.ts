import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import { config } from './config.js'
import { searchSongs, getVideoById, selectBestSong } from './youtube.js'
import { getState, addSong, removeAt, clearQueue, moveToNext, skipCurrent, setCurrent } from './queue.js'
import { getSettings, updateSettings } from './settings.js'

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

function log(message: string) {
  console.log(`[SERVER] ${message}`)
}

/**
 * Извлекает YouTube video ID из ссылки.
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
function getYouTubeVideoId(input: string): string | null {
  let url: URL

  try {
    url = new URL(input)
  } catch {
    return null
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '')

  if (hostname === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]

    return isValidVideoId(id) ? id : null
  }

  if (hostname !== 'youtube.com' && hostname !== 'youtube-nocookie.com') {
    return null
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v')

    return isValidVideoId(id) ? id : null
  }

  const pathMatch = url.pathname.match(/^\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/)

  if (pathMatch) {
    return pathMatch[1]
  }

  return null
}

function isValidVideoId(value: string | null | undefined): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{11}$/.test(value))
}

function isYouTubeUrl(input: string): boolean {
  try {
    const url = new URL(input)

    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/^m\./, '')

    return hostname === 'youtube.com' || hostname === 'youtube-nocookie.com' || hostname === 'youtu.be'
  } catch {
    return false
  }
}

function getErrorInfo(error: unknown): {
  code: string
  status: number
  message: string
} {
  const message = error instanceof Error ? error.message : 'не удалось добавить трек'

  if (message.includes('already playing') || message.includes('already in the queue') || message.includes('уже находится')) {
    return {
      code: 'DUPLICATE',
      status: 409,
      message
    }
  }

  if (message.includes('queue is full') || message.includes('очередь заполнена')) {
    return {
      code: 'QUEUE_FULL',
      status: 409,
      message
    }
  }

  if (message.includes('active requests') || message.includes('вы можете заказать')) {
    return {
      code: 'USER_LIMIT',
      status: 409,
      message
    }
  }

  if (message.includes('cooldown') || message.includes('слишком часто')) {
    return {
      code: 'COOLDOWN',
      status: 409,
      message
    }
  }

  if (message.includes('YouTube API quota') || message.includes('лимит YouTube API')) {
    return {
      code: 'YOUTUBE_QUOTA',
      status: 503,
      message
    }
  }

  if (message.includes('YouTube')) {
    return {
      code: 'YOUTUBE_ERROR',
      status: 503,
      message
    }
  }

  return {
    code: 'SERVER_ERROR',
    status: 500,
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
    const videoId = getYouTubeVideoId(trimmedQuery)

    if (videoId) {
      log(`[REQUEST] ${trimmedRequestedBy} → YouTube URL: ${videoId}`)

      song = await getVideoById(videoId)
    } else if (!isYouTubeUrl(trimmedQuery)) {
      log(`[REQUEST] ${trimmedRequestedBy} → Search: "${trimmedQuery}"`)

      const songs = await searchSongs(trimmedQuery)

      song = selectBestSong(songs, trimmedQuery)
    } else {
      log(`[REJECT] ${trimmedRequestedBy} → INVALID_YOUTUBE_URL`)

      return res.status(400).json({
        success: false,
        error: 'некорректная ссылка на YouTube',
        code: 'INVALID_YOUTUBE_URL'
      })
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

app.post('/api/player/skip', (_req, res) => {
  skipCurrent()

  return res.json({
    success: true,
    state: getState()
  })
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

app.listen(config.port, () => {
  log(`Server running on http://localhost:${config.port}`)
})
