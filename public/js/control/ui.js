function withLoading(button, action) {
  if (!button) return action()

  button.disabled = true
  return Promise.resolve()
    .then(action)
    .finally(() => {
      button.disabled = false
    })
}

function createListView(wrapper, { renderRow, getKey, cache = true }) {
  const list = wrapper?.querySelector('.row-list')
  const empty = wrapper?.querySelector('.empty')

  if (!wrapper || !list || !empty) {
    return {
      render: () => {},
      clear: () => {},
      invalidate: () => {}
    }
  }

  let lastKey = null

  function setEmpty(isEmpty) {
    wrapper.classList.toggle('is-empty', isEmpty)
  }

  function render(items = []) {
    setEmpty(items.length === 0)
    const key = getKey ? getKey(items) : items.map((item) => item?.id ?? item?.videoId ?? item).join('|')

    if (cache && key === lastKey) return false

    lastKey = key

    if (!items.length) {
      list.innerHTML = ''
      return true
    }

    list.innerHTML = items.map((item, index) => renderRow(item, index)).join('')
    return true
  }

  function clear() {
    lastKey = null
    setEmpty(true)
    list.innerHTML = ''
  }

  function invalidate() {
    lastKey = null
  }

  return {
    render,
    clear,
    invalidate,
    list,
    empty,
    wrapper
  }
}

function setHidden(element, hidden) {
  element?.classList.toggle('hidden', hidden)
}

function toggleActive(element, active) {
  element?.classList.toggle('active', Boolean(active))
}

function formatRelativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function formatDateTime(timestamp) {
  if (!timestamp) return '-'

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

function formatDate(timestamp) {
  if (!timestamp) return '-'

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit'
  }).format(new Date(timestamp))
}
