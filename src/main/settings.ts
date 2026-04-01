import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppSettings, VmPreferences } from '../shared/types'

const settingsFile = join(app.getPath('userData'), 'settings.json')
const vmProfilesFile = join(app.getPath('userData'), 'vm-profiles.json')

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

export const defaultVmPreferences: VmPreferences = {
  headless: false,
  background: false,
  sharedDirectories: []
}

type VmProfileStore = Record<string, VmPreferences>

function normalizeVmName(name: string): string {
  return name.trim().toLowerCase()
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

async function loadVmProfileStore(): Promise<VmProfileStore> {
  try {
    const content = await readFile(vmProfilesFile, 'utf8')
    const parsed = JSON.parse(content) as Record<string, Partial<VmPreferences>>

    return Object.entries(parsed).reduce<VmProfileStore>((acc, [name, value]) => {
      acc[name] = { ...defaultVmPreferences, ...value }
      return acc
    }, {})
  } catch {
    return {}
  }
}

async function saveVmProfileStore(store: VmProfileStore): Promise<void> {
  await mkdir(dirname(vmProfilesFile), { recursive: true })
  await writeFile(vmProfilesFile, JSON.stringify(store, null, 2), 'utf8')
}

export async function loadVmPreferences(name: string): Promise<VmPreferences> {
  const store = await loadVmProfileStore()
  return store[normalizeVmName(name)] ?? defaultVmPreferences
}

export async function saveVmPreferences(
  name: string,
  preferences: VmPreferences
): Promise<VmPreferences> {
  const store = await loadVmProfileStore()
  const next = { ...defaultVmPreferences, ...preferences }
  store[normalizeVmName(name)] = next
  await saveVmProfileStore(store)
  return next
}

export async function deleteVmPreferences(name: string): Promise<void> {
  const store = await loadVmProfileStore()
  delete store[normalizeVmName(name)]
  await saveVmProfileStore(store)
}
