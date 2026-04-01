import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppSettings } from '../shared/types'

const settingsFile = join(app.getPath('userData'), 'settings.json')

export const defaultSettings: AppSettings = {
  defaultStoragePath: join(app.getPath('home'), 'Lume'),
  defaultResolution: '1024x768',
  allowAutoUpdate: false,
  backgroundMode: true,
  autoStartServe: true,
  startAtLogin: false,
  defaultHeadless: false,
  sharedDirectories: []
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const content = await readFile(settingsFile, 'utf8')
    const parsed = JSON.parse(content) as Partial<AppSettings>
    return { ...defaultSettings, ...parsed }
  } catch {
    return defaultSettings
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const next = { ...defaultSettings, ...settings }
  await mkdir(dirname(settingsFile), { recursive: true })
  await writeFile(settingsFile, JSON.stringify(next, null, 2), 'utf8')
  return next
}
