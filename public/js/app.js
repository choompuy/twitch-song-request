const log = createLogger('CONTROL')

let activeTab = 'dashboard'
let player = null
let playerReady = false

const state = {
  current: null,
  queue: [],
  isPaused: false,
  nextTrack: null,
  settings: {
    showVideo: true,
    position: 'bottom-right'
  },
  config: null,
  fallback: null,
  playlists: [],
  network: null,
  selectedIp: null,
  activity: []
}

const dom = {
  showVideo: $('showVideo'),
  badgePosition: $('badgePosition'),
  previewUrl: $('previewUrl'),
  selectIp: $('selectIp'),
  controlPanelQr: $('controlPanelQr'),

  cfgMinViews: $('cfgMinViews'),
  cfgMinDuration: $('cfgMinDuration'),
  cfgMaxDuration: $('cfgMaxDuration'),
  cfgMaxQueue: $('cfgMaxQueue'),
  cfgMaxPerUser: $('cfgMaxPerUser'),

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

  nextPlaying: $('nextPlaying'),
  nextThumbnail: $('nextThumbnail'),
  nextTitle: $('nextTitle'),
  nextChannel: $('nextChannel'),
  nextDuration: $('nextDuration'),
  nextRequester: $('nextRequester'),

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
  fallbackEnabledToggle: $('fallbackEnabledToggle'),

  playlistUrlInput: $('playlistUrlInput'),
  playlistAddBtn: $('playlistAddBtn'),
  playlistsList: $('playlistsList'),
  playlistsCount: $('playlistsCount'),
  playlistError: $('playlistError'),

  activityList: $('activityList'),
  statQueueLength: $('statQueueLength'),
  statAcceptedToday: $('statAcceptedToday'),
  statRejectedToday: $('statRejectedToday'),
  statFallbackCount: $('statFallbackCount')
}

const CONFIG_FIELDS = [
  { key: 'minViews', dom: 'cfgMinViews', type: 'number' },
  { key: 'minDurationSeconds', dom: 'cfgMinDuration', type: 'number' },
  { key: 'maxDurationSeconds', dom: 'cfgMaxDuration', type: 'number' },
  { key: 'maxQueueSize', dom: 'cfgMaxQueue', type: 'number' },
  { key: 'maxRequestsPerUser', dom: 'cfgMaxPerUser', type: 'number' }
]

const YOUTUBE_URL_PATTERN =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/

