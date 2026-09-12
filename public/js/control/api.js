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

  if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`)

  return data
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

  getActivity: () => request('/api/activity'),

  clearActivity: () =>
    request('/api/activity/clear', {
      method: 'POST'
    })
}
