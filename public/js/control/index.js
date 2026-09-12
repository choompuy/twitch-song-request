const log = createLogger('CONTROL')

let activeTab = 'dashboard'
let activeSection = 'queue'
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
  currentTitle: $('currentTitle'),
  currentChannel: $('currentChannel'),
  currentDuration: $('currentDuration'),
  currentViews: $('currentViews'),
  currentRequester: $('currentRequester'),

  nextPlaying: $('nextPlaying'),
  nextTitle: $('nextTitle'),
  nextDuration: $('nextDuration'),

  playPauseBtn: $('playPauseBtn'),
  clearQueueBtn: $('clearQueueBtn'),

  searchInput: $('searchInput'),
  searchListWrapper: $('searchListWrapper'),
  searchError: $('searchError'),
  searchBtn: $('searchBtn'),

  statQueueLength: $('statQueueLength'),
  statAcceptedToday: $('statAcceptedToday'),
  statRejectedToday: $('statRejectedToday'),
  statFallbackCount: $('statFallbackCount'),

  sectionTabs: $('sectionTabs'),
  tabQueueCount: $('tabQueueCount'),
  tabJamCount: $('tabJamCount'),
  tabRecentCount: $('tabRecentCount'),

  queueListWrapper: $('queueListWrapper'),
  queueCount: $('queueCount'),

  fallbackListWrapper: $('fallbackListWrapper'),
  fallbackInfo: $('fallbackInfo'),
  fallbackRefreshBtn: $('fallbackRefreshBtn'),
  fallbackRepeatBtn: $('fallbackRepeatBtn'),
  fallbackShuffleBtn: $('fallbackShuffleBtn'),
  fallbackEnabledBtn: $('fallbackEnabledBtn'),
  fallbackEnabledText: $('fallbackEnabledText'),

  activityListWrapper: $('activityListWrapper'),
  clearActivityBtn: $('clearActivityBtn'),

  playlistsListWrapper: $('playlistsListWrapper'),
  playlistUrlInput: $('playlistUrlInput'),
  playlistAddBtn: $('playlistAddBtn'),
  playlistsCount: $('playlistsCount'),
  playlistError: $('playlistError')
}

const views = createViews(dom)

const CONFIG_FIELDS = [
  { key: 'minViews', dom: 'cfgMinViews', type: 'number' },
  { key: 'minDurationSeconds', dom: 'cfgMinDuration', type: 'number' },
  { key: 'maxDurationSeconds', dom: 'cfgMaxDuration', type: 'number' },
  { key: 'maxQueueSize', dom: 'cfgMaxQueue', type: 'number' },
  { key: 'maxRequestsPerUser', dom: 'cfgMaxPerUser', type: 'number' }
]

const YOUTUBE_URL_PATTERN =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/

/* =========================================================
 * PAGE / SECTION
 * ========================================================= */

function switchPageTab(tabName) {
  const wasDashboard = activeTab === 'dashboard'
  if (activeTab === tabName) return

  activeTab = tabName
  document.querySelectorAll('.page-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.pageTab === tabName)
  })
  document.querySelectorAll('.btn-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.pageTabTarget === tabName)
  })

  if (!wasDashboard && tabName === 'dashboard') {
    refreshState()
    refreshFallbackState()
  }
}

function switchSection(sectionName) {
  if (activeSection === sectionName) return

  activeSection = sectionName
  const wrapper = document.querySelector('.section-tabs-wrapper')

  wrapper.querySelectorAll('.section-panel').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.section !== sectionName)
    if (el.dataset.section === 'jam') scrollToActiveFallback()
  })
  wrapper.querySelectorAll('.section-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.sectionTarget === sectionName)
  })
}

/* =========================================================
 * STATE
 * ========================================================= */

