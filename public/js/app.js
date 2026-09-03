let player = null
let currentState = null
let isPlayerReady = false
let isTransitioning = false

let settings = {}

function log(message) {
  console.log(`[CONTROL] ${message}`)
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;'
      })[c]
  )
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatViews(views) {
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K`
  return views?.toString()
}

async function fetchSettings() {
  try {
    const response = await fetch('/api/settings')
    const serverSettings = await response.json()
    Object.assign(settings, serverSettings)
    loadSettings()
  } catch (error) {
    log('Error fetching settings:', error)
  }
}

function loadSettings() {
  document.getElementById('showVideo').checked = settings.showVideo
  document.getElementById('showSongInfo').checked = settings.showSongInfo
  document.getElementById('showThumbnail').checked = settings.showThumbnail
  document.getElementById('showRequester').checked = settings.showRequester
  document.getElementById('showQueue').checked = settings.showQueue
}

async function saveSettings() {
  settings.showVideo = document.getElementById('showVideo').checked
  settings.showSongInfo = document.getElementById('showSongInfo').checked
  settings.showThumbnail = document.getElementById('showThumbnail').checked
  settings.showRequester = document.getElementById('showRequester').checked
  settings.showQueue = document.getElementById('showQueue').checked

  await fetch('/api/settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(settings)
  })
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
    nowPlaying.classList.add('visible')
    noPlaying.style.display = 'none'
    currentThumbnail.src = state.current.thumbnail
    currentTitle.textContent = state.current.title
    currentChannel.textContent = state.current.channelTitle
    currentViews.textContent = `${formatViews(state.current.views)} views`
    currentDuration.textContent = formatDuration(state.current.duration)
    currentRequester.textContent = `@${escapeHtml(state.current.requestedBy)}`
  } else {
    nowPlaying.classList.remove('visible')
    noPlaying.style.display = 'block'
  }
}

function renderQueue(state) {
  const queueList = document.getElementById('queueList')
  const queueCount = document.getElementById('queueCount')

  queueCount.textContent = `${state.queue.length}`

  if (!state.queue.length) {
    queueList.innerHTML = '<div class="empty">Queue is empty</div>'
    return
  }

  queueList.innerHTML = state.queue
    .map(
      (item, index) => `
          <div class="queue-item">
            <span class="position">#${index + 1}</span>
            <img src="${escapeHtml(item.thumbnail)}" alt="">
            <div class="info">
              <div class="title">${escapeHtml(item.title)}</div>
              <div class="meta">
                <span>${formatDuration(item.duration)}</span>
                <span>${formatViews(item.views)} views</span>
                <span class="requester">@${escapeHtml(item.requestedBy)}</span>
              </div>
            </div>
            <button onclick="removeFromQueue(${index})">×</button>
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
      const results = await response.json()

      if (results.length <= 0) {
        searchError.textContent = 'No results found'
        searchError.classList.remove('hidden')
      } else {
        searchResults.innerHTML = results
          .map(
            (song) => `
                <div class="search-result" onclick="addSong('${song.videoId}')">
                  <img src="${escapeHtml(song.thumbnail)}" alt="">
                  <div class="info">
                    <div class="title">${escapeHtml(song.title)}</div>
                    <div class="meta">${escapeHtml(song.channelTitle)} • ${formatDuration(song.duration)} • ${formatViews(song.views)} views</div>
                  </div>
                  <button>Add</button>
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
  } else if (event.data === YT.PlayerState.ENDED && !isTransitioning) {
    log('Video ended, requesting next')
    isTransitioning = true

    fetch('/api/player/ended', { method: 'POST' })
      .then(() => fetchState())
      .finally(() => {
        setTimeout(() => {
          isTransitioning = false
        }, 1000)
      })
  }
}

function onPlayerError(event) {
  const errorMessages = {
    2: 'Invalid parameter',
    5: 'HTML5 player error',
    100: 'Video not found',
    101: 'Embed not allowed',
    150: 'Embed not allowed'
  }

  const message = errorMessages[event.data] || `Error code ${event.data}`
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

async function init() {
  await fetchSettings()
  await fetchState()

  setInterval(fetchState, 2000)

  log('Control panel initialized')
}

init()
