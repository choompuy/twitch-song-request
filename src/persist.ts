import { existsSync, mkdirSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SAVE_DEBOUNCE_MS = 250

export function createFileStore(filePath: string) {
  const dir = path.dirname(filePath)
  const tmpPath = `${filePath}.tmp`

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saveChain: Promise<void> = Promise.resolve()

  async function persistNow(getData: () => unknown): Promise<void> {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    await writeFile(tmpPath, JSON.stringify(getData()), 'utf8')
    await rename(tmpPath, filePath)
  }

  function scheduleSave(getData: () => unknown, onError: (error: unknown) => void): void {
    if (saveTimer) {
      clearTimeout(saveTimer)
    }

    saveTimer = setTimeout(() => {
      saveTimer = null
      saveChain = saveChain.then(() => persistNow(getData)).catch(onError)
    }, SAVE_DEBOUNCE_MS)
  }

  async function flush(getData: () => unknown): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      saveChain = saveChain.then(() => persistNow(getData))
    }
    await saveChain
  }

  return { scheduleSave, flush }
}
