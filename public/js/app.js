const log = createLogger('CONTROL')

let player = null
let playerReady = false

const state = {
  current: null,
  queue: [],
  isPaused: false,
  settings: {
    showVideo: true
  },
  config: null,
  fallback: null
}

const dom = {
  showVideo: $('showVideo'),

  cfgMinViews: $('cfgMinViews'),
  cfgMinDuration: $('cfgMinDuration'),
  cfgMaxDuration: $('cfgMaxDuration'),
  cfgMaxQueue: $('cfgMaxQueue'),
  cfgMaxPerUser: $('cfgMaxPerUser'),
  cfgFallbackPlaylist: $('cfgFallbackPlaylist'),

  secYoutubeKey: $('secYoutubeKey'),
  secretsStatus: $('secretsStatus'),

  nowPlaying: $('nowPlaying'),
  noPlaying: $('noPlaying'),
  currentThumbnail: $('currentThumbnail'),
  currentTitle: $('currentTitle'),
  currentChannel: $('currentChannel'),
  currentViews: $('currentViews'),
  currentDuration: $('currentDuration'),
  currentRequester: $('currentRequester'),

  queueList: $('queueList'),
  queueCount: $('queueCount'),

  searchInput: $('searchInput'),
  searchResults: $('searchResults'),
  searchError: $('searchError'),
  searchBtn: $('searchBtn'),

  playPauseBtn: $('playPauseBtn'),
  clearQueueBtn: $('clearQueueBtn'),

  fallbackInfo: $('fallbackInfo'),
  fallbackList: $('fallbackList'),
  fallbackRefreshBtn: $('fallbackRefreshBtn'),
  fallbackRepeatBtn: $('fallbackRepeatBtn'),
  fallbackShuffleBtn: $('fallbackShuffleBtn'),
  fallbackEnabledToggle: $('fallbackEnabledToggle')
}

const CONFIG_FIELDS = [
  { key: 'minViews', dom: 'cfgMinViews', type: 'number' },
  { key: 'minDurationSeconds', dom: 'cfgMinDuration', type: 'number' },
  { key: 'maxDurationSeconds', dom: 'cfgMaxDuration', type: 'number' },
  { key: 'maxQueueSize', dom: 'cfgMaxQueue', type: 'number' },
  { key: 'maxRequestsPerUser', dom: 'cfgMaxPerUser', type: 'number' },
  {
    key: 'playlistId',
    path: 'fallbackPlaylist',
    dom: 'cfgFallbackPlaylist',
    type: 'text'
  }
]

