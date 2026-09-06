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

function createLogger(prefix) {
  return function (message) {
    console.log(`[${prefix}] ${message}`)
  }
}

const errorMessages = {
  2: 'Invalid parameter',
  5: 'HTML5 player error',
  100: 'Video not found',
  101: 'Embed not allowed',
  150: 'Embed not allowed'
}

function getErrorMessage(code) {
  return errorMessages[code] || `Error code ${code}`
}
