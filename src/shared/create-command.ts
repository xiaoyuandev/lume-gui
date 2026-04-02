import type { CreateVmInput } from './types'

export function buildCreateArgs(input: CreateVmInput): string[] {
  const args = [
    'create',
    '--os',
    input.os,
    '--cpu',
    String(input.cpu),
    '--memory',
    String(input.memoryGb),
    '--disk-size',
    String(input.diskGb),
    '--display',
    input.resolution,
    '--network',
    input.networkMode,
    '--storage',
    input.storagePath
  ]

  if (input.os === 'macOS') {
    args.push('--ipsw', input.ipswSource === 'local' ? input.ipswPath.trim() : 'latest')
  }

  if (input.unattendedEnabled) {
    const unattendedValue =
      input.unattendedMode === 'file'
        ? input.unattendedFilePath.trim()
        : input.unattendedPreset.trim()
    if (unattendedValue) {
      args.push('--unattended', unattendedValue)
    }
  }

  if (input.headless) {
    args.push('--no-display')
  }

  args.push(input.name.trim())
  return args
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildCreateCommandPreview(input: CreateVmInput): string {
  return ['lume', ...buildCreateArgs(input)].map(shellQuote).join(' ')
}
