import React from 'react'
import {
  AlertTriangle,
  CalendarClock,
  FolderSearch,
  HardDrive,
  LayoutDashboard,
  Minus,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Square,
  X,
  Zap
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppStatus, DeepPartial, DefragJob, DefragRequest, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { api, isMock } from './api'
import { AppContext, type AppContextValue, type PageId, type ToastPayload } from './lib/context'
import { DiskMark } from './components/ui'
import DashboardPage from './pages/Dashboard'
import DefragPage from './pages/Defrag'
import LargeFilesPage from './pages/LargeFiles'
import HealthPage from './pages/Health'
import SchedulePage from './pages/Schedule'
import LibrariesPage from './pages/Libraries'
import ActionCenterPage from './pages/ActionCenter'
import LogsPage from './pages/Logs'
import SettingsPage from './pages/Settings'

const NAV: Array<{ id: PageId; label: string; icon: LucideIcon; section: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'Disks' },
  { id: 'defrag', label: 'Defrag', icon: Zap, section: 'Disks' },
  { id: 'largefiles', label: 'Large Files', icon: FolderSearch, section: 'Disks' },
  { id: 'health', label: 'Disk Health', icon: HardDrive, section: 'Disks' },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock, section: 'Automation' },
  { id: 'libraries', label: 'Game & App Boost', icon: ShieldCheck, section: 'Automation' },
  { id: 'actioncenter', label: 'Action Center', icon: AlertTriangle, section: 'Manage' },
  { id: 'logs', label: 'Logs', icon: ScrollText, section: 'Manage' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, section: 'Manage' }
]

interface ToastItem extends ToastPayload {
  id: number
}