async function refreshState() {
  try {
    const nextState = await api.getState()
    const trackChanged = state.current?.videoId !== nextState.current?.videoId
    state.current = nextState.current
    state.queue = nextState.queue ?? []
    state.isPaused = Boolean(nextState.isPaused)
    state.nextTrack = nextState.nextTrack ?? null
    renderState()

    if (trackChanged) await refreshFallbackState()
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
  const current = state.current

  if (!current) {
    setHidden(dom.nowPlaying, true)
    setHidden(dom.noPlaying, false)
    return
  }

  setHidden(dom.nowPlaying, false)
  setHidden(dom.noPlaying, true)

  dom.currentTitle.textContent = current.title
  dom.currentChannel.textContent = current.channelTitle
  dom.currentDuration.textContent = formatDuration(current.duration)
  dom.currentViews.textContent = `${formatViews(current.views)} views`
  dom.currentRequester.textContent = current.requestedBy
}

function renderNext() {
  const next = state.nextTrack
  setHidden(dom.nextPlaying, !next)
  if (!next) return

  dom.nextTitle.textContent = next.title
  dom.nextDuration.textContent = formatDuration(next.duration)
}

function renderQueue() {
  const maxQueueSize = state.config?.maxQueueSize ?? 0
  dom.queueCount.textContent = `${state.queue.length}/${maxQueueSize}`

  if (dom.tabQueueCount) dom.tabQueueCount.textContent = state.queue.length

  views.queue.render(state.queue)
}

function renderPlayPause() {
  dom.playPauseBtn.title = state.isPaused ? 'Resume' : 'Pause'
  dom.playPauseBtn.innerHTML = state.isPaused ? PLAY_ICON() : PAUSE_ICON()
}

function renderStats() {
  if (dom.tabJamCount) dom.tabJamCount.textContent = state.fallback?.sourceCount ?? 0
  if (dom.tabRecentCount) dom.tabRecentCount.textContent = state.activity.length
}

/* =========================================================
 * PLAYER
 * ========================================================= */

function syncPlayer() {
  if (!playerReady || !player) return

  if (!state.current) {
    player.stopVideo()
    return
  }

  const currentVideoId = player.getVideoData()?.video_id
  if (currentVideoId === state.current.videoId) return

  log(`Loading video: ${state.current.videoId}`)
  player.cueVideoById(state.current.videoId)

  if (!state.settings.showVideo) player.setPlaybackQuality('tiny')
}

async function playPauseCurrent() {
  try {
    if (state.isPaused) await api.resume()
    else await api.pause()

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

/* =========================================================
 * SEARCH
 * ========================================================= */

function showSearchError(message) {
  dom.searchError.textContent = message
  dom.searchError.classList.remove('hidden')
}

function clearSearchResults() {
  views.search.clear()
  dom.searchListWrapper.classList.add('hidden')
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

      views.search.render(data.results)
      dom.searchListWrapper.classList.remove('hidden')
    } catch (error) {
      log('Search error:', error)
      showSearchError(error.message || 'Error searching')
    }
  })
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

/* =========================================================
 * QUEUE
 * ========================================================= */

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

/* =========================================================
 * FALLBACK
 * ========================================================= */

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
  const tracks = data?.upNext ?? []
  const activeVideoId = data?.activeVideoId ?? ''
  const list = dom.fallbackListWrapper.querySelector('.row-list')

  if (list) list.dataset.activeVideoId = activeVideoId

  toggleActive(dom.fallbackShuffleBtn, data?.shuffle)
  toggleActive(dom.fallbackRepeatBtn, data?.repeat)
  toggleActive(dom.fallbackEnabledBtn, data?.enabled)
  dom.fallbackEnabledText.textContent = data?.enabled ? 'Off' : 'On'

  if (!tracks.length) {
    dom.fallbackInfo.textContent = ''
    views.fallback.render([])
    renderStats()
    return
  }

  dom.fallbackInfo.textContent = `${tracks.length} tracks ▪ updated ${formatDateTime(data.lastRefreshedAt)}`
  views.fallback.render(tracks)
  scrollToActiveFallback()
  renderStats()
}

function scrollToActiveFallback() {
  const activeVideoId = state.fallback?.activeVideoId
  const container = dom.fallbackListWrapper
  const list = container?.querySelector('.row-list')
  if (!activeVideoId || !container || !list) return

  const activeRow = list.querySelector(`[data-video-id="${CSS.escape(activeVideoId)}"]`)
  if (!activeRow) return

  const containerRect = container.getBoundingClientRect()
  const rowRect = activeRow.getBoundingClientRect()
  const rowCenter = rowRect.top + rowRect.height / 2
  const containerCenter = containerRect.top + containerRect.height / 2
  container.scrollBy({
    top: rowCenter - containerCenter,
    behavior: 'smooth'
  })
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
    views.fallback.invalidate()
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

/* =========================================================
 * PLAYLISTS
 * ========================================================= */

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
  if (!dom.playlistsListWrapper) return
  if (dom.playlistsCount) dom.playlistsCount.textContent = state.playlists.length

  const activeId = state.config?.fallbackPlaylist?.playlistId ?? ''
  dom.playlistsListWrapper.dataset.activeId = activeId
  views.playlists.render(state.playlists)
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
    const result = await api.removePlaylist(id)
    await loadPlaylists()
    if (result?.fallbackCleared) {
      state.config = await api.getConfig()
      await refreshFallbackState()
      log('Fallback cleared - active playlist was removed')
    }
  } catch (error) {
    log('Error deleting playlist:', error)
  }
}

