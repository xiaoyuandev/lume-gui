import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
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

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function summarizeVm(raw: Record<string, unknown>): VmSummary {
  const vnc =
    typeof raw['vnc'] === 'object' && raw['vnc'] !== null
      ? (raw['vnc'] as Record<string, unknown>)
      : null
  const ssh =
    typeof raw['ssh'] === 'object' && raw['ssh'] !== null
      ? (raw['ssh'] as Record<string, unknown>)
      : null

  return {
    name: String(raw['name'] ?? raw['vm'] ?? 'unknown'),
    status: toVmStatus(String(raw['status'] ?? raw['state'] ?? 'unknown')),
    os: toVmOs(raw['os'] ?? raw['platform']),
    cpu: toNumber(raw['cpu'] ?? raw['cpus']),
    memoryGb: toNumber(raw['memory'] ?? raw['memoryGb'] ?? raw['ram']),
    diskGb: toNumber(raw['disk'] ?? raw['diskGb'] ?? raw['storage']),
    ipAddress:
      typeof raw['ip'] === 'string'
        ? raw['ip']
        : typeof ssh?.['host'] === 'string'
          ? String(ssh.host)
          : null,
    sshPort: toNumber(raw['sshPort'] ?? ssh?.['port']),
    vncHost:
      typeof raw['vncHost'] === 'string'
        ? raw['vncHost']
        : typeof vnc?.['host'] === 'string'
          ? String(vnc.host)
          : null,
    vncPort: toNumber(raw['vncPort'] ?? vnc?.['port']),
    storagePath:
      typeof raw['path'] === 'string'
        ? raw['path']
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

function buildCreateArgs(input: CreateVmInput): string[] {
  const args = [
    'create',
    input.name,
    '--os',
    input.os.toLowerCase(),
    '--cpu',
    String(input.cpu),
    '--memory',
    `${input.memoryGb}G`,
    '--disk',
    `${input.diskGb}G`,
    '--resolution',
    input.resolution,
    '--network',
    input.networkMode,
    '--storage',
    input.storagePath
  ]

  if (input.os === 'macOS' && input.macOsVersion.trim()) {
    args.push('--macos-version', input.macOsVersion.trim())
  }
  if (input.headless) args.push('--headless')
  if (input.background) args.push('--background')
  input.sharedDirectories.forEach((directory) => args.push('--shared-dir', directory))
  return args
}

function buildUpdateArgs(input: UpdateVmInput): string[] {
  const args = [
    'config',
    input.name,
    '--cpu',
    String(input.cpu),
    '--memory',
    `${input.memoryGb}G`,
    '--disk',
    `${input.diskGb}G`,
    '--resolution',
    input.resolution
  ]

  args.push(input.headless ? '--headless' : '--headful')
  args.push(input.background ? '--background' : '--foreground')
  input.sharedDirectories.forEach((directory) => args.push('--shared-dir', directory))
  return args
}

export class LumeManager {
  private serveProcess: ChildProcessWithoutNullStreams | null = null
  private serveLogs = ''
  private lastError: string | null = null

  private appendServeLogs(chunk: string): void {
    this.serveLogs = `${this.serveLogs}${chunk}`.slice(-12000)
  }

  async run(args: string[]): Promise<ExecOutcome> {
    try {
      const { stdout, stderr } = await execFileAsync('lume', args, {
        timeout: 120000,
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
        this.lastError = '未找到 lume 命令，请先安装并确保其在 PATH 中可访问。'
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
    const jsonResult = await this.run(['ls', '--json'])
    if (jsonResult.code === 0) {
      const parsed = parseJson<unknown>(jsonResult.stdout)
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
          )
          .map(summarizeVm)
      }
    }

    const result = await this.run(['ls'])
    return result.code === 0 ? parseTabularVmList(result.stdout) : []
  }

  async getVm(name: string): Promise<VmDetail> {
    const jsonResult = await this.run(['get', name, '--json'])
    if (jsonResult.code === 0) {
      const parsed = parseJson<Record<string, unknown>>(jsonResult.stdout)
      if (parsed) {
        const summary = summarizeVm(parsed)
        return {
          ...summary,
          config: parsed,
          raw: jsonResult.stdout,
          resolution: String(parsed['resolution'] ?? ''),
          headless: Boolean(parsed['headless']),
          background: Boolean(parsed['background']),
          sharedDirectories: Array.isArray(parsed['sharedDirectories'])
            ? parsed['sharedDirectories'].map((entry) => String(entry))
            : []
        }
      }
    }

    const result = await this.run(['get', name])
    const config = parseKeyValue(result.stdout)
    const summary = summarizeVm({ name, ...config })
    return {
      ...summary,
      config,
      raw: result.stdout,
      resolution: typeof config['Resolution'] === 'string' ? String(config['Resolution']) : null,
      headless: String(config['Headless'] ?? '').toLowerCase() === 'true',
      background: String(config['Background'] ?? '').toLowerCase() === 'true',
      sharedDirectories:
        typeof config['Shared Dirs'] === 'string'
          ? String(config['Shared Dirs'])
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean)
          : []
    }
  }

  async createVm(input: CreateVmInput): Promise<CommandResult> {
    const command = buildCreateArgs(input)
    const result = await this.run(command)
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async startVm(name: string): Promise<CommandResult> {
    const command = ['run', name]
    const result = await this.run(command)
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async stopVm(name: string): Promise<CommandResult> {
    const command = ['stop', name]
    const result = await this.run(command)
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async deleteVm(name: string): Promise<CommandResult> {
    const command = ['delete', name, '--yes']
    const result = await this.run(command)
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async updateVm(input: UpdateVmInput): Promise<CommandResult> {
    const command = buildUpdateArgs(input)
    const result = await this.run(command)
    return { success: result.code === 0, command: ['lume', ...command], ...result }
  }

  async listImages(): Promise<ImageSummary[]> {
    const jsonResult = await this.run(['images', 'list', '--json'])
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
