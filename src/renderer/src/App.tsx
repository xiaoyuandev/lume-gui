import { useEffect, useMemo, useState } from 'react'
import { buildCreateCommandPreview } from '../../shared/create-command'
import type {
  AppSettings,
  AppStatus,
  CreateVmInput,
  UpdateVmInput,
  VmDetail,
  VmSummary
} from '../../shared/types'

type View = 'overview' | 'create' | 'settings'
type OverviewTab = 'list' | 'details'

const emptyStatus: AppStatus = {
  lumeInstalled: false,
  lumeVersion: null,
  serveRunning: false,
  serveLogs: '',
  lastError: null
}

const emptySettings: AppSettings = {
  defaultStoragePath: '',
  defaultResolution: '1024x768',
  allowAutoUpdate: false,
  backgroundMode: true,
  autoStartServe: true,
  startAtLogin: false,
  defaultHeadless: false,
  sharedDirectories: []
}

function createInitialForm(settings: AppSettings): CreateVmInput {
  return {
    name: '',
    os: 'macOS',
    cpu: 8,
    memoryGb: 8,
    diskGb: 50,
    resolution: settings.defaultResolution,
    ipswSource: 'latest',
    ipswPath: '',
    unattendedEnabled: false,
    unattendedMode: 'preset',
    unattendedPreset: 'sequoia',
    unattendedFilePath: '',
    networkMode: 'nat',
    storagePath: settings.defaultStoragePath,
    headless: settings.defaultHeadless,
    sharedDirectories: settings.sharedDirectories,
    background: false
  }
}

function StatusPill({ status }: { status: VmSummary['status'] }): React.JSX.Element {
  return <span className={`status-pill status-${status}`}>{status}</span>
}