function switchTab(tabName) {
  const wasStream = activeTab === 'dashboard'
  activeTab = tabName

  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tabName)
  })
  document.querySelectorAll('.btn-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tabTarget === tabName)
  })

  if (!wasStream && tabName === 'dashboard') {
    refreshState()
    refreshFallbackState()
  }
}

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

  search: (query) => request(`/api/search?q=${encodeURIComponent(query)}&admin=1`),

  requestSong: (query) =>
    request('/api/queue/request', {
      method: 'POST',
      body: JSON.stringify({
        query,
        requestedBy: 'ControlPanel',
        admin: true
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
    }),

  playFallback: (videoId) =>
    request(`/api/fallback/play/${encodeURIComponent(videoId)}`, {
      method: 'POST'
    }),

  enqueueFallback: (videoId) =>
    request(`/api/fallback/enqueue/${encodeURIComponent(videoId)}`, {
      method: 'POST'
    }),

  getNetworkInfo: () => request('/api/network-info'),

  getPlaylists: () => request('/api/playlists'),

  addPlaylist: (playlistId) =>
    request('/api/playlists', {
      method: 'POST',
      body: JSON.stringify({ playlistId })
    }),

  removePlaylist: (id) =>
    request(`/api/playlists/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),

  activatePlaylist: (id) =>
    request(`/api/playlists/${encodeURIComponent(id)}/activate`, {
      method: 'POST'
    }),

  getActivity: () => request('/api/activity')
}

async function loadActivity() {
  try {
    const data = await api.getActivity()
    state.activity = data.entries ?? []
    renderActivity()
  } catch (error) {
    log('Error loading activity:', error)
  }
}

function timeAgo(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function renderActivity() {
  if (!dom.activityList) return

  if (!state.activity.length) {
    dom.activityList.innerHTML = EMPTY('No requests yet')
    return
  }

  dom.activityList.innerHTML = state.activity
    .map((entry) => {
      const title = entry.title || entry.query
      return `
        <div class="row-wrapper">
          <div class="row flex-1">
            <div class="row-info">
              <div class="row-title text-sm text-primary">${escapeHtml(title)}</div>
              <div class="text-xs text-green">@${escapeHtml(entry.requestedBy)} · ${timeAgo(entry.at)}</div>
              ${entry.reason ? `<div class="activity-reason">${escapeHtml(entry.reason)}</div>` : ''}
            </div>
          </div>
          <span class="status-pill ${entry.status}">${entry.status}</span>
        </div>
      `
    })
    .join('')
}

function renderStats() {
  if (dom.statQueueLength) dom.statQueueLength.textContent = state.queue.length

  const accepted = state.activity.filter((e) => e.status === 'accepted').length
  const rejected = state.activity.filter((e) => e.status === 'rejected').length

  if (dom.statAcceptedToday) dom.statAcceptedToday.textContent = accepted
  if (dom.statRejectedToday) dom.statRejectedToday.textContent = rejected
  if (dom.statFallbackCount) dom.statFallbackCount.textContent = state.fallback?.sourceCount ?? 0
}

async function loadPreviewSettings() {
  try {
    state.settings = await api.getSettings()

    if (dom.showVideo) {
      dom.showVideo.checked = Boolean(state.settings.showVideo)
    }
    if (dom.badgePosition) {
      dom.badgePosition.value = state.settings.position || 'bottom-right'
    }
  } catch (error) {
    log('Error loading settings:', error)
  }
}

async function savePreviewSettings() {
  try {
    state.settings.showVideo = dom.showVideo.checked
    state.settings.position = dom.badgePosition ? dom.badgePosition.value : state.settings.position

    await api.updateSettings(state.settings)

    syncPlayer()
  } catch (error) {
    log('Error saving settings:', error)
  }
}

function copyPreviewUrl() {
  if (!dom.previewUrl) return
  navigator.clipboard?.writeText(dom.previewUrl.href).catch((error) => log('Copy failed:', error))
}

async function loadNetworkInfo() {
  try {
    state.network = await api.getNetworkInfo()

    if (!state.network.ips.length) {
      state.selectedIp = 'localhost'
    } else if (!state.selectedIp) {
      state.selectedIp = state.network.ips[0]
    }

    renderQrUrl()
  } catch (error) {
    log('Error loading network info:', error)
  }
}

function renderQrUrl() {
  const host = state.selectedIp === 'localhost' ? 'localhost' : state.selectedIp
  const port = state.network?.port ?? location.port
  const url = `http://${host}${port ? `:${port}` : ''}`

  if (dom.selectIp) {
    const ips = state.network?.ips ?? []

    if (ips.length > 1) {
      dom.selectIp.classList.remove('hidden')
      dom.selectIp.innerHTML = ips
        .map((ip) => `<option value="${escapeHtml(ip)}" ${ip === state.selectedIp ? 'selected' : ''}>${escapeHtml(ip)}</option>`)
        .join('')
    } else {
      dom.selectIp.classList.add('hidden')
    }
  }

  if (dom.controlPanelQr && !dom.controlPanelQr.classList.contains('hidden')) {
    if (!dom.controlPanelQr || typeof QRCode === 'undefined') return
    dom.controlPanelQr.innerHTML = ''
    new QRCode(dom.controlPanelQr, { text: url, width: 128, height: 128 })
  }
}

function onIpChange() {
  state.selectedIp = dom.selectIp.value
  renderQrUrl()
}

function toggleQr() {
  if (!dom.controlPanelQr) return
  dom.controlPanelQr.classList.toggle('hidden')
  if (!dom.controlPanelQr.classList.contains('hidden')) {
    renderQrUrl(state.selectedIp)
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
    const trackChanged = state.current?.videoId !== nextState.current?.videoId

    state.current = nextState.current
    state.queue = nextState.queue ?? []
    state.isPaused = Boolean(nextState.isPaused)
    state.nextTrack = nextState.nextTrack ?? null

    renderState()

    if (trackChanged) {
      await refreshFallbackState()
    }
  } catch (error) {
    log('Error fetching state:', error)
  }
}

function renderState() {
  renderCurrent()
  renderNext()
  renderQueue()
  renderPlayPause()
  renderStats()

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
  dom.currentThumbnail.alt = state.current.title
  dom.currentTitle.textContent = state.current.title
  dom.currentChannel.textContent = state.current.channelTitle
  dom.currentViews.textContent = `${formatViews(state.current.views)} views`
  dom.currentDuration.textContent = formatDuration(state.current.duration)
  dom.currentRequester.textContent = `@${state.current.requestedBy}`
}

function renderNext() {
  if (!state.nextTrack) {
    dom.nextPlaying.classList.add('hidden')
    return
  }

  dom.nextPlaying.classList.remove('hidden')
  dom.nextThumbnail.src = state.nextTrack.thumbnail
  dom.nextThumbnail.alt = state.nextTrack.title
  dom.nextTitle.textContent = state.nextTrack.title
  dom.nextChannel.textContent = state.nextTrack.channelTitle
  dom.nextDuration.textContent = formatDuration(state.nextTrack.duration)
  dom.nextRequester.textContent = state.nextTrack.source === 'queue' ? `@${state.nextTrack.requestedBy}` : '@Jam'
}

let lastQueueKey = ''

function renderQueue() {
  const maxQueueSize = state.config?.maxQueueSize ?? 0

  dom.queueCount.textContent = `${state.queue.length}/${maxQueueSize}`

  const queueKey = state.queue.map((item) => `${item.videoId}:${item.requestedBy}`).join('|')

  if (queueKey === lastQueueKey) return

  if (!state.queue.length) {
    dom.queueList.innerHTML = EMPTY('Queue is empty')
    lastQueueKey = ''
    return
  }

  lastQueueKey = queueKey

  dom.queueList.innerHTML = state.queue
    .map(
      (item, index) => `
        <div class="row-wrapper" data-queue-index="${index}">
          <div class="row flex-1">
            <span class="text-secondary">#${index + 1}</span>
            <img src="${escapeHtml(item.thumbnail)}" class="thumbnail" alt="${escapeHtml(item.title)}">
            <div class="row-info">
              <div class="row-title text-sm text-primary">${escapeHtml(item.title)}</div>
              <div class="text-xs text-green">@${escapeHtml(item.requestedBy)}</div>
            </div>
            <span class="text-sm text-secondary">${formatDuration(item.duration)}</span>
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
  dom.playPauseBtn.title = state.isPaused ? 'Resume' : 'Pause'
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
        <div class="row-wrapper row-hover" data-action="add" data-video-id="${escapeHtml(song.videoId)}">
          <img src="${escapeHtml(song.thumbnail)}" class="thumbnail" alt="${escapeHtml(song.title)}">
          <div class="row-info">
            <div class="row-title text-sm text-primary">${escapeHtml(song.title)}</div>
            <div class="text-xs text-secondary">${escapeHtml(song.channelTitle)}</div>
          </div>
          <span class="text-sm text-secondary">${formatDuration(song.duration)}</span>
          <div class="row-tag">${PLUS_ICON}</div>
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
      await loadActivity()
      return
    }

    dom.searchInput.value = ''
    clearSearchResults()

    await refreshState()
    await loadActivity()
  } catch (error) {
    log('Error adding song:', error)
    showSearchError(error.message || 'Error adding video')
    await loadActivity()
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

let lastFallbackKey = ''

function renderFallback() {
  const data = state.fallback

  if (!data?.upNext?.length) {
    dom.fallbackInfo.innerHTML = ''
    dom.fallbackList.innerHTML = EMPTY('Fallback is empty')

    dom.fallbackShuffleBtn.classList.remove('active')
    dom.fallbackRepeatBtn.classList.remove('active')
    dom.fallbackEnabledToggle.checked = false
    lastFallbackKey = ''
    renderStats()
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
  renderStats()

  const fallbackKey = `${data.activeVideoId}|${data.upNext.map((t) => `${t.videoId}:${t.isPlayed}`).join(',')}`
  if (fallbackKey === lastFallbackKey) return
  lastFallbackKey = fallbackKey

  dom.fallbackList.innerHTML = data.upNext
    .map((track) => {
      const isActive = track.videoId === data.activeVideoId
      const rowClass = isActive ? 'row-active' : track.isPlayed ? 'row-played' : ''

      return `
        <div class="row-wrapper ${rowClass}" data-video-id="${escapeHtml(track.videoId)}">
          <div class="row flex-1">
            <img src="${escapeHtml(track.thumbnail)}" class="thumbnail" alt="${escapeHtml(track.title)}">
            <div class="row-info">
              <div class="row-title text-sm text-primary">${escapeHtml(track.title)}</div>
              <div class="text-xs text-secondary">${escapeHtml(track.channelTitle)}</div>
            </div>
            <span class="text-sm text-secondary">${formatDuration(track.duration)}</span>
          </div>
          <div class="row-tag row">
            <button class="btn btn-icon" data-action="fallback-enqueue" data-video-id="${escapeHtml(track.videoId)}" title="Add to queue">${PLUS_ICON}</button>
            <button class="btn btn-icon" data-action="fallback-play" data-video-id="${escapeHtml(track.videoId)}" title="Play now">${PLAY_ICON}</button>
          </div>
        </div>
      `
    })
    .join('')

  const activeRow = dom.fallbackList.querySelector(`[data-video-id="${CSS.escape(data.activeVideoId)}"]`)

  if (activeRow) {
    const container = dom.fallbackList
    const top = activeRow.offsetTop - container.offsetTop - (container.clientHeight - activeRow.offsetHeight) / 2

    dom.fallbackList.scrollTo({
      top: Math.max(0, top),
      behavior: 'smooth'
    })
  }
}

async function refreshFallback() {
  await withLoading(dom.fallbackRefreshBtn, async () => {
    try {
      await api.refreshFallback()
      await refreshFallbackState()
    } catch (error) {
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
  }
}

async function playFallbackNow(videoId) {
  try {
    await api.playFallback(videoId)
    await refreshState()
  } catch (error) {
    log('Error playing fallback track:', error)
  }
}

async function enqueueFallbackTrack(videoId) {
  try {
    await api.enqueueFallback(videoId)
    await refreshState()
  } catch (error) {
    log('Error queueing fallback track:', error)
  }
}

dom.fallbackList?.addEventListener('click', (event) => {
  const playBtn = event.target.closest('[data-action="fallback-play"]')
  const enqueueBtn = event.target.closest('[data-action="fallback-enqueue"]')

  if (playBtn) return playFallbackNow(playBtn.dataset.videoId)
  if (enqueueBtn) return enqueueFallbackTrack(enqueueBtn.dataset.videoId)
})

async function loadPlaylists() {
  try {
    const data = await api.getPlaylists()
    state.playlists = data.playlists ?? []
    renderPlaylists()
  } catch (error) {
    log('Error loading playlists:', error)
  }
}

function renderPlaylists() {
  if (!dom.playlistsList) return

  if (dom.playlistsCount) dom.playlistsCount.textContent = state.playlists.length

  if (!state.playlists.length) {
    dom.playlistsList.innerHTML = `
      <div class="playlist-empty-hint">
        <div class="empty">No saved playlists yet</div>
        <div class="text-sm text-muted">Add a YouTube playlist above, then activate it to use as your fallback rotation.</div>
      </div>
    `
    return
  }

  const activeId = state.config?.fallbackPlaylist?.playlistId

  dom.playlistsList.innerHTML = state.playlists
    .map((playlist) => {
      const isActive = playlist.id === activeId
      return `
        <div class="row-wrapper ${isActive ? 'row-active' : ''}">
          <div class="row flex-1">
            <img src="${escapeHtml(playlist.thumbnail)}" class="thumbnail" alt="${escapeHtml(playlist.title)}">
            <div class="row-info">
              <div class="row-title text-sm text-primary">${escapeHtml(playlist.title)}</div>
              <div class="text-xs text-secondary">${playlist.itemCount} tracks${isActive ? ' · active' : ''}</div>
            </div>
          </div>
          <div class="row-tag row">
            <button class="btn btn-icon ${isActive ? 'active' : ''}" data-action="playlist-activate" data-id="${escapeHtml(playlist.id)}" title="${isActive ? 'Active' : 'Activate'}">
              ${isActive ? CHECK_ICON : PLAY_ICON}
            </button>
            <button class="btn btn-icon btn-danger" data-action="playlist-delete" data-id="${escapeHtml(playlist.id)}" title="Delete">${DELETE_ICON}</button>
          </div>
        </div>
      `
    })
    .join('')
}

async function addPlaylist() {
  const value = dom.playlistUrlInput.value.trim()
  dom.playlistError.classList.add('hidden')

  if (!value) return

  await withLoading(dom.playlistAddBtn, async () => {
    try {
      const result = await api.addPlaylist(value)

      if (!result.success) {
        dom.playlistError.textContent = result.error || 'Error adding playlist'
        dom.playlistError.classList.remove('hidden')
        return
      }

      dom.playlistUrlInput.value = ''
      await loadPlaylists()
    } catch (error) {
      dom.playlistError.textContent = error.message || 'Error adding playlist'
      dom.playlistError.classList.remove('hidden')
    }
  })
}

async function activatePlaylist(id) {
  try {
    state.config = await api.activatePlaylist(id)
    renderPlaylists()
    await refreshFallbackState()
  } catch (error) {
    log('Error activating playlist:', error)
  }
}

async function deletePlaylist(id) {
  if (!confirm('Remove this playlist?')) return

  try {
    await api.removePlaylist(id)
    await loadPlaylists()
  } catch (error) {
    log('Error deleting playlist:', error)
  }
}

dom.playlistsList?.addEventListener('click', (event) => {
  const activateBtn = event.target.closest('[data-action="playlist-activate"]')
  const deleteBtn = event.target.closest('[data-action="playlist-delete"]')

  if (activateBtn) return activatePlaylist(activateBtn.dataset.id)
  if (deleteBtn) return deletePlaylist(deleteBtn.dataset.id)
})

dom.playlistUrlInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addPlaylist()
})

document.querySelectorAll('.btn-tab').forEach((el) => {
  el.addEventListener('click', (event) => {
    switchTab(el.dataset.tabTarget)
  })
})

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
  await Promise.allSettled([
    loadSecrets(),
    loadConfig(),
    loadPreviewSettings(),
    loadNetworkInfo(),
    loadPlaylists(),
    loadActivity(),
    refreshState(),
    refreshFallbackState()
  ])

  setInterval(() => {
    if (activeTab === 'dashboard') refreshState()
  }, 2000)

  setInterval(() => {
    if (activeTab === 'dashboard') refreshFallbackState()
  }, 30000)

  setInterval(() => {
    if (activeTab === 'dashboard') loadActivity()
  }, 5000)

  log('Control panel initialized')
}

init()
