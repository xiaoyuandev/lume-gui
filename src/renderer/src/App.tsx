import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  AppStatus,
  CreateVmInput,
  UpdateVmInput,
  VmDetail,
  VmSummary,
  ImageSummary
} from '../../shared/types'

type View = 'overview' | 'create' | 'details' | 'settings'

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
    macOsVersion: 'latest',
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
  const [status, setStatus] = useState<AppStatus>(emptyStatus)
  const [settings, setSettings] = useState<AppSettings>(emptySettings)
  const [vmForm, setVmForm] = useState<CreateVmInput>(createInitialForm(emptySettings))
  const [vms, setVms] = useState<VmSummary[]>([])
  const [images, setImages] = useState<ImageSummary[]>([])
  const [selectedVm, setSelectedVm] = useState<VmDetail | null>(null)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingVmNames, setPendingVmNames] = useState<string[]>([])
  const [message, setMessage] = useState('')

  const runningCount = useMemo(() => vms.filter((vm) => vm.status === 'running').length, [vms])

  async function refreshDashboard(selectedName?: string): Promise<void> {
    const [nextStatus, nextVms, nextImages] = await Promise.all([
      window.api.getStatus(),
      window.api.listVms(),
      window.api.listImages()
    ])
    setStatus(nextStatus)
    setVms(nextVms)
    setImages(nextImages)

    const targetVm = selectedName ?? selectedVm?.name
    if (!targetVm) return

    try {
      const detail = await window.api.getVm(targetVm)
      const vmLogs = await window.api.getVmLogs(targetVm)
      setSelectedVm({ ...detail, logs: vmLogs })
      setLogs(vmLogs)
    } catch {
      setSelectedVm(null)
      setLogs('')
    }
  }

  useEffect(() => {
    void (async () => {
      const nextSettings = await window.api.getSettings()
      const [nextStatus, nextVms, nextImages] = await Promise.all([
        window.api.getStatus(),
        window.api.listVms(),
        window.api.listImages()
      ])

      setSettings(nextSettings)
      setVmForm(createInitialForm(nextSettings))
      setStatus(nextStatus)
      setVms(nextVms)
      setImages(nextImages)
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
      setMessage(error instanceof Error ? error.message : '操作失败')
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

  async function openVmDetails(name: string): Promise<void> {
    setView('details')
    await runAction(async () => {
      const detail = await window.api.getVm(name)
      const vmLogs = await window.api.getVmLogs(name)
      setSelectedVm({ ...detail, logs: vmLogs })
      setLogs(vmLogs)
    }, `已加载 ${name} 详情`)
  }

  async function mutateVm(
    vmName: string,
    action: () => Promise<{ success: boolean; stderr: string; stdout: string }>,
    successMessage: string,
    selectedName?: string
  ): Promise<void> {
    setVmPending(vmName, true)
    setMessage('')
    try {
      const result = await action()
      if (!result.success) {
        throw new Error(result.stderr || result.stdout || '命令执行失败')
      }
      await refreshDashboard(selectedName)
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      setVmPending(vmName, false)
    }
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
    }, '设置已保存')
  }

  async function pickDirectory(onPick: (directory: string) => void): Promise<void> {
    const directory = await window.api.chooseDirectory()
    if (!directory) return
    onPick(directory)
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="eyebrow">Electron + Lume</div>
          <h1>Lume GUI</h1>
          <p className="sidebar-copy">Apple Silicon 上的 macOS / Linux 虚拟机可视化控制台。</p>
        </div>

        <nav className="nav-list">
          <button
            className={view === 'overview' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('overview')}
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
            className={view === 'details' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView(selectedVm ? 'details' : 'overview')}
          >
            VM Details
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
                  '已重启 lume serve'
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
            <h2>可视化管理虚拟机生命周期、连接信息和宿主配置。</h2>
          </div>
          <div className="hero-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void runAction(() => refreshDashboard(), '数据已刷新')}
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
            未检测到 `lume` 命令。界面已完成，但实际命令执行依赖本机安装的 Lume CLI。
            {status.lastError ? ` 当前错误：${status.lastError}` : ''}
          </div>
        ) : null}

        {view === 'overview' ? (
          <section className="panel-grid">
            <section className="panel span-2">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Virtual Machines</div>
                  <h3>虚拟机列表</h3>
                </div>
                <button className="ghost-button" onClick={() => setView('create')}>
                  Create
                </button>
              </div>
              <div className="vm-table">
                <div className="table-head">
                  <span>Name</span>
                  <span>Status</span>
                  <span>OS</span>
                  <span>CPU / Memory / Disk</span>
                  <span>Actions</span>
                </div>
                {vms.length === 0 ? (
                  <div className="empty-state">还没有虚拟机，先创建一个。</div>
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
                            onClick={() =>
                              void mutateVm(
                                vm.name,
                                () => window.api.stopVm(vm.name),
                                `已停止 ${vm.name}`,
                                vm.name
                              )
                            }
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            className="primary-button"
                            disabled={isVmPending(vm.name)}
                            onClick={() =>
                              void mutateVm(
                                vm.name,
                                () => window.api.startVm(vm.name),
                                `已启动 ${vm.name}`,
                                vm.name
                              )
                            }
                          >
                            Start
                          </button>
                        )}
                        <button
                          className="danger-button"
                          disabled={isVmPending(vm.name)}
                          onClick={() => {
                            if (window.confirm(`确认删除虚拟机 ${vm.name} 吗？`)) {
                              void mutateVm(
                                vm.name,
                                () => window.api.deleteVm(vm.name),
                                `已删除 ${vm.name}`
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
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Images</div>
                  <h3>本地镜像缓存</h3>
                </div>
              </div>
              <div className="stack-list">
                {images.length === 0 ? (
                  <div className="empty-state">没有检测到本地镜像缓存。</div>
                ) : (
                  images.map((image) => (
                    <div className="list-card" key={`${image.name}-${image.version || 'latest'}`}>
                      <strong>{image.name}</strong>
                      <span>{image.version || 'latest'}</span>
                      <span>{image.size || 'size unknown'}</span>
                      <span className="muted-text">{image.path || 'cache path unavailable'}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Service Logs</div>
                  <h3>lume serve</h3>
                </div>
              </div>
              <pre className="log-viewer">{status.serveLogs || '暂无日志输出。'}</pre>
            </section>
          </section>
        ) : null}

        {view === 'create' ? (
          <section className="panel-grid">
            <section className="panel span-2">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Create</div>
                  <h3>创建虚拟机</h3>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  名称
                  <input
                    value={vmForm.name}
                    onChange={(event) => setVmForm({ ...vmForm, name: event.target.value })}
                  />
                </label>
                <label>
                  操作系统
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
                  内存 (GB)
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
                  磁盘 (GB)
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
                  分辨率
                  <input
                    value={vmForm.resolution}
                    onChange={(event) => setVmForm({ ...vmForm, resolution: event.target.value })}
                  />
                </label>
                <label>
                  macOS 版本
                  <input
                    disabled={vmForm.os !== 'macOS'}
                    value={vmForm.macOsVersion}
                    onChange={(event) => setVmForm({ ...vmForm, macOsVersion: event.target.value })}
                  />
                </label>
                <label>
                  网络模式
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
                    <option value="bridged">桥接</option>
                  </select>
                </label>
                <label className="wide">
                  存储路径
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
                <div className="wide">
                  <DirectoryListEditor
                    directories={vmForm.sharedDirectories}
                    title="共享目录"
                    emptyText="还没有共享目录。"
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
                  无头模式
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={vmForm.background}
                    onChange={(event) => setVmForm({ ...vmForm, background: event.target.checked })}
                  />
                  后台运行
                </label>
              </div>
              <div className="command-preview">Command Preview: lume create ...</div>
              <div className="hero-actions">
                <button
                  className="secondary-button"
                  onClick={() => setVmForm(createInitialForm(settings))}
                >
                  Reset
                </button>
                <button
                  className="primary-button"
                  disabled={busy || !vmForm.name.trim()}
                  onClick={() =>
                    void mutateVm(
                      vmForm.name,
                      async () => window.api.createVm(vmForm),
                      `已创建 ${vmForm.name}`,
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

            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Defaults</div>
                  <h3>创建默认值</h3>
                </div>
              </div>
              <div className="stack-list">
                <div className="list-card">
                  <strong>默认存储目录</strong>
                  <span className="muted-text">{settings.defaultStoragePath}</span>
                </div>
                <div className="list-card">
                  <strong>默认分辨率</strong>
                  <span>{settings.defaultResolution}</span>
                </div>
                <div className="list-card">
                  <strong>共享目录模板</strong>
                  <span className="muted-text">
                    {settings.sharedDirectories.length > 0
                      ? settings.sharedDirectories.join(', ')
                      : '未配置'}
                  </span>
                </div>
              </div>
            </section>
          </section>
        ) : null}

        {view === 'details' ? (
          <section className="panel-grid">
            <section className="panel span-2">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Details</div>
                  <h3>{selectedVm ? selectedVm.name : '选择一个虚拟机查看详情'}</h3>
                </div>
              </div>
              {!selectedVm ? (
                <div className="empty-state">先从虚拟机列表中选择一个实例。</div>
              ) : (
                <>
                  <div className="detail-grid">
                    <div className="detail-card">
                      <span className="muted-text">状态</span>
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
                      <span className="muted-text">资源</span>
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
                        内存 (GB)
                        <input
                          type="number"
                          min="1"
                          value={selectedVmUpdate.memoryGb}
                          onChange={(event) =>
                            setSelectedVm({ ...selectedVm, memoryGb: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        磁盘 (GB)
                        <input
                          type="number"
                          min="10"
                          value={selectedVmUpdate.diskGb}
                          onChange={(event) =>
                            setSelectedVm({ ...selectedVm, diskGb: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        分辨率
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
                          title="共享目录"
                          emptyText="还没有共享目录。"
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
                      无头模式
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedVm.background)}
                        onChange={(event) =>
                          setSelectedVm({ ...selectedVm, background: event.target.checked })
                        }
                      />
                      后台运行
                    </label>
                  </div>

                  <div className="hero-actions">
                    <button
                      className="secondary-button"
                      disabled={selectedVmBusy}
                      onClick={() =>
                        void mutateVm(
                          selectedVm.name,
                          () => window.api.stopVm(selectedVm.name),
                          `已停止 ${selectedVm.name}`,
                          selectedVm.name
                        )
                      }
                    >
                      Stop
                    </button>
                    <button
                      className="primary-button"
                      disabled={selectedVmBusy}
                      onClick={() =>
                        void mutateVm(
                          selectedVm.name,
                          () => window.api.startVm(selectedVm.name),
                          `已启动 ${selectedVm.name}`,
                          selectedVm.name
                        )
                      }
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
                          `已更新 ${selectedVm.name}`,
                          selectedVm.name
                        )
                      }
                    >
                      Save Changes
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Logs</div>
                  <h3>运行日志</h3>
                </div>
              </div>
              <pre className="log-viewer">{logs || '暂无日志。'}</pre>
            </section>
          </section>
        ) : null}

        {view === 'settings' ? (
          <section className="panel-grid">
            <section className="panel span-2">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Settings</div>
                  <h3>全局配置</h3>
                </div>
              </div>
              <div className="form-grid">
                <label className="wide">
                  默认存储路径
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
                  默认分辨率
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
                    title="默认共享目录"
                    emptyText="还没有默认共享目录。"
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
                  默认无头模式
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.autoStartServe}
                    onChange={(event) =>
                      setSettings({ ...settings, autoStartServe: event.target.checked })
                    }
                  />
                  启动时自动运行 lume serve
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.backgroundMode}
                    onChange={(event) =>
                      setSettings({ ...settings, backgroundMode: event.target.checked })
                    }
                  />
                  关闭窗口后继续后台运行
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.startAtLogin}
                    onChange={(event) =>
                      setSettings({ ...settings, startAtLogin: event.target.checked })
                    }
                  />
                  开机自启
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.allowAutoUpdate}
                    onChange={(event) =>
                      setSettings({ ...settings, allowAutoUpdate: event.target.checked })
                    }
                  />
                  允许自动更新 lume
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
