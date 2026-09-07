let player = null
let currentState = null
let isPlayerReady = false
let isTransitioning = false

let settings = {}
let lastQueueSnapshot = null
let cachedMaxQueueSize = null

const log = createLogger('CONTROL')

async function fetchSettings() {
  try {
    const response = await fetch('/api/settings')
    settings = await response.json()

    document.getElementById('showVideo').checked = settings.showVideo
  } catch (error) {
    log('Error fetching settings:', error)
  }
}

async function saveSettings() {
  settings.showVideo = document.getElementById('showVideo').checked

  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config')
    const cfg = await response.json()

    document.getElementById('cfgMinViews').value = cfg.minViews
    document.getElementById('cfgMaxDuration').value = cfg.maxDurationSeconds
    document.getElementById('cfgMaxQueue').value = cfg.maxQueueSize
    document.getElementById('cfgMaxPerUser').value = cfg.maxRequestsPerUser
    document.getElementById('cfgCooldown').value = cfg.cooldownSeconds
    document.getElementById('cfgFallbackPlaylist').value = cfg.fallbackPlaylistId ?? ''
  } catch (error) {
    log('Error loading config:', error)
  }
}

async function saveConfig() {
  const payload = {
    minViews: Number(document.getElementById('cfgMinViews').value),
    maxDurationSeconds: Number(document.getElementById('cfgMaxDuration').value),
    maxQueueSize: Number(document.getElementById('cfgMaxQueue').value),
    maxRequestsPerUser: Number(document.getElementById('cfgMaxPerUser').value),
    cooldownSeconds: Number(document.getElementById('cfgCooldown').value),
    fallbackPlaylistId: document.getElementById('cfgFallbackPlaylist').value.trim()
  }

  try {
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } catch (error) {
    log('Error saving config:', error)
  }
}

async function loadSecrets() {
  try {
    const response = await fetch('/api/secrets')
    const data = await response.json()

    document.getElementById('secretsStatus').textContent = data.hasYoutubeApiKey
      ? `YouTube ключ сохранён (${data.youtubeApiKey})`
      : 'YouTube ключ не задан — заказы работать не будут'
  } catch (error) {
    log('Error loading secrets:', error)
  }
}