export default function App(): React.JSX.Element {
  const [page, setPage] = React.useState<PageId>('dashboard')
  const [status, setStatus] = React.useState<AppStatus | null>(null)
  const [settings, setSettings] = React.useState<Settings>(structuredClone(DEFAULT_SETTINGS))
  const [job, setJob] = React.useState<DefragJob | null>(null)
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const pushToast = React.useCallback((toast: ToastPayload) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }])
    const ttl = Math.max(3000, (settings.notifications.displaySeconds || 5) * 1000)
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl)
  }, [settings.notifications.displaySeconds])

  const refreshStatus = React.useCallback(async () => {
    setStatus(await api.getStatus())
  }, [])

  React.useEffect(() => {
    void (async () => {
      const [nextSettings, currentJob] = await Promise.all([api.getSettings(), api.getJob()])
      setSettings(nextSettings)
      setJob(currentJob)
      await refreshStatus()
    })()
  }, [refreshStatus])

  React.useEffect(() => {
    const interval = setInterval(() => void refreshStatus(), 5000)
    return () => clearInterval(interval)
  }, [refreshStatus])

  React.useEffect(() => {
    const offJob = api.onJobProgress((next) => setJob(next))
    const offStatus = api.onStatus((next) => setStatus(next))
    const offNotify = api.onNotification((payload) => {
      pushToast({
        title: payload.title,
        body: payload.body,
        level: payload.level === 'threat' ? 'threat' : payload.level === 'warn' ? 'warn' : 'info'
      })
    })
    const offNav = api.onNavigate((target) => setPage(target as PageId))
    return () => {
      offJob()
      offStatus()
      offNotify()
      offNav()
    }
  }, [pushToast])

  const saveSettings = React.useCallback(
    async (patch: DeepPartial<Settings>) => {
      const next = await api.saveSettings(patch)
      setSettings(next)
      await refreshStatus()
    },
    [refreshStatus]
  )

  const runJob = React.useCallback(
    async (request: DefragRequest): Promise<DefragJob> => {
      setPage('defrag')
      const result = await api.startJob(request)
      setJob(result)
      if (result.state === 'needs-elevation') {
        pushToast({ title: 'Administrator required', body: result.elevationHint ?? 'Relaunch elevated to run the Windows optimizer.', level: 'warn' })
      } else if (result.state === 'failed') {
        pushToast({ title: 'Operation failed', body: result.error ?? 'See the Defrag log.', level: 'error' })
      }
      await refreshStatus()
      return result
    },
    [pushToast, refreshStatus]
  )

  const cancelJob = React.useCallback(async () => {
    await api.cancelJob()
    pushToast({ title: 'Cancelling', body: 'The running optimizer will stop at the next safe point.', level: 'warn' })
  }, [pushToast])

  const elevate = React.useCallback(async () => {
    const result = await api.relaunchElevated()
    pushToast({
      title: result.ok ? 'Elevation requested' : 'Elevation failed',
      body: result.message,
      level: result.ok ? 'success' : 'error'
    })
  }, [pushToast])

  const ctx: AppContextValue = {
    status,
    settings,
    job,
    busy: job?.state === 'running',
    refreshStatus,
    saveSettings,
    navigate: setPage,
    pushToast,
    runJob,
    cancelJob,
    elevate
  }

  const grouped = NAV.reduce<Record<string, typeof NAV>>((acc, item) => {
    acc[item.section] = acc[item.section] ?? []
    acc[item.section].push(item)
    return acc
  }, {})

  const issueCount = status?.issues.length ?? 0

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="titlebar">
          <div className="brand">
            <DiskMark size={20} />
            <span>Ultra Harddisk Defrag</span>
            <small>1.0</small>
          </div>
          {isMock ? (
            <div className="capsule" title="Browser preview without the Electron bridge">
              <span className="dot amber" /> Preview mode
            </div>
          ) : null}
          <div className="spacer" />
          {status ? (
            <>
              <div className="capsule" title="Elevation decides whether the Windows storage optimizer can run">
                <span className={`dot ${status.elevated ? 'green' : 'rose'}`} />
                {status.elevated ? 'Administrator' : 'Standard user'}
              </div>
              <div className="capsule" title={status.defragEngine}>
                <span className={`dot ${status.engineAvailable ? 'green' : 'rose'}`} /> defrag.exe
              </div>
              {status.onBattery ? <div className="capsule"><span className="dot amber" /> Battery</div> : null}
            </>
          ) : null}
          <div className="win-controls">
            <button onClick={() => api.windowMinimize()} title="Minimize">
              <Minus size={14} />
            </button>
            <button onClick={() => api.windowMaximize()} title="Maximize">
              <Square size={12} />
            </button>
            <button className="close" onClick={() => api.windowClose()} title="Close">
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="shell">
          <nav className="sidebar">
            {Object.entries(grouped).map(([section, items]) => (
              <React.Fragment key={section}>
                <div className="section-label">{section}</div>
                {items.map((item) => {
                  const Icon = item.icon
                  const badge = item.id === 'actioncenter' ? issueCount : 0
                  return (
                    <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>
                      <Icon size={16} strokeWidth={1.9} />
                      <span>{item.label}</span>
                      {badge > 0 ? <span className="badge">{badge}</span> : null}
                    </button>
                  )
                })}
              </React.Fragment>
            ))}
            <div className="footer">
              <div>{status?.volumes.length ?? 0} volume(s) · {status?.health?.physicalDisks.length ?? 0} disk(s)</div>
              <div style={{ marginTop: 2 }}>{status ? status.host : '—'}</div>
            </div>
          </nav>

          <main className="main">
            {page === 'dashboard' ? <DashboardPage /> : null}
            {page === 'defrag' ? <DefragPage /> : null}
            {page === 'largefiles' ? <LargeFilesPage /> : null}
            {page === 'health' ? <HealthPage /> : null}
            {page === 'schedule' ? <SchedulePage /> : null}
            {page === 'libraries' ? <LibrariesPage /> : null}
            {page === 'actioncenter' ? <ActionCenterPage /> : null}
            {page === 'logs' ? <LogsPage /> : null}
            {page === 'settings' ? <SettingsPage /> : null}
          </main>
        </div>

        <div className="toast">
          {toasts.map((toast) => (
            <div key={toast.id} className={`item ${toast.level}`}>
              <div className="t">{toast.title}</div>
              <div className="b">{toast.body}</div>
            </div>
          ))}
        </div>
      </div>
    </AppContext.Provider>
  )
}
