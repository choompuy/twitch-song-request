import path from 'node:path'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { Config } from './types.js'

const CONFIG_DIR = 'data'
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')
const CONFIG_TMP_PATH = `${CONFIG_PATH}.tmp`
const SAVE_DEBOUNCE_MS = 250

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
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()

async function persistConfigNow(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }

  await writeFile(CONFIG_TMP_PATH, JSON.stringify(config, null, 2), 'utf8')
  await rename(CONFIG_TMP_PATH, CONFIG_PATH)
}

function scheduleSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    saveTimer = null
    saveChain = saveChain.then(persistConfigNow).catch((error) => {
      console.error('[CONFIG] Failed to save config:', error instanceof Error ? error.message : error)
    })
  }, SAVE_DEBOUNCE_MS)
}

export async function flushConfig(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    saveChain = saveChain.then(persistConfigNow)
  }
  await saveChain
}

export function getConfig(): Config {
  return { ...config }
}

export function updateConfig(updates: Partial<Config>): Config {
  config = {
    ...config,
    ...updates,
    fallbackPlaylist: { ...config.fallbackPlaylist, ...updates.fallbackPlaylist }
  }
  scheduleSave()
  return { ...config }
}
