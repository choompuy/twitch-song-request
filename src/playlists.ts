import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createFileStore } from './persist.js'

export type SavedPlaylist = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
  addedAt: number
}

const PLAYLISTS_PATH = path.join('data', 'playlists.json')
const store = createFileStore(PLAYLISTS_PATH)

function loadFromDisk(): SavedPlaylist[] {
  try {
    const raw = JSON.parse(readFileSync(PLAYLISTS_PATH, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

let playlists: SavedPlaylist[] = loadFromDisk()

function save(): void {
  store.scheduleSave(
    () => playlists,
    (error) => console.error('[PLAYLISTS] Failed to save:', error instanceof Error ? error.message : error)
  )
}

export function getPlaylists(): SavedPlaylist[] {
  return [...playlists]
}

export function upsertPlaylist(meta: { id: string; title: string; thumbnail: string; itemCount: number }): SavedPlaylist {
  const existing = playlists.find((p) => p.id === meta.id)

  if (existing) {
    existing.title = meta.title
    existing.thumbnail = meta.thumbnail
    existing.itemCount = meta.itemCount
    save()
    return existing
  }

  const created: SavedPlaylist = { ...meta, addedAt: Date.now() }
  playlists.push(created)
  save()
  return created
}

export function removePlaylist(id: string): boolean {
  const before = playlists.length
  playlists = playlists.filter((p) => p.id !== id)

  if (playlists.length !== before) {
    save()
    return true
  }

  return false
}
