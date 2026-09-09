let player = null
let currentState = null
let isPlayerReady = false
let isTransitioning = false
let settings = {}

const log = createLogger('PREVIEW')

const dom = {
  playerWrapper: $('playerWrapper'),
  badge: $('nowPlaying'),
  currentThumbnail: $('currentThumbnail'),
  currentTitle: $('currentTitle'),
  currentChannel: $('currentChannel'),
  currentRequester: $('currentRequester'),
  progressBar: $('progressBar'),
  elapsedTime: $('elapsedTime')
}

async function fetchPreviewState() {
  try {
    const response = await fetch('/api/preview-state')
    const data = await response.json()
    settings = data.settings
    renderState(data.state)
  } catch (error) {
    log('Error fetching settings:', error)
  }
}

function updateMediaVisibility(state) {
  dom.playerWrapper.classList.toggle('hidden', !state.showVideo)
  dom.currentThumbnail.classList.toggle('hidden', state.showVideo)
}

function renderCurrent(state) {
  if (!state.current) {
    dom.badge.classList.remove('visible')
    return
  }

  dom.badge.dataset.position = settings.position
  dom.currentThumbnail.src = state.current.thumbnail
  dom.currentTitle.textContent = state.current.title
  dom.currentChannel.textContent = state.current.channelTitle
  dom.currentRequester.textContent = `@${state.current.requestedBy}`

  dom.badge.classList.add('visible')
}

function renderState(state) {
  currentState = state
  renderCurrent(state)
  updateMediaVisibility(settings)

  if (isPlayerReady) {
    if (state.isPaused) {
      player.pauseVideo()
    } else if (player.getPlayerState() === YT.PlayerState.PAUSED) {
      player.playVideo()
    }
  }

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

function updateProgress() {
  if (!player || !currentState?.current) {
    dom.progressBar.style.width = '0%'
    dom.elapsedTime.textContent = formatDuration(0)
    return
  }

  const currentTime = player.getCurrentTime() || 0
  const duration = currentState.current.duration
  const progress = ((currentTime / duration) * 100).toFixed(2)

  dom.progressBar.style.width = `${progress}%`
  dom.elapsedTime.textContent = `${formatDuration(Math.floor(currentTime))} / ${formatDuration(duration)}`
}

async function notifyEnded() {
  try {
    await fetch('/api/player/ended', { method: 'POST' })
    await fetchPreviewState()
  } catch (error) {
    log('Error notifying ended:', error)
  }
}

function onPlayerReady(event) {
  log('Player ready')
  isPlayerReady = true
  fetchPreviewState()
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
  fetchPreviewState()
  updateProgress()
}, 1000)

const tag = document.createElement('script')
tag.src = 'https://www.youtube.com/iframe_api'
const firstScriptTag = document.getElementsByTagName('script')[0]
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