/* =========================================================
 * ACTIVITY
 * ========================================================= */

async function loadActivity() {
  try {
    const data = await api.getActivity()
    state.activity = data.entries ?? []
    views.activity.render(state.activity)
    renderStats()
  } catch (error) {
    log('Error loading activity:', error)
  }
}

async function clearActivity() {
  if (!confirm('Clear recent activity?')) return

  await withLoading(dom.clearActivityBtn, async () => {
    try {
      const data = await api.clearActivity()
      state.activity = data.entries ?? []
      views.activity.invalidate()
      views.activity.render(state.activity)
      renderStats()
    } catch (error) {
      log('Error clearing activity:', error)
    }
  })
}

/* =========================================================
 * SETTINGS
 * ========================================================= */

async function loadPreviewSettings() {
  try {
    state.settings = await api.getSettings()

    if (dom.showVideo) dom.showVideo.checked = Boolean(state.settings.showVideo)
    if (dom.badgePosition) dom.badgePosition.value = state.settings.position || 'bottom-right'
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

  navigator.clipboard?.writeText(dom.previewUrl.href).catch((error) => {
    log('Copy failed:', error)
  })
}

async function loadNetworkInfo() {
  try {
    state.network = await api.getNetworkInfo()
    const ips = state.network?.ips ?? []

    if (!ips.length) state.selectedIp = 'localhost'
    else if (!state.selectedIp || !ips.includes(state.selectedIp)) state.selectedIp = ips[0]

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
        .map(
          (ip) => `
            <option value="${escapeHtml(ip)}" ${ip === state.selectedIp ? 'selected' : ''}>
              ${escapeHtml(ip)}
            </option>
          `
        )
        .join('')
    } else {
      dom.selectIp.classList.add('hidden')
    }
  }

  if (dom.controlPanelQr && !dom.controlPanelQr.classList.contains('hidden')) {
    if (typeof QRCode === 'undefined') return

    dom.controlPanelQr.innerHTML = ''
    new QRCode(dom.controlPanelQr, {
      text: url,
      width: 128,
      height: 128
    })
  }
}

function onIpChange() {
  state.selectedIp = dom.selectIp.value
  renderQrUrl()
}

function toggleQr() {
  if (!dom.controlPanelQr) return

  dom.controlPanelQr.classList.toggle('hidden')

  if (!dom.controlPanelQr.classList.contains('hidden')) renderQrUrl()
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

    renderQueue()
    renderPlaylists()
  } catch (error) {
    log('Error saving settings:', error)
  }
}

/* =========================================================
 * EVENTS
 * ========================================================= */

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page-tab-target]')
  if (button) {
    switchPageTab(button.dataset.pageTabTarget)
    return
  }

  const section = event.target.closest('[data-section-target]')
  if (section) {
    switchSection(section.dataset.sectionTarget)
    return
  }

  const action = event.target.closest('[data-action]')
  if (!action) return

  switch (action.dataset.action) {
    case 'queue-remove':
      removeFromQueue(Number(action.dataset.index))
      break

    case 'search-add':
      addSong(`https://www.youtube.com/watch?v=${action.dataset.videoId}`)
      break

    case 'fallback-play':
      playFallbackNow(action.dataset.videoId)
      break

    case 'fallback-enqueue':
      enqueueFallbackTrack(action.dataset.videoId)
      break

    case 'playlist-activate':
      activatePlaylist(action.dataset.id)
      break

    case 'playlist-delete':
      deletePlaylist(action.dataset.id)
      break
  }
})

dom.searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search()
})

dom.playlistUrlInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addPlaylist()
})

document.querySelector('[data-action="search"]')?.addEventListener('click', search)
document.querySelector('[data-action="copy-preview-url"]')?.addEventListener('click', copyPreviewUrl)
document.querySelector('[data-action="toggle-qr"]')?.addEventListener('click', toggleQr)
document.querySelector('[data-action="save-config"]')?.addEventListener('click', saveConfigSetting)
document.querySelector('[data-action="add-playlist"]')?.addEventListener('click', addPlaylist)

/* =========================================================
 * INIT
 * ========================================================= */

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
