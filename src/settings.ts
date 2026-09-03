export type PreviewSettings = {
  showVideo: boolean
  showSongInfo: boolean
  showThumbnail: boolean
  showRequester: boolean
  showQueue: boolean
}

const defaultSettings: PreviewSettings = {
  showVideo: true,
  showSongInfo: true,
  showThumbnail: false,
  showRequester: true,
  showQueue: true,
}

let currentSettings: PreviewSettings = { ...defaultSettings }

export function getSettings(): PreviewSettings {
  return { ...currentSettings }
}

export function updateSettings(updates: Partial<PreviewSettings>): PreviewSettings {
  currentSettings = { ...currentSettings, ...updates }
  console.log('[SETTINGS] Updated:', currentSettings)
  return { ...currentSettings }
}

export function resetSettings(): PreviewSettings {
  currentSettings = { ...defaultSettings }
  console.log('[SETTINGS] Reset to defaults')
  return { ...currentSettings }
}