async function saveSecrets() {
  const payload = {}
  const youtubeKey = document.getElementById('secYoutubeKey').value.trim()

  if (youtubeKey) payload.youtubeApiKey = youtubeKey

  try {
    await fetch('/api/secrets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    document.getElementById('secYoutubeKey').value = ''
    await loadSecrets()
  } catch (error) {
    log('Error saving secrets:', error)
  }
}

function renderCurrent(state) {
  const nowPlaying = document.getElementById('nowPlaying')
  const noPlaying = document.getElementById('noPlaying')
  const currentThumbnail = document.getElementById('currentThumbnail')
  const currentTitle = document.getElementById('currentTitle')
  const currentChannel = document.getElementById('currentChannel')
  const currentViews = document.getElementById('currentViews')
  const currentDuration = document.getElementById('currentDuration')
  const currentRequester = document.getElementById('currentRequester')

  if (state.current) {
    nowPlaying.classList.remove('hidden')
    noPlaying.style.display = 'none'
    currentThumbnail.src = state.current.thumbnail
    currentTitle.textContent = state.current.title
    currentChannel.textContent = state.current.channelTitle
    currentViews.textContent = `${formatViews(state.current.views)} views`
    currentDuration.textContent = formatDuration(state.current.duration)
    currentRequester.textContent = `@${escapeHtml(state.current.requestedBy)}`
  } else {
    nowPlaying.classList.add('hidden')
    noPlaying.style.display = 'block'
  }
}

async function renderQueue(state) {
  const queueList = document.getElementById('queueList')
  const queueCount = document.getElementById('queueCount')

  if (cachedMaxQueueSize === null) {
    const response = await fetch('/api/config')
    const config = await response.json()
    cachedMaxQueueSize = config.maxQueueSize
  }

  queueCount.textContent = `${state.queue.length}/${cachedMaxQueueSize}`

  const snapshot = JSON.stringify(state.queue.map((i) => i.videoId))
  if (snapshot === lastQueueSnapshot) return
  lastQueueSnapshot = snapshot

  if (!state.queue.length) {
    queueList.innerHTML = '<div class="empty">Queue is empty</div>'
    return
  }

  queueList.innerHTML = state.queue
    .map(
      (item, index) => `
          <div class="row">
            <div class="row flex-1">
              <span class="text-secondary">#${index + 1}</span>
              <img src="${escapeHtml(item.thumbnail)}" class="thumbnail-img" alt="${escapeHtml(item.title)}">
              <div class="row-info">
                <div class="row-title text-sm text-primary">${escapeHtml(item.title)}</div>
                <div class="text-xs text-green">@${escapeHtml(item.requestedBy)}</div>
              </div>
              <span class="text-sm text-secondary">
                ${formatDuration(item.duration)}
              </span>
            </div>
            <button class="row-tag btn btn-icon btn-danger" onclick="removeFromQueue(${index})">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m18 6-.8 12.013c-.071 1.052-.106 1.578-.333 1.977a2 2 0 0 1-.866.81c-.413.2-.94.2-1.995.2H9.994c-1.055 0-1.582 0-1.995-.2a2 2 0 0 1-.866-.81c-.227-.399-.262-.925-.332-1.977L6 6M4 6h16m-4 0-.27-.812c-.263-.787-.394-1.18-.637-1.471a2 2 0 0 0-.803-.578C13.939 3 13.524 3 12.695 3h-1.388c-.829 0-1.244 0-1.596.139a2 2 0 0 0-.803.578c-.243.29-.374.684-.636 1.471L8 6m6 4v7m-4-7v7"/>
              </svg>
            </button>
          </div>
        `
    )
    .join('')
}

function renderState(state) {
  currentState = state
  renderCurrent(state)
  renderQueue(state)

  if (isPlayerReady && state.current) {
    const currentVideoId = player.getVideoData()?.video_id
    if (currentVideoId !== state.current.videoId) {
      log(`Loading video: ${state.current.videoId}`)
      player.cueVideoById(state.current.videoId)

      if (!settings.showVideo) {
        player.setPlaybackQuality('tiny')
      }
    }
  } else if (isPlayerReady && !state.current && !isTransitioning) {
    player.stopVideo()
  }
}

async function fetchState() {
  try {
    const response = await fetch('/api/state')
    const state = await response.json()
    renderState(state)
  } catch (error) {
    log('Error fetching state:', error)
  }
}

async function search() {
  const query = document.getElementById('searchInput').value.trim()
  const searchResults = document.getElementById('searchResults')
  const searchError = document.getElementById('searchError')

  if (!query) {
    return
  }

  searchResults.classList.add('hidden')
  searchError.classList.add('hidden')

  const urlPattern = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  const urlMatch = query.match(urlPattern)

  if (urlMatch) {
    try {
      const response = await fetch('/api/queue/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, requestedBy: 'ControlPanel' })
      })

      const result = await response.json()

      if (result.success) {
        document.getElementById('searchInput').value = ''
        await fetchState()
      } else {
        searchError.textContent = result.error
        searchError.classList.remove('hidden')
      }
    } catch (error) {
      searchError.textContent = 'Error adding video'
      searchError.classList.remove('hidden')
    }
  } else {
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
      const data = await response.json()

      if (!data.success) {
        searchError.textContent = data.error || 'Error searching'
        searchError.classList.remove('hidden')
        return
      }

      const results = data.results

      if (!results || results.length <= 0) {
        searchError.textContent = 'No results found'
        searchError.classList.remove('hidden')
      } else {
        searchResults.innerHTML = results
          .map(
            (song) => `
                <div class="row row-hover" onclick="addSong('${song.videoId}')">
                  <img src="${escapeHtml(song.thumbnail)}" class="thumbnail-img" alt="${escapeHtml(song.title)}">
                  <div class="row-info">
                    <div class="row-title text-sm text-primary">${escapeHtml(song.title)}</div>
                    <div class="row-sub text-xs text-secondary">${escapeHtml(song.channelTitle)} • ${formatDuration(song.duration)} • ${formatViews(song.views)} views</div>
                  </div>
                  <div class="row-tag">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                      <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h12m-6-6v12"/>
                    </svg>
                  </div>
                </div>
              `
          )
          .join('')
        searchResults.classList.remove('hidden')
      }
    } catch (error) {
      console.error(error)
      searchError.textContent = 'Error searching'
      searchError.classList.remove('hidden')
    }
  }
}

async function addSong(videoId) {
  try {
    const response = await fetch('/api/queue/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `https://www.youtube.com/watch?v=${videoId}`, requestedBy: 'ControlPanel' })
    })

    const result = await response.json()

    if (result.success) {
      document.getElementById('searchInput').value = ''
      document.getElementById('searchResults').classList.add('hidden')
      await fetchState()
    } else {
      const searchError = document.getElementById('searchError')
      searchError.textContent = result.error
      searchError.classList.remove('hidden')
    }
  } catch (error) {
    log('Error adding song:', error)
  }
}

