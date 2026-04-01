import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { buildCreateArgs } from '../shared/create-command'
import {
  deleteVmPreferences,
  loadVmPreferences,
  saveVmPreferences
} from './settings'
import type {
  AppStatus,
  CommandResult,
  CreateVmInput,
  ImageSummary,
  UpdateVmInput,
  VmDetail,
  VmOs,
  VmStatus,
  VmSummary
} from '../shared/types'

const execFileAsync = promisify(execFile)

type ExecOutcome = {
  stdout: string
  stderr: string
  code: number
}

type RunOptions = {
  timeout?: number
}

function toVmStatus(value: string | undefined): VmStatus {
  const normalized = (value ?? '').toLowerCase()
  if (normalized.includes('running')) return 'running'
  if (normalized.includes('stopped') || normalized.includes('stop')) return 'stopped'
  if (normalized.includes('starting')) return 'starting'
  if (normalized.includes('stopping')) return 'stopping'
  if (normalized.includes('error') || normalized.includes('failed')) return 'error'
  return 'unknown'
}

function toVmOs(value: unknown): VmOs {
  return String(value ?? '')
    .toLowerCase()
    .includes('linux')
    ? 'Linux'
    : 'macOS'
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const matched = value.match(/(\d+(?:\.\d+)?)/)
    if (matched) return Number(matched[1])
  }
  return null
}

function bytesToGigabytes(value: unknown): number | null {
  const bytes = toNumber(value)
  if (bytes === null) return null
  return Number((bytes / 1024 / 1024 / 1024).toFixed(2))
}

function toDiskGb(value: unknown): number | null {
  if (typeof value === 'object' && value !== null) {
    const total = (value as Record<string, unknown>)['total']
    return bytesToGigabytes(total)
  }
  return toNumber(value)
}

function parseVncUrl(value: unknown): { host: string | null; port: number | null } {
  if (typeof value !== 'string' || !value.trim()) {
    return { host: null, port: null }
  }

  try {
    const url = new URL(value)
    return {
      host: url.hostname || null,
      port: url.port ? Number(url.port) : null
    }
  } catch {
    const matched = value.match(/([^:]+):(\d+)/)
    return {
      host: matched?.[1] ?? null,
      port: matched?.[2] ? Number(matched[2]) : null
    }
  }
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function summarizeVm(raw: Record<string, unknown>): VmSummary {
  const { host: vncHost, port: vncPort } = parseVncUrl(raw['vncUrl'])
  const sshAvailable = typeof raw['sshAvailable'] === 'string' ? raw['sshAvailable'] : null
  const sshPort = sshAvailable?.match(/:(\d+)$/)?.[1]

  return {
    name: String(raw['name'] ?? raw['vm'] ?? 'unknown'),
    status: toVmStatus(String(raw['status'] ?? raw['state'] ?? 'unknown')),
    os: toVmOs(raw['os'] ?? raw['platform']),
    cpu: toNumber(raw['cpuCount'] ?? raw['cpu'] ?? raw['cpus']),
    memoryGb: bytesToGigabytes(raw['memorySize'] ?? raw['memory'] ?? raw['memoryGb'] ?? raw['ram']),
    diskGb: toDiskGb(raw['diskSize'] ?? raw['disk'] ?? raw['diskGb'] ?? raw['storage']),
    ipAddress: typeof raw['ipAddress'] === 'string' ? raw['ipAddress'] : null,
    sshPort: sshPort ? Number(sshPort) : null,
    vncHost,
    vncPort,
    storagePath:
      typeof raw['locationName'] === 'string'
        ? raw['locationName']
        : typeof raw['storagePath'] === 'string'
          ? String(raw['storagePath'])
          : null
  }
}

function parseTabularVmList(stdout: string): VmSummary[] {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length <= 1) return []

  return lines.slice(1).map((line) => {
    const parts = line.split(/\s{2,}/)
    return {
      name: parts[0] ?? 'unknown',
      status: toVmStatus(parts[1]),
      os: toVmOs(parts[2]),
      cpu: toNumber(parts[3]),
      memoryGb: toNumber(parts[4]),
      diskGb: toNumber(parts[5])
    }
  })
}

