import fs from 'node:fs'
import path from 'node:path'

export type Secrets = {
  youtubeApiKey: string
}

const SECRETS_PATH = path.join('data', 'secrets.json')

function loadFromDisk(): Secrets | null {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf-8'))
  } catch {
    return null
  }
}

let secrets: Secrets = loadFromDisk() ?? { youtubeApiKey: '' }

export function getSecrets(): Secrets {
  return { ...secrets }
}

export function updateSecrets(updates: Partial<Secrets>): Secrets {
  const next = { ...secrets }

  if (typeof updates.youtubeApiKey === 'string' && updates.youtubeApiKey.trim() !== '') {
    next.youtubeApiKey = updates.youtubeApiKey.trim()
  }

  secrets = next
  fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true })
  fs.writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2))

  return { ...secrets }
}

function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '•'.repeat(value.length)
  return `${value.slice(0, 4)}${'•'.repeat(value.length - 8)}${value.slice(-4)}`
}

export function getPublicSecretsView() {
  return {
    youtubeApiKey: maskSecret(secrets.youtubeApiKey),
    hasYoutubeApiKey: secrets.youtubeApiKey.length > 0
  }
}