function DirectoryListEditor({
  directories,
  title,
  emptyText,
  onAdd,
  onRemove
}: {
  directories: string[]
  title: string
  emptyText: string
  onAdd: () => void
  onRemove: (directory: string) => void
}): React.JSX.Element {
  return (
    <div className="directory-editor">
      <div className="directory-header">
        <span>{title}</span>
        <button className="ghost-button" type="button" onClick={onAdd}>
          Add Directory
        </button>
      </div>
      {directories.length === 0 ? (
        <div className="empty-state compact">{emptyText}</div>
      ) : (
        <div className="directory-list">
          {directories.map((directory) => (
            <div className="directory-item" key={directory}>
              <span>{directory}</span>
              <button className="danger-button" type="button" onClick={() => onRemove(directory)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('overview')
  const [overviewTab, setOverviewTab] = useState<OverviewTab>('list')
  const [status, setStatus] = useState<AppStatus>(emptyStatus)
  const [settings, setSettings] = useState<AppSettings>(emptySettings)
  const [vmForm, setVmForm] = useState<CreateVmInput>(createInitialForm(emptySettings))
  const [vms, setVms] = useState<VmSummary[]>([])
  const [selectedVm, setSelectedVm] = useState<VmDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingVmNames, setPendingVmNames] = useState<string[]>([])
  const [message, setMessage] = useState('')

  const runningCount = useMemo(() => vms.filter((vm) => vm.status === 'running').length, [vms])

  async function refreshDashboard(selectedName?: string): Promise<void> {
    const [nextStatus, nextVms] = await Promise.all([window.api.getStatus(), window.api.listVms()])
    setStatus(nextStatus)
    setVms(nextVms)

    const targetVm = selectedName ?? selectedVm?.name
    if (!targetVm) return

    try {
      const detail = await window.api.getVm(targetVm)
      setSelectedVm(detail)
    } catch {
      setSelectedVm(null)
    }
  }

  useEffect(() => {
    void (async () => {
      const nextSettings = await window.api.getSettings()
      const [nextStatus, nextVms] = await Promise.all([
        window.api.getStatus(),
        window.api.listVms()
      ])

      setSettings(nextSettings)
      setVmForm(createInitialForm(nextSettings))
      setStatus(nextStatus)
      setVms(nextVms)
      setLoading(false)
    })()
  }, [])

  async function runAction(task: () => Promise<void>, successMessage: string): Promise<void> {
    setBusy(true)
    setMessage('')
    try {
      await task()
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }

  function setVmPending(name: string, active: boolean): void {
    setPendingVmNames((current) => {
      if (active) {
        return current.includes(name) ? current : [...current, name]
      }
      return current.filter((entry) => entry !== name)
    })
  }

  function isVmPending(name: string): boolean {
    return pendingVmNames.includes(name)
  }

  function patchVm(name: string, updater: (vm: VmSummary) => VmSummary): void {
    setVms((current) => current.map((vm) => (vm.name === name ? updater(vm) : vm)))
    setSelectedVm((current) =>
      current && current.name === name ? { ...current, ...updater(current) } : current
    )
  }

  async function refreshVmStatus(name: string, attempts = 12, intervalMs = 1500): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const nextVms = await window.api.listVms()
      setVms(nextVms)

      const vm = nextVms.find((entry) => entry.name === name)
      if (vm) {
        if (selectedVm?.name === name) {
          const detail = await window.api.getVm(name)
          setSelectedVm(detail)
        }

        if (vm.status !== 'starting' && vm.status !== 'stopping') {
          return
        }
      }

      await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
    }

    await refreshDashboard(name)
  }

  async function openVmDetails(name: string): Promise<void> {
    setView('overview')
    setOverviewTab('details')
    await runAction(async () => {
      const detail = await window.api.getVm(name)
      setSelectedVm(detail)
    }, `Loaded details for ${name}.`)
  }

  async function mutateVm(
    vmName: string,
    action: () => Promise<{ success: boolean; stderr: string; stdout: string }>,
    successMessage: string,
    selectedName?: string
  ): Promise<boolean> {
    setVmPending(vmName, true)
    setMessage('')
    try {
      const result = await action()
      if (!result.success) {
        throw new Error(result.stderr || result.stdout || 'Command execution failed.')
      }
      await refreshDashboard(selectedName)
      setMessage(successMessage)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed.')
      return false
    } finally {
      setVmPending(vmName, false)
    }
  }

  async function startVm(name: string): Promise<void> {
    patchVm(name, (vm) => ({ ...vm, status: 'starting' }))
    const success = await mutateVm(name, () => window.api.startVm(name), `Started ${name}.`, name)
    if (!success) {
      await refreshDashboard(name)
      return
    }
    await refreshVmStatus(name)
  }

  async function stopVm(name: string): Promise<void> {
    patchVm(name, (vm) => ({ ...vm, status: 'stopping' }))
    const success = await mutateVm(name, () => window.api.stopVm(name), `Stopped ${name}.`, name)
    if (!success) {
      await refreshDashboard(name)
      return
    }
    await refreshVmStatus(name)
  }

  async function saveAppSettings(): Promise<void> {
    await runAction(async () => {
      const next = await window.api.saveSettings(settings)
      setSettings(next)
      setVmForm((current) => ({
        ...current,
        resolution: current.resolution || next.defaultResolution,
        storagePath: current.storagePath || next.defaultStoragePath
      }))
      await refreshDashboard()
    }, 'Settings saved.')
  }

  async function pickDirectory(onPick: (directory: string) => void): Promise<void> {
    const directory = await window.api.chooseDirectory()
    if (!directory) return
    onPick(directory)
  }

  async function pickFile(
    filters: { name: string; extensions: string[] }[],
    onPick: (file: string) => void
  ): Promise<void> {
    const file = await window.api.chooseFile(filters)
    if (!file) return
    onPick(file)
  }

  async function appendDirectory(
    current: string[],
    onChange: (directories: string[]) => void
  ): Promise<void> {
    await pickDirectory((directory) => {
      if (current.includes(directory)) return
      onChange([...current, directory])
    })
  }

  async function copyToClipboard(text: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setMessage(successMessage)
    } catch {
      setMessage('Copy failed. Check clipboard permissions and try again.')
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading Lume GUI...</div>
  }

  const selectedVmUpdate: UpdateVmInput | null = selectedVm
    ? {
        name: selectedVm.name,
        cpu: selectedVm.cpu ?? 8,
        memoryGb: selectedVm.memoryGb ?? 8,
        diskGb: selectedVm.diskGb ?? 50,
        resolution: selectedVm.resolution || settings.defaultResolution,
        headless: Boolean(selectedVm.headless),
        sharedDirectories: selectedVm.sharedDirectories,
        background: Boolean(selectedVm.background)
      }
    : null
  const selectedVmBusy = selectedVm ? isVmPending(selectedVm.name) : false
  const createCommandPreview = buildCreateCommandPreview(vmForm)
  const hasDuplicateVmName = vms.some(
    (vm) => vm.name.trim().toLowerCase() === vmForm.name.trim().toLowerCase()
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="eyebrow">Lume GUI</div>
          <h1>Lume GUI</h1>
          <p className="sidebar-copy">A desktop control panel for Lume virtual machines on Apple Silicon.</p>
        </div>

        <nav className="nav-list">
          <button
            className={view === 'overview' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setView('overview')
              setOverviewTab('list')
            }}
          >
            Overview
          </button>
          <button
            className={view === 'create' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('create')}
          >
            Create VM
          </button>
          <button
            className={view === 'settings' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </nav>

        <div className="sidebar-status">
          <div className="metric-card accent">
            <div className="metric-label">Lume</div>
            <div className="metric-value">
              {status.lumeInstalled ? status.lumeVersion || 'Installed' : 'Missing'}
            </div>
          </div>
          <div className="metric-row">
            <div className="metric-card">
              <div className="metric-label">VMs</div>
              <div className="metric-value">{vms.length}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Running</div>
              <div className="metric-value">{runningCount}</div>
            </div>
          </div>
          <div className="serve-card">
            <div>
              <div className="metric-label">lume serve</div>
              <strong>{status.serveRunning ? 'Running' : 'Stopped'}</strong>
            </div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void runAction(
                  async () => setStatus(await window.api.restartServe()),
                  'Restarted lume serve.'
                )
              }
            >
              Restart
            </button>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <div className="eyebrow">Runtime</div>
            <h2>Manage VM lifecycle, connection info, and local runtime preferences in one place.</h2>
          </div>
          <div className="hero-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void runAction(() => refreshDashboard(), 'Dashboard refreshed.')}
            >
              Refresh
            </button>
            <button className="primary-button" disabled={busy} onClick={() => setView('create')}>
              New VM
            </button>
          </div>
        </header>

        {message ? <div className="message-banner">{message}</div> : null}
        {!status.lumeInstalled ? (
          <div className="warning-banner">
            The `lume` command is not available. The UI can load, but VM actions require the Lume
            CLI to be installed locally.
            {status.lastError ? ` Current error: ${status.lastError}` : ''}
          </div>
        ) : null}

        {view === 'overview' ? (
          <section className="panel-grid">
            <section className="panel full">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Virtual Machines</div>
                  <h3>Virtual Machine Manager</h3>
                </div>
                <div className="hero-actions">
                  {selectedVm ? (
                    <div className="subnav-tabs">
                      <button
                        className={overviewTab === 'list' ? 'subnav-tab active' : 'subnav-tab'}
                        onClick={() => setOverviewTab('list')}
                      >
                        List
                      </button>
                      <button
                        className={overviewTab === 'details' ? 'subnav-tab active' : 'subnav-tab'}
                        onClick={() => setOverviewTab('details')}
                      >
                        {selectedVm.name} Details
                      </button>
                    </div>
                  ) : null}
                  <button className="ghost-button" onClick={() => setView('create')}>
                    Create
                  </button>
                </div>
              </div>
              {overviewTab === 'list' ? (
                <div className="vm-table">
                  <div className="table-head">
                    <span>Name</span>
                    <span>Status</span>
                    <span>OS</span>
                    <span>CPU / Memory / Disk</span>
                    <span>Actions</span>
                  </div>
                  {vms.length === 0 ? (
                    <div className="empty-state">No virtual machines yet. Create one to get started.</div>
                  ) : (
                    vms.map((vm) => (
                      <div className="table-row" key={vm.name}>
                        <div>
                          <strong>{vm.name}</strong>
                          <div className="muted-text">{vm.storagePath || 'default storage'}</div>
                        </div>
                        <StatusPill status={vm.status} />
                        <span>{vm.os}</span>
                        <span>
                          {vm.cpu ?? '-'} CPU / {vm.memoryGb ?? '-'} GB / {vm.diskGb ?? '-'} GB
                        </span>
                        <div className="action-row">
                          <button
                            className="ghost-button"
                            disabled={isVmPending(vm.name)}
                            onClick={() => void openVmDetails(vm.name)}
                          >
                            Details
                          </button>
                          {vm.status === 'running' ? (
                            <button
                              className="secondary-button"
                              disabled={isVmPending(vm.name)}
                              onClick={() => void stopVm(vm.name)}
                            >
                              Stop
                            </button>
                          ) : (
                            <button
                              className="primary-button"
                              disabled={isVmPending(vm.name)}
                              onClick={() => void startVm(vm.name)}
                            >
                              Start
                            </button>
                          )}
                          <button
                            className="danger-button"
                            disabled={isVmPending(vm.name)}
                            onClick={() => {
                              if (window.confirm(`Delete virtual machine ${vm.name}?`)) {
                                void mutateVm(
                                  vm.name,
                                  () => window.api.deleteVm(vm.name),
                                  `Deleted ${vm.name}.`
                                )
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="embedded-detail">
                  {!selectedVm ? (
                    <div className="empty-state">Select a virtual machine from the list to inspect and edit it.</div>
                  ) : (
                    <>
                      <div className="detail-grid">
                        <div className="detail-card">
                          <span className="muted-text">Status</span>
                          <StatusPill status={selectedVm.status} />
                        </div>
                        <div className="detail-card">
                          <span className="muted-text">VNC</span>
                          <strong>
                            {selectedVm.vncHost || '127.0.0.1'}:{selectedVm.vncPort || 'n/a'}
                          </strong>
                        </div>
                        <div className="detail-card">
                          <span className="muted-text">SSH</span>
                          <strong>
                            {selectedVm.ipAddress || 'n/a'}:{selectedVm.sshPort || '22'}
                          </strong>
                        </div>
                        <div className="detail-card">
                          <span className="muted-text">Resources</span>
                          <strong>
                            {selectedVm.cpu ?? '-'} CPU / {selectedVm.memoryGb ?? '-'} GB /{' '}
                            {selectedVm.diskGb ?? '-'} GB
                          </strong>
                        </div>
                      </div>

                      {selectedVmUpdate ? (
                        <div className="form-grid compact">
                          <label>
                            CPU
                            <input
                              type="number"
                              min="1"
                              value={selectedVmUpdate.cpu}
                              onChange={(event) =>
                                setSelectedVm({ ...selectedVm, cpu: Number(event.target.value) })
                              }
                            />
                          </label>
                          <label>
                            Memory (GB)
                            <input
                              type="number"
                              min="1"
                              value={selectedVmUpdate.memoryGb}
                              onChange={(event) =>
                                setSelectedVm({
                                  ...selectedVm,
                                  memoryGb: Number(event.target.value)
                                })
                              }
                            />
                          </label>
                          <label>
                            Disk (GB)
                            <input
                              type="number"
                              min="10"
                              value={selectedVmUpdate.diskGb}
                              onChange={(event) =>
                                setSelectedVm({
                                  ...selectedVm,
                                  diskGb: Number(event.target.value)
                                })
                              }
                            />
                          </label>
                          <label>
                            Display
                            <input
                              value={selectedVmUpdate.resolution}
                              onChange={(event) =>
                                setSelectedVm({ ...selectedVm, resolution: event.target.value })
                              }
                            />
                          </label>
                          <div className="wide">
                            <DirectoryListEditor
                              directories={selectedVmUpdate.sharedDirectories}
                              title="Shared Directories"
                              emptyText="No shared directories configured."
                              onAdd={() =>
                                void appendDirectory(
                                  selectedVmUpdate.sharedDirectories,
                                  (sharedDirectories) =>
                                    setSelectedVm({
                                      ...selectedVm,
                                      sharedDirectories
                                    })
                                )
                              }
                              onRemove={(directory) =>
                                setSelectedVm({
                                  ...selectedVm,
                                  sharedDirectories: selectedVmUpdate.sharedDirectories.filter(
                                    (entry) => entry !== directory
                                  )
                                })
                              }
                            />
                          </div>
                        </div>
                      ) : null}

                      <div className="toggle-row">
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedVm.headless)}
                            onChange={(event) =>
                              setSelectedVm({ ...selectedVm, headless: event.target.checked })
                            }
                          />
                          Headless Launch
                        </label>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedVm.background)}
                            onChange={(event) =>
                              setSelectedVm({ ...selectedVm, background: event.target.checked })
                            }
                          />
                          Background Start
                        </label>
                      </div>

                      <div className="detail-note">
                        Headless, background, and shared directory preferences are stored by this
                        app and applied on future `lume run` actions. Lume CLI `set` does not
                        persist them directly.
                      </div>

                      <div className="hero-actions">
                        <button
                          className="secondary-button"
                          disabled={selectedVmBusy}
                          onClick={() => void stopVm(selectedVm.name)}
                        >
                          Stop
                        </button>
                        <button
                          className="primary-button"
                          disabled={selectedVmBusy}
                          onClick={() => void startVm(selectedVm.name)}
                        >
                          Start
                        </button>
                        <button
                          className="ghost-button"
                          disabled={selectedVmBusy}
                          onClick={() =>
                            void mutateVm(
                              selectedVm.name,
                              () =>
                                window.api.updateVm({
                                  name: selectedVm.name,
                                  cpu: selectedVm.cpu ?? 8,
                                  memoryGb: selectedVm.memoryGb ?? 8,
                                  diskGb: selectedVm.diskGb ?? 50,
                                  resolution: selectedVm.resolution || settings.defaultResolution,
                                  headless: Boolean(selectedVm.headless),
                                  sharedDirectories: selectedVm.sharedDirectories,
                                  background: Boolean(selectedVm.background)
                                }),
                              `Updated ${selectedVm.name}.`,
                              selectedVm.name
                            )
                          }
                        >
                          Save Changes
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>

          </section>
        ) : null}

        {view === 'create' ? (
          <section className="panel-grid">
            <section className="panel span-2">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Create</div>
                  <h3>Create Virtual Machine</h3>
                </div>
              </div>
              {hasDuplicateVmName && vmForm.name.trim() ? (
                <div className="warning-banner">
                  A virtual machine with this name already exists. Choose a different name.
                </div>
              ) : null}
              <div className="form-grid">
                <label>
                  Name
                  <input
                    value={vmForm.name}
                    onChange={(event) => setVmForm({ ...vmForm, name: event.target.value })}
                  />
                </label>
                <label>
                  Operating System
                  <select
                    value={vmForm.os}
                    onChange={(event) =>
                      setVmForm({ ...vmForm, os: event.target.value as CreateVmInput['os'] })
                    }
                  >
                    <option value="macOS">macOS</option>
                    <option value="Linux">Linux</option>
                  </select>
                </label>
                <label>
                  CPU
                  <input
                    type="number"
                    min="1"
                    value={vmForm.cpu}
                    onChange={(event) => setVmForm({ ...vmForm, cpu: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Memory (GB)
                  <input
                    type="number"
                    min="1"
                    value={vmForm.memoryGb}
                    onChange={(event) =>
                      setVmForm({ ...vmForm, memoryGb: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  Disk (GB)
                  <input
                    type="number"
                    min="10"
                    value={vmForm.diskGb}
                    onChange={(event) =>
                      setVmForm({ ...vmForm, diskGb: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  Display
                  <input
                    value={vmForm.resolution}
                    onChange={(event) => setVmForm({ ...vmForm, resolution: event.target.value })}
                  />
                </label>
                {vmForm.os === 'macOS' ? (
                  <>
                    <label>
                      IPSW Source
                      <select
                        value={vmForm.ipswSource}
                        onChange={(event) =>
                          setVmForm({
                            ...vmForm,
                            ipswSource: event.target.value as CreateVmInput['ipswSource']
                          })
                        }
                      >
                        <option value="latest">Let Lume download the latest image</option>
                        <option value="local">Use a local IPSW file</option>
                      </select>
                    </label>
                    <label>
                      Unattended Setup
                      <select
                        value={vmForm.unattendedEnabled ? 'enabled' : 'disabled'}
                        onChange={(event) =>
                          setVmForm({
                            ...vmForm,
                            unattendedEnabled: event.target.value === 'enabled'
                          })
                        }
                      >
                        <option value="disabled">Disabled</option>
                        <option value="enabled">Enabled</option>
                      </select>
                    </label>
                  </>
                ) : null}
                <label>
                  Network Mode
                  <select
                    value={vmForm.networkMode}
                    onChange={(event) =>
                      setVmForm({
                        ...vmForm,
                        networkMode: event.target.value as CreateVmInput['networkMode']
                      })
                    }
                  >
                    <option value="nat">NAT</option>
                    <option value="bridged">Bridged</option>
                  </select>
                </label>
                <label className="wide">
                  Storage Path
                  <div className="input-row">
                    <input
                      value={vmForm.storagePath}
                      onChange={(event) =>
                        setVmForm({ ...vmForm, storagePath: event.target.value })
                      }
                    />
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        void pickDirectory((directory) =>
                          setVmForm({ ...vmForm, storagePath: directory })
                        )
                      }
                    >
                      Browse
                    </button>
                  </div>
                </label>
                {vmForm.os === 'macOS' && vmForm.ipswSource === 'local' ? (
                  <label className="wide">
                    Local IPSW File
                    <div className="input-row">
                      <input value={vmForm.ipswPath} readOnly />
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() =>
                          void pickFile([{ name: 'IPSW', extensions: ['ipsw'] }], (ipswPath) =>
                            setVmForm({ ...vmForm, ipswPath })
                          )
                        }
                      >
                        Choose IPSW
                      </button>
                    </div>
                  </label>
                ) : null}
                {vmForm.os === 'macOS' && vmForm.unattendedEnabled ? (
                  <>
                    <label>
                      Unattended Mode
                      <select
                        value={vmForm.unattendedMode}
                        onChange={(event) =>
                          setVmForm({
                            ...vmForm,
                            unattendedMode: event.target.value as CreateVmInput['unattendedMode']
                          })
                        }
                      >
                        <option value="preset">Built-in preset</option>
                        <option value="file">Local YAML file</option>
                      </select>
                    </label>
                    {vmForm.unattendedMode === 'preset' ? (
                      <label>
                        unattended preset
                        <select
                          value={vmForm.unattendedPreset}
                          onChange={(event) =>
                            setVmForm({ ...vmForm, unattendedPreset: event.target.value })
                          }
                        >
                          <option value="sequoia">sequoia</option>
                          <option value="tahoe">tahoe</option>
                        </select>
                      </label>
                    ) : (
                      <label className="wide">
                        unattended YAML
                        <div className="input-row">
                          <input value={vmForm.unattendedFilePath} readOnly />
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() =>
                              void pickFile(
                                [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
                                (unattendedFilePath) => setVmForm({ ...vmForm, unattendedFilePath })
                              )
                            }
                          >
                            Choose YAML
                          </button>
                        </div>
                      </label>
                    )}
                  </>
                ) : null}
                <div className="wide">
                  <DirectoryListEditor
                    directories={vmForm.sharedDirectories}
                    title="Shared Directories"
                    emptyText="No shared directories configured."
                    onAdd={() =>
                      void appendDirectory(vmForm.sharedDirectories, (sharedDirectories) =>
                        setVmForm({ ...vmForm, sharedDirectories })
                      )
                    }
                    onRemove={(directory) =>
                      setVmForm({
                        ...vmForm,
                        sharedDirectories: vmForm.sharedDirectories.filter(
                          (entry) => entry !== directory
                        )
                      })
                    }
                  />
                </div>
              </div>
              <div className="toggle-row">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={vmForm.headless}
                    onChange={(event) => setVmForm({ ...vmForm, headless: event.target.checked })}
                  />
                  Headless Launch
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={vmForm.background}
                    onChange={(event) => setVmForm({ ...vmForm, background: event.target.checked })}
                  />
                  Background Start
                </label>
              </div>
              <div className="command-preview-block">
                <div className="directory-header">
                  <span>Command Preview</span>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() =>
                      void copyToClipboard(createCommandPreview, 'Create command copied to clipboard.')
                    }
                  >
                    Copy
                  </button>
                </div>
                <pre className="command-preview">{createCommandPreview}</pre>
              </div>
              <div className="hero-actions">
                <button
                  className="secondary-button"
                  onClick={() => setVmForm(createInitialForm(settings))}
                >
                  Reset
                </button>
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    hasDuplicateVmName ||
                    !vmForm.name.trim() ||
                    (vmForm.os === 'macOS' && vmForm.ipswSource === 'local' && !vmForm.ipswPath) ||
                    (vmForm.os === 'macOS' &&
                      vmForm.unattendedEnabled &&
                      vmForm.unattendedMode === 'file' &&
                      !vmForm.unattendedFilePath)
                  }
                  onClick={() =>
                    void mutateVm(
                      vmForm.name,
                      async () => window.api.createVm(vmForm),
                      `Created ${vmForm.name}.`,
                      vmForm.name
                    ).then(() => {
                      setView('overview')
                      setVmForm(createInitialForm(settings))
                    })
                  }
                >
                  Create VM
                </button>
              </div>
            </section>
          </section>
        ) : null}

        {view === 'settings' ? (
          <section className="panel-grid">
            <section className="panel span-2">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Settings</div>
                  <h3>Global Preferences</h3>
                </div>
              </div>
              <div className="form-grid">
                <label className="wide">
                  Default Storage Path
                  <div className="input-row">
                    <input
                      value={settings.defaultStoragePath}
                      onChange={(event) =>
                        setSettings({ ...settings, defaultStoragePath: event.target.value })
                      }
                    />
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        void pickDirectory((directory) =>
                          setSettings({ ...settings, defaultStoragePath: directory })
                        )
                      }
                    >
                      Browse
                    </button>
                  </div>
                </label>
                <label>
                  Default Display
                  <input
                    value={settings.defaultResolution}
                    onChange={(event) =>
                      setSettings({ ...settings, defaultResolution: event.target.value })
                    }
                  />
                </label>
                <div className="wide">
                  <DirectoryListEditor
                    directories={settings.sharedDirectories}
                    title="Default Shared Directories"
                    emptyText="No default shared directories configured."
                    onAdd={() =>
                      void appendDirectory(settings.sharedDirectories, (sharedDirectories) =>
                        setSettings({ ...settings, sharedDirectories })
                      )
                    }
                    onRemove={(directory) =>
                      setSettings({
                        ...settings,
                        sharedDirectories: settings.sharedDirectories.filter(
                          (entry) => entry !== directory
                        )
                      })
                    }
                  />
                </div>
              </div>
              <div className="toggle-grid">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.defaultHeadless}
                    onChange={(event) =>
                      setSettings({ ...settings, defaultHeadless: event.target.checked })
                    }
                  />
                  Default Headless Launch
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.autoStartServe}
                    onChange={(event) =>
                      setSettings({ ...settings, autoStartServe: event.target.checked })
                    }
                  />
                  Start `lume serve` on app launch
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.backgroundMode}
                    onChange={(event) =>
                      setSettings({ ...settings, backgroundMode: event.target.checked })
                    }
                  />
                  Keep the app running in the background after closing the window
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.startAtLogin}
                    onChange={(event) =>
                      setSettings({ ...settings, startAtLogin: event.target.checked })
                    }
                  />
                  Launch at login
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.allowAutoUpdate}
                    onChange={(event) =>
                      setSettings({ ...settings, allowAutoUpdate: event.target.checked })
                    }
                  />
                  Allow automatic Lume updates
                </label>
              </div>
              <div className="hero-actions">
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void saveAppSettings()}
                >
                  Save Settings
                </button>
              </div>
            </section>
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default App
