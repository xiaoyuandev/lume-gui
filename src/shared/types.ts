export type VmStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error' | 'unknown'
export type VmOs = 'macOS' | 'Linux'

export interface VmSummary {
  name: string
  status: VmStatus
  os: VmOs
  cpu: number | null
  memoryGb: number | null
  diskGb: number | null
  ipAddress?: string | null
  sshPort?: number | null
  vncHost?: string | null
  vncPort?: number | null
  storagePath?: string | null
}

export interface VmDetail extends VmSummary {
  config: Record<string, unknown>
  raw?: string
  resolution?: string | null
  headless?: boolean
  background?: boolean
  sharedDirectories: string[]
  logs?: string
}

export interface ImageSummary {
  name: string
  version?: string | null
  cached?: boolean
  path?: string | null
  size?: string | null
}

export interface AppSettings {
  defaultStoragePath: string
  defaultResolution: string
  allowAutoUpdate: boolean
  backgroundMode: boolean
  autoStartServe: boolean
  startAtLogin: boolean
  defaultHeadless: boolean
  sharedDirectories: string[]
}

export interface CreateVmInput {
  name: string
  os: VmOs
  cpu: number
  memoryGb: number
  diskGb: number
  resolution: string
  macOsVersion: string
  networkMode: 'nat' | 'bridged'
  storagePath: string
  headless: boolean
  sharedDirectories: string[]
  background: boolean
}

export interface UpdateVmInput {
  name: string
  cpu: number
  memoryGb: number
  diskGb: number
  resolution: string
  headless: boolean
  sharedDirectories: string[]
  background: boolean
}

export interface CommandResult {
  success: boolean
  command: string[]
  stdout: string
  stderr: string
  code: number
}

export interface AppStatus {
  lumeInstalled: boolean
  lumeVersion?: string | null
  serveRunning: boolean
  serveLogs: string
  lastError?: string | null
}

export interface LumeApi {
  getStatus: () => Promise<AppStatus>
  listVms: () => Promise<VmSummary[]>
  getVm: (name: string) => Promise<VmDetail>
  createVm: (input: CreateVmInput) => Promise<CommandResult>
  startVm: (name: string) => Promise<CommandResult>
  stopVm: (name: string) => Promise<CommandResult>
  deleteVm: (name: string) => Promise<CommandResult>
  updateVm: (input: UpdateVmInput) => Promise<CommandResult>
  getVmLogs: (name: string) => Promise<string>
  listImages: () => Promise<ImageSummary[]>
  getSettings: () => Promise<AppSettings>
  saveSettings: (input: AppSettings) => Promise<AppSettings>
  chooseDirectory: () => Promise<string | null>
  restartServe: () => Promise<AppStatus>
}