async function removeFromQueue(index) {
  try {
    await fetch(`/api/queue/${index}`, { method: 'DELETE' })
    await fetchState()
  } catch (error) {
    log('Error removing from queue:', error)
  }
}

async function skipCurrent() {
  try {
    await fetch('/api/player/skip', { method: 'POST' })
    await fetchState()
  } catch (error) {
    log('Error skipping:', error)
  }
}

async function pauseCurrent() {
  try {
    await fetch('/api/player/pause', { method: 'POST' })
    await fetchState()
  } catch (error) {
    log('Error pausing:', error)
  }
}

async function resumeCurrent() {
  try {
    await fetch('/api/player/resume', { method: 'POST' })
    await fetchState()
  } catch (error) {
    log('Error resuming:', error)
  }
}

async function clearQueue() {
  if (!confirm('Clear entire queue?')) return

  try {
    await fetch('/api/queue/clear', { method: 'POST' })
    await fetchState()
  } catch (error) {
    log('Error clearing queue:', error)
  }
}

function updateProgress() {
  if (!player || !currentState?.current) return

  const currentTime = player.getCurrentTime() || 0
  const duration = currentState.current.duration
  const progress = (currentTime / duration) * 100

  document.getElementById('progressBar').style.width = `${progress}%`
  document.getElementById('elapsedTime').textContent = formatDuration(Math.floor(currentTime))
}

function onPlayerReady(event) {
  log('Player ready')
  isPlayerReady = true
  fetchState()
}

function onPlayerStateChange(event) {
  log(`Player state: ${event.data}`)

  const btn = document.getElementById('playPauseBtn')

  if (event.data === YT.PlayerState.PLAYING) {
    btn.textContent = 'Pause'
  } else if (event.data === YT.PlayerState.PAUSED) {
    btn.textContent = 'Play'
  }
}

function onPlayerError(event) {
  const message = getErrorMessage(event.data)
  log(`Player error: ${message}`)

  if (!isTransitioning) {
    isTransitioning = true

    fetch('/api/player/skip', { method: 'POST' })
      .then(() => fetchState())
      .finally(() => {
        setTimeout(() => {
          isTransitioning = false
        }, 1000)
      })
  }
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
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  })
}

const searchInput = document.getElementById('searchInput')

if (searchInput) {
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      search()
    }
  })
}

async function fetchFallback() {
  try {
    const response = await fetch('/api/fallback')
    renderFallback(await response.json())
  } catch (error) {
    log('Error fetching fallback playlist:', error)
  }
}

function renderFallback(data) {
  const info = document.getElementById('fallbackInfo')
  const list = document.getElementById('fallbackList')

  if (!data.tracks.length) {
    info.textContent = 'Fallback-плейлист не задан или пуст'
    list.innerHTML = ''
    return
  }

  const date = new Date(data.lastRefreshedAt)

  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  const formattedDate = `${day}.${month} (${hours}:${minutes})`

  info.textContent = `${data.tracks.length} треков · обновлён ${data.lastRefreshedAt ? formattedDate : '—'}`

  list.innerHTML = data.tracks
    .map(
      (track, index) => `
      <div class="row ${index === data.nextIndex ? 'row-active' : ''}">
        <div class="row flex-1">
          <img src="${track.thumbnail}" class="thumbnail-img" alt="${escapeHtml(track.title)}" />
          <div class="row-info">
            <div class="row-title text-sm text-primary">${escapeHtml(track.title)}</div>
            <div class="row-sub text-xs text-secondary">${escapeHtml(track.channelTitle)}</div>
          </div>
          <div>${formatDuration(track.duration)}</div>
        </div>
      </div>
    `
    )
    .join('')
}

async function refreshFallback() {
  await fetch('/api/fallback/refresh', { method: 'POST' })
  await fetchFallback()
}

async function shuffleFallback() {
  await fetch('/api/fallback/shuffle', { method: 'POST' })
  await fetchFallback()
}

async function init() {
  await loadSecrets()
  await loadConfig()
  await fetchSettings()
  await fetchState()
  await fetchFallback()

  setInterval(fetchState, 2000)
  setInterval(fetchFallback, 10000)

  log('Control panel initialized')
}

init()
