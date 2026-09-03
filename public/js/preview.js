let player = null
let currentState = null
let isPlayerReady = false
let isTransitioning = false
let settings = {}

function log(message) {
  console.log(`[PREVIEW] ${message}`)
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
  return views.toString()
}

async function fetchSettings() {
  try {
    const response = await fetch('/api/settings')
    const result = await response.json()
    Object.assign(settings, result)
    applySettings()
  } catch (error) {
    log('Error fetching settings:', error)
    return {}
  }
}

function applySettings() {
  const playerWrapper = document.getElementById('playerWrapper')
  const songInfo = document.getElementById('songInfo')
  const currentThumbnail = document.getElementById('currentThumbnail')
  const currentRequester = document.getElementById('currentRequester')
  const queue = document.getElementById('queue')

  if (settings.showVideo) {
    playerWrapper.classList.add('visible')
  } else {
    playerWrapper.classList.remove('visible')
  }

  if (settings.showSongInfo) {
    songInfo.classList.add('visible')
  } else {
    songInfo.classList.remove('visible')
  }

  if (settings.showThumbnail) {
    currentThumbnail.classList.add('visible')
  } else {
    currentThumbnail.classList.remove('visible')
  }

  if (settings.showRequester) {
    currentRequester.classList.add('visible')
  } else {
    currentRequester.classList.remove('visible')
  }

  if (settings.showQueue) {
    queue.classList.add('visible')
  } else {
    queue.classList.remove('visible')
  }
}

function renderCurrent(state) {
  const nowPlaying = document.getElementById('nowPlaying')
  const currentThumbnail = document.getElementById('currentThumbnail')
  const currentTitle = document.getElementById('currentTitle')
  const currentChannel = document.getElementById('currentChannel')
  const currentDuration = document.getElementById('currentDuration')
  const currentViews = document.getElementById('currentViews')
  const currentRequester = document.getElementById('currentRequester')

  if (state.current) {
    nowPlaying.classList.add('visible')
    currentThumbnail.src = state.current.thumbnail
    currentTitle.textContent = state.current.title
    currentChannel.textContent = state.current.channelTitle
    currentDuration.textContent = formatDuration(state.current.duration)
    currentViews.textContent = `${formatViews(state.current.views)} views`
    currentRequester.textContent = `@${escapeHtml(state.current.requestedBy)}`
  } else {
    nowPlaying.classList.remove('visible')
  }
}

function renderQueue(state) {
  if (!settings.showQueue) return

  const queue = document.getElementById('queue')
  const queueList = document.getElementById('queueList')

  if (state.queue?.length <= 0) {
    queue.style.display = null
    queueList.innerHTML = ''
    return
  }

  queue.style.display = 'block'
  queueList.innerHTML = state.queue
    .map(
      (item, index) => `
          <div class="queue-item">
            <span class="position">#${index + 1}</span>
            <img class="thumbnail ${settings.showThumbnail ? 'visible' : ''}" src="${escapeHtml(item.thumbnail)}" alt="">
            <div class="info">
            <div class="title">${escapeHtml(item.title)}</div>
            <div class="meta">
              <span>${formatDuration(item.duration)}</span>
              <span>${formatViews(item.views)} views</span>
              <span class="requester ${settings.showRequester ? 'visible' : ''}">@${escapeHtml(item.requestedBy)}</span>
            </div>
            </div>
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

      player.loadVideoById(state.current.videoId)
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

async function notifyEnded() {
  try {
    await fetch('/api/player/ended', { method: 'POST' })
    await fetchState()
  } catch (error) {
    log('Error notifying ended:', error)
  }
}

function onPlayerReady(event) {
  log('Player ready')
  isPlayerReady = true
  fetchState()
}

function onPlayerStateChange(event) {
  log(`Player state: ${event.data}`)

  if (event.data === YT.PlayerState.ENDED && !isTransitioning) {
    log('Video ended, requesting next')
    isTransitioning = true
    notifyEnded().finally(() => {
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
    notifyEnded().finally(() => {
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
      autoplay: 1,
      controls: 0,
      rel: 0,
      cc_load_policy: 0,
      iv_load_policy: 3,
      disablekb: 1,
      playsinline: 1
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  })
}

setInterval(() => {
  fetchSettings()
  fetchState()
}, 2000)

const tag = document.createElement('script')
tag.src = 'https://www.youtube.com/iframe_api'
const firstScriptTag = document.getElementsByTagName('script')[0]
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
