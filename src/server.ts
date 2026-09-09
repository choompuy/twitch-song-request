import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import open from 'open'

import {
  StateResponse,
  SettingsResponse,
  PreviewStateResponse,
  ConfigResponse,
  SearchResponse,
  QueueRequestResponse,
  FallbackStateResponse,
  QueueRemoveResponse,
  SecretsResponse
} from './types.js'
import { ok, fail, failFromError } from './http.js'
import { getPublicSecretsView, updateSecrets } from './secrets.js'
import { getConfig, updateConfig } from './config.js'
import { getSettings, updateSettings } from './settings.js'
import { searchSongs, getVideoById, selectBestSong } from './youtube/index.js'
import {
  getState,
  addSong,
  removeAt,
  clearQueue,
  moveToNext,
  skipCurrent,
  setCurrent,
  refreshFallback,
  setPaused,
  getFallbackState,
  toggleFallbackShuffle,
  toggleFallbackRepeat,
  toggleFallbackEnabled
} from './queue.js'

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

function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  try {
    const url = new URL(trimmed)
    const listParam = url.searchParams.get('list')
    if (listParam) {
      return listParam
    }
  } catch {
    // не URL - считаем, что это уже голый ID, пропускаем дальше
  }

  return trimmed
}

app.get('/preview', (_req, res) => {
  res.sendFile('preview.html', {
    root: 'public'
  })
})

app.get('/api/state', (_req, res) => {
  ok<StateResponse>(res, getState())
})

app.get('/api/settings', (_req, res) => {
  ok<SettingsResponse>(res, getSettings())
})

app.put('/api/settings', (req, res) => {
  const updates = req.body ?? {}
  const updated = updateSettings(updates)
  ok<SettingsResponse>(res, updated)
})

app.get('/api/preview-state', (_req, res) => {
  ok<PreviewStateResponse>(res, { state: getState(), settings: getSettings() })
})

app.get('/api/config', (_req, res) => {
  ok<ConfigResponse>(res, getConfig())
})

app.put('/api/config', async (req, res) => {
  const body = { ...(req.body ?? {}) }

  if (body.fallbackPlaylist && typeof body.fallbackPlaylist.playlistId === 'string') {
    body.fallbackPlaylist = {
      ...body.fallbackPlaylist,
      playlistId: parsePlaylistId(body.fallbackPlaylist.playlistId) || null
    }
  }

  const previous = getConfig()
  const updated = updateConfig(body ?? {})

  if (updated.fallbackPlaylist.playlistId !== previous.fallbackPlaylist.playlistId) {
    try {
      await refreshFallback()
    } catch (error) {
      log(`[ERROR] Failed to refresh fallback playlist: ${error instanceof Error ? error.message : error}`)
      return ok<ConfigResponse>(res, {
        ...updated,
        fallbackPlaylistWarning: 'не удалось загрузить плейлист, проверьте ID'
      })
    }
  } else if (updated.fallbackPlaylist.shuffle !== previous.fallbackPlaylist.shuffle) {
    toggleFallbackShuffle()
  }

  ok<ConfigResponse>(res, updated)
})

app.get('/api/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''

  if (query.length < 2) {
    return fail(res, 'запрос должен содержать минимум 2 символа', 'INVALID_QUERY', 400)
  }

  try {
    const songs = await searchSongs(query)
    ok<SearchResponse>(res, { results: songs })
  } catch (error) {
    log(`[ERROR] Search: ${error instanceof Error ? error.message : error}`)
    failFromError(res, error)
  }
})

