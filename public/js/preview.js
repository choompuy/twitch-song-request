let player = null
let currentState = null
let isPlayerReady = false
let isTransitioning = false
let settings = {}

const log = createLogger('PREVIEW')

async function fetchSettings() {
  try {
    const response = await fetch('/api/settings')
    settings = await response.json()
  } catch (error) {
    log('Error fetching settings:', error)
  }
}

function updateMediaVisibility(state) {
  const playerWrapper = document.getElementById('playerWrapper')
  const thumbnail = document.querySelector('.now-playing-badge .thumbnail')

  const showVideo = settings.showVideo || overrideActive

  playerWrapper.classList.toggle('visible', showVideo)
  thumbnail.classList.toggle('hidden', showVideo)
}

function renderCurrent(state) {
  const badge = document.querySelector('.now-playing-badge')

  if (!state.current) {
    badge.classList.remove('visible')
    return
  }

  document.querySelector('.now-playing-badge .thumbnail').src = state.current.thumbnail
  document.querySelector('.now-playing-badge .title').textContent = state.current.title
  document.querySelector('.now-playing-badge .channel').textContent = state.current.channelTitle

  badge.classList.add('visible')
}

function renderState(state) {
  currentState = state
  renderCurrent(state)
  updateMediaVisibility(state)

  if (isPlayerReady && state.current) {
    const currentVideoId = player.getVideoData()?.video_id

    if (currentVideoId !== state.current.videoId) {
      log(`Loading video: ${state.current.videoId}`)

      player.loadVideoById(state.current.videoId)

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
  const message = getErrorMessage(event.data)
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