const YOUTUBE_URL_PATTERN =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  let data = null

  try {
    data = await response.json()
  } catch {
    // Empty/non-JSON response
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`)
  }

  return data
}

async function withLoading(button, action) {
  if (!button) return action()

  button.disabled = true

  try {
    return await action()
  } finally {
    button.disabled = false
  }
}

const api = {
  getSettings: () => request('/api/settings'),

  updateSettings: (settings) =>
    request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    }),

  getConfig: () => request('/api/config'),

  updateConfig: (config) =>
    request('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    }),

  getSecrets: () => request('/api/secrets'),

  updateSecrets: (secrets) =>
    request('/api/secrets', {
      method: 'PUT',
      body: JSON.stringify(secrets)
    }),

  getState: () => request('/api/state'),

  search: (query) => request(`/api/search?q=${encodeURIComponent(query)}`),

  requestSong: (query) =>
    request('/api/queue/request', {
      method: 'POST',
      body: JSON.stringify({
        query,
        requestedBy: 'ControlPanel'
      })
    }),

  removeFromQueue: (index) =>
    request(`/api/queue/${index}`, {
      method: 'DELETE'
    }),

  clearQueue: () =>
    request('/api/queue/clear', {
      method: 'POST'
    }),

  skip: () =>
    request('/api/player/skip', {
      method: 'POST'
    }),

  pause: () =>
    request('/api/player/pause', {
      method: 'POST'
    }),

  resume: () =>
    request('/api/player/resume', {
      method: 'POST'
    }),

  getFallback: () => request('/api/fallback'),

  refreshFallback: () =>
    request('/api/fallback/refresh', {
      method: 'POST'
    }),

  shuffleFallback: () =>
    request('/api/fallback/shuffle', {
      method: 'POST'
    }),

  repeatFallback: () =>
    request('/api/fallback/repeat', {
      method: 'POST'
    }),

  enabledFallback: () =>
    request('/api/fallback/enabled', {
      method: 'POST'
    })
}

async function loadPreviewSettings() {
  try {
    state.settings = await api.getSettings()

    if (dom.showVideo) {
      dom.showVideo.checked = Boolean(state.settings.showVideo)
    }
  } catch (error) {
    log('Error loading settings:', error)
  }
}

async function savePreviewSettings() {
  try {
    state.settings.showVideo = dom.showVideo.checked

    await api.updateSettings(state.settings)

    syncPlayer()
  } catch (error) {
    log('Error saving settings:', error)
  }
}

async function loadConfig() {
  try {
    state.config = await api.getConfig()

    for (const field of CONFIG_FIELDS) {
      const input = dom[field.dom]
      if (!input) continue

      const value = field.path ? state.config[field.path]?.[field.key] : state.config[field.key]
      input.value = value ?? ''
    }
  } catch (error) {
    log('Error loading config:', error)
  }
}

async function loadSecrets() {
  try {
    const data = await api.getSecrets()
    dom.secretsStatus.textContent = data.hasYoutubeApiKey ? 'YouTube API key is configured' : 'YouTube API key is not configured'
  } catch (error) {
    log('Error loading secrets:', error)
  }
}

async function saveConfigSetting() {
  const config = {}

  for (const field of CONFIG_FIELDS) {
    const input = dom[field.dom]
    if (!input) continue

    const value = field.type === 'number' ? Number(input.value) : input.value.trim()

    if (field.path) {
      config[field.path] ??= {}
      config[field.path][field.key] = value
    } else {
      config[field.key] = value
    }
  }

  const youtubeApiKey = dom.secYoutubeKey.value.trim()

  try {
    state.config = await api.updateConfig(config)

    if (youtubeApiKey) {
      await api.updateSecrets({ youtubeApiKey })
      dom.secYoutubeKey.value = ''
      await loadSecrets()
    }
  } catch (error) {
    log('Error saving settings:', error)
  }
}

async function refreshState() {
  try {
    const nextState = await api.getState()

    state.current = nextState.current
    state.queue = nextState.queue ?? []
    state.isPaused = Boolean(nextState.isPaused)

    renderState()
  } catch (error) {
    log('Error fetching state:', error)
  }
}

function renderState() {
  renderCurrent()
  renderQueue()
  renderPlayPause()

  syncPlayer()
}

function renderCurrent() {
  if (!state.current) {
    dom.nowPlaying.classList.add('hidden')
    dom.noPlaying.style.display = 'block'
    return
  }

  dom.nowPlaying.classList.remove('hidden')
  dom.noPlaying.style.display = 'none'

  dom.currentThumbnail.src = state.current.thumbnail
  dom.currentTitle.textContent = state.current.title
  dom.currentChannel.textContent = state.current.channelTitle
  dom.currentViews.textContent = `${formatViews(state.current.views)} views`
  dom.currentDuration.textContent = formatDuration(state.current.duration)
  dom.currentRequester.textContent = `@${state.current.requestedBy}`
}

let lastQueueKey = ''

function renderQueue() {
  const maxQueueSize = state.config?.maxQueueSize ?? 0

  dom.queueCount.textContent = `${state.queue.length}/${maxQueueSize}`

  const queueKey = state.queue.map((item) => `${item.videoId}:${item.requestedBy}`).join('|')

  if (queueKey === lastQueueKey) return

  lastQueueKey = queueKey

  if (!state.queue.length) {
    dom.queueList.innerHTML = '<div class="empty">Queue is empty</div>'

    return
  }

  dom.queueList.innerHTML = state.queue
    .map(
      (item, index) => `
        <div class="row" data-queue-index="${index}">
          <div class="row flex-1">
            <span class="text-secondary">#${index + 1}</span>

            <img
              src="${escapeHtml(item.thumbnail)}"
              class="thumbnail-img"
              alt="${escapeHtml(item.title)}"
            >

            <div class="row-info">
              <div class="row-title text-sm text-primary">
                ${escapeHtml(item.title)}
              </div>

              <div class="text-xs text-green">
                @${escapeHtml(item.requestedBy)}
              </div>
            </div>

            <span class="text-sm text-secondary">
              ${formatDuration(item.duration)}
            </span>
          </div>

          <button
            class="row-tag btn btn-icon btn-danger"
            data-action="remove"
            data-index="${index}"
            aria-label="Remove from queue"
          >
            ${DELETE_ICON}
          </button>
        </div>
      `
    )
    .join('')
}

function syncPlayer() {
  if (!playerReady || !player) return

  if (!state.current) {
    player.stopVideo()
    return
  }

  const currentVideoId = player.getVideoData()?.video_id

  if (currentVideoId === state.current.videoId) {
    return
  }

  log(`Loading video: ${state.current.videoId}`)

  player.cueVideoById(state.current.videoId)

  if (!state.settings.showVideo) {
    player.setPlaybackQuality('tiny')
  }
}

function renderPlayPause() {
  dom.playPauseBtn.innerHTML = state.isPaused ? PLAY_ICON : PAUSE_ICON
}

async function playPauseCurrent() {
  try {
    if (state.isPaused) {
      await api.resume()
    } else {
      await api.pause()
    }

    await refreshState()
  } catch (error) {
    log('Error play/pause:', error)
  }
}

async function skipCurrent() {
  try {
    await api.skip()
    await refreshState()
  } catch (error) {
    log('Error skipping:', error)
  }
}

function showSearchError(message) {
  dom.searchError.textContent = message
  dom.searchError.classList.remove('hidden')
}

function clearSearchResults() {
  dom.searchResults.innerHTML = ''
  dom.searchResults.classList.add('hidden')
  dom.searchError.classList.add('hidden')
}

async function search() {
  const query = dom.searchInput.value.trim()

  if (!query) return

  clearSearchResults()

  await withLoading(dom.searchBtn, async () => {
    try {
      if (YOUTUBE_URL_PATTERN.test(query)) {
        await addSong(query)
        return
      }

      const data = await api.search(query)

      if (!data.success) {
        showSearchError(data.error || 'Error searching')
        return
      }

      if (!data.results?.length) {
        showSearchError('No results found')
        return
      }

      renderSearchResults(data.results)
    } catch (error) {
      log('Search error:', error)
      showSearchError(error.message || 'Error searching')
    }
  })
}

function renderSearchResults(results) {
  dom.searchResults.innerHTML = results
    .map(
      (song) => `
        <div
          class="row row-hover"
          data-action="add"
          data-video-id="${escapeHtml(song.videoId)}"
        >
          <img
            src="${escapeHtml(song.thumbnail)}"
            class="thumbnail-img"
            alt="${escapeHtml(song.title)}"
          >

          <div class="row-info">
            <div class="row-title text-sm text-primary">
              ${escapeHtml(song.title)}
            </div>

            <div class="row-sub text-xs text-secondary">
              ${escapeHtml(song.channelTitle)}
              • ${formatDuration(song.duration)}
              • ${formatViews(song.views)} views
            </div>
          </div>

          <div class="row-tag">
            ${PLUS_ICON}
          </div>
        </div>
      `
    )
    .join('')

  dom.searchResults.classList.remove('hidden')
}

async function addSong(query) {
  try {
    const result = await api.requestSong(query)

    if (!result.success) {
      showSearchError(result.error || 'Error adding video')
      return
    }

    dom.searchInput.value = ''
    clearSearchResults()

    await refreshState()
  } catch (error) {
    log('Error adding song:', error)
    showSearchError(error.message || 'Error adding video')
  }
}

async function removeFromQueue(index) {
  try {
    await api.removeFromQueue(index)
    await refreshState()
  } catch (error) {
    log('Error removing from queue:', error)
  }
}

async function clearQueue() {
  if (!confirm('Clear entire queue?')) return

  await withLoading(dom.clearQueueBtn, async () => {
    try {
      await api.clearQueue()
      await refreshState()
    } catch (error) {
      log('Error clearing queue:', error)
    }
  })
}

async function refreshFallbackState() {
  try {
    state.fallback = await api.getFallback()
    renderFallback()
  } catch (error) {
    log('Error fetching fallback playlist:', error)
  }
}

function renderFallback() {
  const data = state.fallback

  if (!data?.upNext?.length) {
    dom.fallbackInfo.innerHTML = ''
    dom.fallbackList.innerHTML = '<div class="empty">Fallback is empty</div>'

    return
  }

  const date = data.lastRefreshedAt ? new Date(data.lastRefreshedAt) : null

  const formattedDate = date
    ? new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date)
    : '—'

  dom.fallbackShuffleBtn.classList.toggle('active', data.shuffle)
  dom.fallbackRepeatBtn.classList.toggle('active', data.repeat)
  dom.fallbackEnabledToggle.checked = data.enabled
  dom.fallbackInfo.textContent = `${data.upNext.length} треков · обновлён ${formattedDate}`
  dom.fallbackList.innerHTML = data.upNext
    .map(
      (track, index) => `
        <div class="row ${index === data.nextIndex ? 'row-active' : ''}">
          <div class="row flex-1">
            <img
              src="${escapeHtml(track.thumbnail)}"
              class="thumbnail-img"
              alt="${escapeHtml(track.title)}"
            >

            <div class="row-info">
              <div class="row-title text-sm text-primary">
                ${escapeHtml(track.title)}
              </div>

              <div class="row-sub text-xs text-secondary">
                ${escapeHtml(track.channelTitle)}
              </div>
            </div>

            <div>
              ${formatDuration(track.duration)}
            </div>
          </div>
        </div>
      `
    )
    .join('')
}

async function refreshFallback() {
  await withLoading(dom.fallbackRefreshBtn, async () => {
    try {
      await api.refreshFallback()
      await refreshFallbackState()
    } catch (error) {
      console.error(error)
      log('Error refreshing fallback:', error)
    }
  })
}

async function toggleFallbackShuffle() {
  try {
    state.fallback = await api.shuffleFallback()
    renderFallback()
  } catch (error) {
    log('Failed to toggle shuffle:', error)
  }
}

async function toggleFallbackRepeat() {
  try {
    state.fallback = await api.repeatFallback()
    renderFallback()
  } catch (error) {
    log('Failed to toggle repeat:', error)
  }
}

async function toggleFallbackEnabled() {
  try {
    state.fallback = await api.enabledFallback()
    renderFallback()
  } catch (error) {
    dom.fallbackEnabledToggle.checked = !dom.fallbackEnabledToggle.checked
    log('Failed to toggle enabled:', error)
    console.error(error)
  }
}

dom.searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    search()
  }
})

dom.queueList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="remove"]')

  if (!button) return

  removeFromQueue(Number(button.dataset.index))
})

dom.searchResults?.addEventListener('click', (event) => {
  const result = event.target.closest('[data-action="add"]')

  if (!result) return

  const videoId = result.dataset.videoId

  if (videoId) {
    addSong(`https://www.youtube.com/watch?v=${videoId}`)
  }
})

function onPlayerReady() {
  log('Player ready')

  playerReady = true

  syncPlayer()
}

function onPlayerError(event) {
  log(`Player error: ${getErrorMessage(event.data)}`)
}

window.onYouTubeIframeAPIReady = () => {
  log('YouTube API ready')

  player = new YT.Player('player', {
    width: '100%',
    height: '100%',

    playerVars: {
      autoplay: 0,
      controls: 1,
      rel: 0
    },

    events: {
      onReady: onPlayerReady,
      onError: onPlayerError
    }
  })
}

async function init() {
  await Promise.allSettled([loadSecrets(), loadConfig(), loadPreviewSettings(), refreshState(), refreshFallbackState()])

  setInterval(refreshState, 2000)
  setInterval(refreshFallbackState, 10000)

  log('Control panel initialized')
}

init()