function parseKeyValue(stdout: string): Record<string, unknown> {
  return stdout.split('\n').reduce<Record<string, unknown>>((acc, line) => {
    const matched = line.match(/^([^:]+):\s*(.+)$/)
    if (matched) {
      acc[matched[1].trim()] = matched[2].trim()
    }
    return acc
  }, {})
}

function buildUpdateArgs(input: UpdateVmInput): string[] {
  const args = [
    'set',
    input.name,
    '--cpu',
    String(input.cpu),
    '--memory',
    String(input.memoryGb),
    '--disk-size',
    String(input.diskGb),
    '--display',
    input.resolution
  ]

  return args
}

function parseVmArray(stdout: string): Record<string, unknown>[] {
  const parsed = parseJson<unknown>(stdout)
  if (!Array.isArray(parsed)) return []

  return parsed.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
  )
}

export class LumeManager {
  private serveProcess: ChildProcessWithoutNullStreams | null = null
  private serveLogs = ''
  private lastError: string | null = null

  private appendServeLogs(chunk: string): void {
    this.serveLogs = `${this.serveLogs}${chunk}`.slice(-12000)
  }

  async run(args: string[], options?: RunOptions): Promise<ExecOutcome> {
    try {
      const { stdout, stderr } = await execFileAsync('lume', args, {
        timeout: options?.timeout ?? 120000,
        maxBuffer: 1024 * 1024 * 8
      })
      return { stdout, stderr, code: 0 }
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string
        stderr?: string
        code?: number | string
      }

      if (execError.code === 'ENOENT') {
        this.lastError = 'The `lume` command was not found. Install Lume and ensure it is available in PATH.'
      } else if (typeof execError.stderr === 'string' && execError.stderr.trim()) {
        this.lastError = execError.stderr.trim()
      }

      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? execError.message,
        code: typeof execError.code === 'number' ? execError.code : 1
      }
    }
  }

  async isInstalled(): Promise<boolean> {
    const result = await this.run(['--version'])
    return result.code === 0
  }

  async getVersion(): Promise<string | null> {
    const result = await this.run(['--version'])
    return result.code === 0 ? result.stdout.trim() : null
  }

  async listVms(): Promise<VmSummary[]> {
    const jsonResult = await this.run(['ls', '--format', 'json'])
    if (jsonResult.code === 0) {
      return parseVmArray(jsonResult.stdout).map(summarizeVm)
    }

    const result = await this.run(['ls'])
    return result.code === 0 ? parseTabularVmList(result.stdout) : []
  }

  async getVm(name: string): Promise<VmDetail> {
    const preferences = await loadVmPreferences(name)

    const jsonResult = await this.run(['get', name, '--format', 'json'])
    if (jsonResult.code === 0) {
      const parsed = parseVmArray(jsonResult.stdout)[0]
      if (parsed) {
        const summary = summarizeVm(parsed)
        return {
          ...summary,
          config: parsed,
          raw: jsonResult.stdout,
          resolution: typeof parsed['display'] === 'string' ? String(parsed['display']) : null,
          headless: preferences.headless,
          background: preferences.background,
          sharedDirectories: preferences.sharedDirectories
        }
      }
    }

    const result = await this.run(['get', name])
    const vmFromTable = parseTabularVmList(result.stdout).find((entry) => entry.name === name)
    const config = parseKeyValue(result.stdout)
    const summary = vmFromTable ?? summarizeVm({ name, ...config })
    return {
      ...summary,
      config,
      raw: result.stdout,
      resolution: typeof config['display'] === 'string' ? String(config['display']) : null,
      headless: preferences.headless,
      background: preferences.background,
      sharedDirectories: preferences.sharedDirectories
    }
  }

  async createVm(input: CreateVmInput): Promise<CommandResult> {
    const existingVms = await this.listVms()
    const normalizedName = input.name.trim().toLowerCase()
    if (existingVms.some((vm) => vm.name.trim().toLowerCase() === normalizedName)) {
      return {
        success: false,
        command: ['lume', ...buildCreateArgs(input)],
        stdout: '',
        stderr: `Virtual machine ${input.name.trim()} already exists. Choose a different name.`,
        code: 1
      }
    }

    const command = buildCreateArgs(input)
    const result = await this.run(command)
    if (result.code === 0) {
      await saveVmPreferences(input.name, {
        headless: input.headless,
        background: input.background,
        sharedDirectories: input.sharedDirectories
      })
    }
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async startVm(name: string): Promise<CommandResult> {
    const preferences = await loadVmPreferences(name)
    const command = ['run']

    if (preferences.headless) {
      command.push('--no-display')
    }

    for (const directory of preferences.sharedDirectories) {
      command.push('--shared-dir', directory)
    }

    command.push(name)

    try {
      const child = spawn('lume', command, {
        detached: preferences.background,
        stdio: 'ignore'
      })
      if (preferences.background) {
        child.unref()
      }

      return {
        success: true,
        command: ['lume', ...command],
        stdout: preferences.background
          ? `lume run ${name} started in background mode`
          : `lume run ${name} started`,
        stderr: '',
        code: 0
      }
    } catch (error) {
      const spawnError = error as NodeJS.ErrnoException
      if (spawnError.code === 'ENOENT') {
        this.lastError = 'The `lume` command was not found. Install Lume and ensure it is available in PATH.'
      } else {
        this.lastError = spawnError.message
      }

      return {
        success: false,
        command: ['lume', ...command],
        stdout: '',
        stderr: spawnError.message,
        code: 1
      }
    }
  }

  async stopVm(name: string): Promise<CommandResult> {
    const command = ['stop', name]
    const result = await this.run(command)
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async deleteVm(name: string): Promise<CommandResult> {
    const command = ['delete', name, '--force']
    const result = await this.run(command)
    if (result.code === 0) {
      await deleteVmPreferences(name)
    }
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async updateVm(input: UpdateVmInput): Promise<CommandResult> {
    const command = buildUpdateArgs(input)
    const result = await this.run(command)
    if (result.code === 0) {
      await saveVmPreferences(input.name, {
        headless: input.headless,
        background: input.background,
        sharedDirectories: input.sharedDirectories
      })
    }
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async listImages(): Promise<ImageSummary[]> {
    const jsonResult = await this.run(['images', '--format', 'json'])
    if (jsonResult.code === 0) {
      const parsed = parseJson<unknown>(jsonResult.stdout)
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
          )
          .map((entry) => ({
            name: String(entry['name'] ?? 'unknown'),
            version: typeof entry['version'] === 'string' ? entry['version'] : null,
            cached: Boolean(entry['cached'] ?? true),
            path: typeof entry['path'] === 'string' ? entry['path'] : null,
            size: typeof entry['size'] === 'string' ? entry['size'] : null
          }))
      }
    }

    const result = await this.run(['images'])
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(1)
      .map((line) => {
        const parts = line.split(/\s{2,}/)
        return {
          name: parts[0] ?? 'unknown',
          version: parts[1] ?? null,
          cached: true,
          size: parts[2] ?? null,
          path: parts[3] ?? null
        }
      })
  }

  async getVmLogs(name: string): Promise<string> {
    const result = await this.run(['logs', name, '--lines', '200'])
    return result.code === 0 ? result.stdout : result.stderr
  }

  async ensureServeRunning(): Promise<void> {
    if (this.serveProcess && !this.serveProcess.killed) return
    if (!(await this.isInstalled())) return

    this.serveProcess = spawn('lume', ['serve'], {
      stdio: 'pipe'
    })

    this.serveProcess.stdout.on('data', (chunk: Buffer) => this.appendServeLogs(chunk.toString()))
    this.serveProcess.stderr.on('data', (chunk: Buffer) => this.appendServeLogs(chunk.toString()))
    this.serveProcess.on('error', (error) => {
      this.lastError = error.message
      this.appendServeLogs(`\n${error.message}\n`)
      this.serveProcess = null
    })
    this.serveProcess.on('exit', (code, signal) => {
      this.appendServeLogs(`\nserve exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})\n`)
      this.serveProcess = null
    })
  }

  stopServe(): void {
    if (!this.serveProcess) return
    this.serveProcess.kill()
    this.serveProcess = null
  }

  async restartServe(): Promise<AppStatus> {
    this.stopServe()
    await this.ensureServeRunning()
    return this.getStatus()
  }

  async getStatus(): Promise<AppStatus> {
    const lumeVersion = await this.getVersion()
    return {
      lumeInstalled: Boolean(lumeVersion),
      lumeVersion,
      serveRunning: Boolean(this.serveProcess && !this.serveProcess.killed),
      serveLogs: this.serveLogs.trim(),
      lastError: this.lastError
    }
  }
}
