import fs from 'node:fs'
import path from 'node:path'
import { Config } from './types.js'

const CONFIG_PATH = path.join('data', 'config.json')

const envDefaults: Config = {
  minViews: 10000,
  minDurationSeconds: 60,
  maxDurationSeconds: 480,
  maxQueueSize: 20,
  maxRequestsPerUser: 4,
  fallbackPlaylistId: ''
}

function loadFromDisk(): Config | null {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return null
  }
}

let config: Config = loadFromDisk() ?? { ...envDefaults }

export function getConfig(): Config {
  return { ...config }
}

export function updateConfig(updates: Partial<Config>): Config {
  config = { ...config, ...updates }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  return { ...config }
}
