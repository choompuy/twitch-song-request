import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createFileStore } from './persist.js'
import { Config } from './types.js'

const CONFIG_PATH = path.join('data', 'config.json')
const store = createFileStore(CONFIG_PATH)

const envDefaults: Config = {
  minViews: 10000,
  minDurationSeconds: 60,
  maxDurationSeconds: 480,
  maxQueueSize: 20,
  maxRequestsPerUser: 4,
  fallbackPlaylist: {
    playlistId: null,
    enabled: true,
    shuffle: false,
    repeat: false
  }
}

function loadFromDisk(): Config | null {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<Config>
    return {
      ...envDefaults,
      ...raw,
      fallbackPlaylist: { ...envDefaults.fallbackPlaylist, ...raw.fallbackPlaylist }
    }
  } catch {
    return null
  }
}

let config: Config = loadFromDisk() ?? { ...envDefaults }

function saveConfig(): void {
  store.scheduleSave(
    () => config,
    (error) => console.error('[CONFIG] Failed to save config:', error instanceof Error ? error.message : error)
  )
}

export function getConfig(): Config {
  return { ...config }
}

const NUMERIC_FIELDS: { key: keyof Config; min: number }[] = [
  { key: 'minViews', min: 0 },
  { key: 'minDurationSeconds', min: 0 },
  { key: 'maxDurationSeconds', min: 1 },
  { key: 'maxQueueSize', min: 1 },
  { key: 'maxRequestsPerUser', min: 0 }
]

function sanitizeNumericUpdates(updates: Partial<Config>): Partial<Config> {
  const clean: Partial<Config> = { ...updates }

  for (const { key, min } of NUMERIC_FIELDS) {
    const value = updates[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
      delete clean[key]
    }
  }

  return clean
}

export function updateConfig(updates: Partial<Config>): Config {
  const safeUpdates = sanitizeNumericUpdates(updates)

  config = {
    ...config,
    ...safeUpdates,
    fallbackPlaylist: { ...config.fallbackPlaylist, ...updates.fallbackPlaylist }
  }
  saveConfig()
  return { ...config }
}
