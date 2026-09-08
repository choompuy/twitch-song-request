import { Settings } from './types.js'

const defaultSettings: Settings = {
  showVideo: false,
  position: 'bottom-right'
}

let currentSettings: Settings = { ...defaultSettings }

export function getSettings(): Settings {
  return { ...currentSettings }
}

export function updateSettings(updates: Partial<Settings>): Settings {
  currentSettings = { ...currentSettings, ...updates }
  console.log('[SETTINGS] Updated:', currentSettings)
  return { ...currentSettings }
}

export function setSettings(settings: Settings): void {
  currentSettings = { ...settings }
  console.log('[SETTINGS] Set:', currentSettings)
}

export function resetSettings(): Settings {
  currentSettings = { ...defaultSettings }
  console.log('[SETTINGS] Reset to defaults')
  return { ...currentSettings }
}