app.post('/api/queue/request', async (req, res) => {
  const { query, requestedBy } = req.body ?? {}

  if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 200) {
    return fail(res, 'запрос должен быть от 2 до 200 символов', 'INVALID_QUERY', 400)
  }

  if (typeof requestedBy !== 'string' || requestedBy.trim().length === 0) {
    return fail(res, 'имя пользователя обязательно', 'INVALID_REQUEST', 400)
  }

  const trimmedQuery = query.trim()
  const trimmedRequestedBy = requestedBy.trim()

  try {
    let song = null
    const { isYouTube, videoId } = parseYouTubeUrl(trimmedQuery)

    if (isYouTube && !videoId) {
      log(`[REJECT] ${trimmedRequestedBy} → INVALID_YOUTUBE_URL`)
      return fail(res, 'некорректная ссылка на YouTube', 'INVALID_YOUTUBE_URL', 400)
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
      return fail(res, 'не удалось найти подходящий трек', 'SONG_NOT_FOUND', 404)
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

    ok<QueueRequestResponse>(
      res,
      {
        message: wasEmpty ? `добавлено: ${song.title} - сейчас играет` : `добавлено: ${song.title} - позиция #${position}`,
        song: item,
        started: wasEmpty,
        position,
        state
      },
      201
    )
  } catch (error) {
    log(`[REJECT] ${trimmedRequestedBy} → error while adding song`)
    failFromError(res, error)
  }
})

app.post('/api/player/ended', (_req, res) => {
  moveToNext()
  ok<StateResponse>(res, getState())
})

app.post('/api/player/skip', (_req, res) => {
  skipCurrent()
  ok<StateResponse>(res, getState())
})

app.post('/api/player/pause', (_req, res) => {
  setPaused(true)
  ok<StateResponse>(res, getState())
})

app.post('/api/player/resume', (_req, res) => {
  setPaused(false)
  ok<StateResponse>(res, getState())
})

app.get('/api/fallback', (_req, res) => {
  ok<FallbackStateResponse>(res, getFallbackState())
})

app.post('/api/fallback/refresh', async (_req, res) => {
  try {
    ok<FallbackStateResponse>(res, await refreshFallback())
  } catch {
    fail(res, 'не удалось обновить плейлист, проверь ID', 'FALLBACK_REFRESH_FAILED', 400)
  }
})

app.post('/api/fallback/shuffle', (_req, res) => {
  try {
    ok<FallbackStateResponse>(res, toggleFallbackShuffle())
  } catch {
    fail(res, 'не удалось изменить shuffle', 'FALLBACK_SHUFFLE_FAILED', 400)
  }
})

app.post('/api/fallback/repeat', (_req, res) => {
  try {
    ok<FallbackStateResponse>(res, toggleFallbackRepeat())
  } catch {
    fail(res, 'не удалось изменить repeat', 'FALLBACK_REPEAT_FAILED', 400)
  }
})

app.post('/api/fallback/enabled', (_req, res) => {
  try {
    ok<FallbackStateResponse>(res, toggleFallbackEnabled())
  } catch {
    fail(res, 'не удалось изменить состояние fallback', 'FALLBACK_ENABLED_FAILED', 400)
  }
})

app.delete('/api/queue/:index', (req, res) => {
  const index = Number(req.params.index)

  if (!Number.isInteger(index) || index < 0) {
    return fail(res, 'некорректный индекс', 'INVALID_INDEX', 400)
  }

  const removed = removeAt(index)

  if (!removed) {
    return fail(res, 'элемент очереди не найден', 'QUEUE_ITEM_NOT_FOUND', 404)
  }

  ok<QueueRemoveResponse>(res, { removed, state: getState() })
})

app.post('/api/queue/clear', (_req, res) => {
  clearQueue()
  ok<StateResponse>(res, getState())
})

app.get('/api/secrets', (_req, res) => {
  ok<SecretsResponse>(res, getPublicSecretsView())
})

app.put('/api/secrets', (req, res) => {
  updateSecrets(req.body ?? {})
  ok<SecretsResponse>(res, getPublicSecretsView())
})

app.use('/api', (_req, res) => {
  fail(res, 'API endpoint not found', 'NOT_FOUND', 404)
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log(`[ERROR] ${err.message}`)
  fail(res, 'внутренняя ошибка сервера', 'SERVER_ERROR', 500)
})

app.listen(PORT, async () => {
  log(`Server running on http://localhost:${PORT}`)
  await refreshFallback()
  if (!getState().current) {
    moveToNext()
  }
  open(`http://localhost:${PORT}`).catch(() => {})
})
