import fs from 'node:fs'
import path from 'node:path'

export type RuntimeConfig = {
  minViews: number
  maxDurationSeconds: number
  maxQueueSize: number
  maxRequestsPerUser: number
  cooldownSeconds: number
  fallbackPlaylistId: string
}

const CONFIG_PATH = path.join('data', 'runtime-config.json')

const envDefaults: RuntimeConfig = {
  minViews: 10000,
  maxDurationSeconds: 480,
  maxQueueSize: 20,
  maxRequestsPerUser: 4,
  cooldownSeconds: 60,
  fallbackPlaylistId: ''
}

function loadFromDisk(): RuntimeConfig | null {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return null
  }
}

let runtimeConfig: RuntimeConfig = loadFromDisk() ?? { ...envDefaults }

export function getRuntimeConfig(): RuntimeConfig {
  return { ...runtimeConfig }
}

export function updateRuntimeConfig(updates: Partial<RuntimeConfig>): RuntimeConfig {
  runtimeConfig = { ...runtimeConfig, ...updates }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(runtimeConfig, null, 2))
  return { ...runtimeConfig }
}
