import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, shell, Tray } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPaths, ensureDirs, nowIso } from './engine/runtime'
import { Store } from './engine/store'
import { DefragRunner, ACTION_LABELS, engineInfo } from './engine/defrag'
import { diskHealth, listVolumes } from './engine/volumes'
import { detectLibraries, scanLargeFiles } from './engine/libraries'
import { isElevated, powershell, run, runPowerShell, systemExecutable } from './engine/shell'
import {
  DEFAULT_SETTINGS,
  type ActionCenterIssue,
  type AppStatus,
  type DefragAction,
  type DefragCommand,
  type DefragJob,
  type DefragRequest,
  type DeepPartial,
  type DiskHealth,
  type LogEntry,
  type OptimizeHistoryEntry,
  type Settings,
  type VolumeInfo
} from '../shared/types'

app.setName('Ultra Harddisk Defrag')

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: Store
let runner: DefragRunner
let env = { host: '', os: '', elevated: false }
let engineAvailable = false
let engineText = ''
let volumes: VolumeInfo[] = []
let health: DiskHealth | null = null
let lastJob: DefragJob | null = null
let quitting = false
let schedulerTimer: NodeJS.Timeout | null = null
let refreshTimer: NodeJS.Timeout | null = null
let schedulerRunning = false
let batchRunning = false
let batchCancelled = false
type PowerAction = NonNullable<AppStatus['pendingPowerAction']>['action']
let pendingPowerAction: { action: PowerAction; dueAt: number; timer: NodeJS.Timeout } | null = null
let silentCache = { at: 0, active: false }
let volumesRefreshedAt = 0
let warnedDisks = new Set<string>()
let volumeRefresh: Promise<void> | null = null
const APP_ID = 'work.selman.ultra-harddisk-defrag'

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

/** Unpackaged runs report Electron's version; read the real one from package.json. */
function appVersion(): string {
  if (app.isPackaged) return app.getVersion()
  try {
    const pkg = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '1.0.0'
  } catch {
    return '1.0.0'
  }
}

/** build/ is not packed into the asar, so the packaged build reads the copied resource. */
function nativeIcon(): Electron.NativeImage {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png'), path.join(app.getAppPath(), 'build', 'icon.png')]
    : [path.join(app.getAppPath(), 'build', 'icon.png')]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return nativeImage.createFromPath(candidate)
  }
  return nativeImage.createEmpty()
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body }).show()
}

async function detectEnv(): Promise<void> {
  const { hostname, type, release, arch } = await import('node:os').then((os) => ({
    hostname: os.hostname(),
    type: os.type(),
    release: os.release(),
    arch: os.arch()
  }))
  const elevated = await isElevated()
  env = { host: hostname, os: `${type} ${release} ${arch}`.trim(), elevated }
}

async function refreshVolumes(force = false): Promise<void> {
  if (volumeRefresh) return volumeRefresh
  if (!force && Date.now() - volumesRefreshedAt < 15_000 && volumes.length) return
  volumeRefresh = loadVolumes().finally(() => { volumeRefresh = null })
  return volumeRefresh
}

async function loadVolumes(): Promise<void> {
  const fresh = await listVolumes()
  const nextHealth = await diskHealth(fresh)
  const previous = new Map(volumes.map((v) => [v.id, v.fragmentation]))
  const memory = store.volumeState()
  for (const volume of fresh) {
    if (!volume.letter) continue
    const record = memory[volume.id] ?? memory[volume.letter]
    if (record) {
      volume.lastOptimizedAt = record.lastOptimizedAt
      volume.lastAction = record.lastAction
    }
    const memo = previous.get(volume.id)
    if (memo) volume.fragmentation = memo
    if (volume.fileSystem.toUpperCase() === 'NTFS' && volume.mediaType === 'SSD') volume.trimSupported = nextHealth.trimEnabled
  }
  volumes = fresh
  health = nextHealth
  volumesRefreshedAt = Date.now()
  const diskIssues = actionCenterIssues().filter((issue) => issue.id.startsWith('health-'))
  if (store.settings().notifications.healthWarning) {
    for (const issue of diskIssues) {
      if (!warnedDisks.has(issue.title)) notify(issue.title, issue.detail)
    }
    warnedDisks = new Set(diskIssues.map((issue) => issue.title))
  }
}

function scheduledNextRun(): string | null {
  const schedule = store.settings().scheduled
  if (!schedule.enabled) return null
  const now = new Date()
  const next = new Date(now)
  next.setHours(schedule.hour, schedule.minute, 0, 0)
  if (schedule.cadence === 'daily') {
    if (next <= now) next.setDate(next.getDate() + 1)
  } else if (schedule.cadence === 'weekly') {
    const delta = (schedule.weekday - now.getDay() + 7) % 7
    next.setDate(now.getDate() + delta)
    if (next <= now) next.setDate(next.getDate() + 7)
  } else {
    next.setDate(schedule.dayOfMonth)
    if (next <= now) next.setMonth(next.getMonth() + 1, schedule.dayOfMonth)
  }
  return next.toISOString()
}

function actionCenterIssues(): ActionCenterIssue[] {
  const settings = store.settings()
  const issues: ActionCenterIssue[] = []

  if (!env.elevated) {
    issues.push({
      id: 'not-elevated',
      title: 'Analyze and optimize need Administrator',
      detail: 'Windows refuses all storage-optimizer operations without elevation (0x89000024). Relaunch elevated to use the real engine.',
      severity: 'high',
      fixId: 'elevate'
    })
  }
  if (!engineAvailable) {
    issues.push({
      id: 'engine-missing',
      title: 'The Windows storage optimizer is unavailable',
      detail: 'defrag.exe did not answer its usage request. Analysis and optimization cannot run.',
      severity: 'high',
      fixId: 'none'
    })
  }
  const analyzed = volumes.some((v) => v.fragmentation)
  if (env.elevated && !analyzed) {
    issues.push({
      id: 'never-analyzed',
      title: 'No volume has been analyzed yet',
      detail: 'Run Analyze on a volume to see its fragmentation level, then optimize if it is above the threshold.',
      severity: 'medium',
      fixId: 'analyze'
    })
  }
  for (const volume of volumes) {
    if (!volume.letter || volume.kind !== 'fixed') continue
    const percent = volume.fragmentation?.totalFragmentedSpacePercent ?? null
    if (percent !== null && percent >= settings.autoDefrag.thresholdPercent && volume.mediaType !== 'SSD') {
      issues.push({
        id: `fragmented-${volume.letter}`,
        title: `${volume.letter} is ${percent}% fragmented`,
        detail: `Threshold is ${settings.autoDefrag.thresholdPercent}%. A defrag pass should bring it down.`,
        severity: percent >= 20 ? 'high' : 'medium',
        fixId: `optimize:${volume.letter}`
      })
    }
    if (volume.mediaType === 'SSD' && (!volume.lastOptimizedAt || Date.now() - new Date(volume.lastOptimizedAt).getTime() > 30 * 86_400_000)) {
      issues.push({
        id: `ssd-trim-${volume.letter}`,
        title: `${volume.letter} (SSD) has not been retrimmed recently`,
        detail: 'SSDs should be trimmed, not defragmented. Trim & Intelligent Optimize releases free blocks and keeps write performance.',
        severity: 'low',
        fixId: `retrim:${volume.letter}`
      })
    }
  }
  if (!settings.autoDefrag.enabled && !settings.scheduled.enabled) {
    issues.push({
      id: 'no-automation',
      title: 'Nothing is scheduled',
      detail: 'Auto Defrag (idle) and Scheduled Defrag are both off, so the disks only get attention when you ask.',
      severity: 'low',
      fixId: 'enable-automation'
    })
  }
  for (const disk of health?.physicalDisks ?? []) {
    const unhealthy = /^(warning|unhealthy)$/i.test(disk.health.trim())
    const wornOut = disk.wear !== null && disk.wear >= 90
    if (unhealthy || wornOut) {
      issues.push({
        id: `health-${disk.deviceId}`,
        title: `${disk.name} reports ${unhealthy ? disk.health : `wear ${disk.wear}%`}`,
        detail: 'Back up important data and consider replacing the disk.',
        severity: 'high',
        fixId: 'none'
      })
    }
  }
  return issues
}

async function appStatus(): Promise<AppStatus> {
  const history = store.historyEntries()
  return {
    appVersion: appVersion(),
    host: env.host,
    os: env.os,
    elevated: env.elevated,
    defragEngine: engineAvailable ? (engineText.split(/\r?\n/).find((line) => /Defrag/i.test(line))?.trim() ?? 'defrag.exe') : 'unavailable',
    engineAvailable,
    volumes: store.settings().general.hideRemovable ? volumes.filter((volume) => volume.kind !== 'removable') : volumes,
    health,
    lastJob,
    lastOptimize: history.find((entry) => entry.action !== 'analyze' && entry.state === 'completed' && !entry.dryRun && entry.exitCode === 0) ?? null,
    onBattery: powerMonitor.isOnBatteryPower?.() ?? false,
    scheduledNext: scheduledNextRun(),
    pendingPowerAction: pendingPowerAction && { action: pendingPowerAction.action, dueAt: pendingPowerAction.dueAt },
    issues: actionCenterIssues(),
    stats: store.stats()
  }
}

async function emitStatus(): Promise<void> {
  broadcast('ultra:status', await appStatus())
}

function applyVolumeResult(job: DefragJob): void {
  if (job.state !== 'completed' || job.dryRun) return
  const volume = findVolume(job.volume)
  if (!volume) return
  if (job.statsAfter) volume.fragmentation = job.statsAfter
  if (job.action !== 'analyze') {
    if (!job.statsAfter) volume.fragmentation = null
    volume.lastOptimizedAt = job.finishedAt ?? nowIso()
    volume.lastAction = ACTION_LABELS[job.action]
    store.recordVolume(volume.id, volume.lastAction, job.statsAfter?.totalFragmentedSpacePercent ?? null)
  }
}

function findVolume(identifier: string): VolumeInfo | undefined {
  const key = identifier.replace(/\\$/, '').toUpperCase()
  return volumes.find((volume) => (volume.letter && `${volume.letter}:` === key) || volume.id.replace(/\\$/, '').toUpperCase() === key)
}

function armPowerAction(action: PowerAction, delaySeconds: number): void {
  cancelPowerAction()
  const delay = Math.max(10, delaySeconds) * 1000
  const title = `PC will ${action} in ${Math.round(delay / 1000)}s`
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body: 'Click to cancel this power action.' })
    notification.on('click', () => { if (pendingPowerAction?.timer === timer) cancelPowerAction() })
    notification.show()
  }
  const timer = setTimeout(() => {
    pendingPowerAction = null
    void emitStatus()
    void executePowerAction(action)
  }, delay)
  pendingPowerAction = { action, dueAt: Date.now() + delay, timer }
  void emitStatus()
}

function cancelPowerAction(): boolean {
  if (!pendingPowerAction) return false
  clearTimeout(pendingPowerAction.timer)
  pendingPowerAction = null
  void emitStatus()
  return true
}

async function executePowerAction(action: PowerAction): Promise<void> {
  const result = action === 'sleep'
    ? await runPowerShell("Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop; if (-not [Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)) { throw 'Windows refused to sleep' }", 30_000)
    : await run(systemExecutable('shutdown.exe'), action === 'hibernate' ? ['/h'] : [action === 'restart' ? '/r' : '/s', '/t', '0'], 30_000)
  if (!result.ok) {
    const message = (result.stderr || result.stdout).trim() || `Windows returned ${result.code}`
    store.addLog('app', 'error', `Power action failed: ${action}`, message)
    notify(`Could not ${action} the PC`, message)
  }
}

async function silentModeActive(): Promise<boolean> {
  const settings = store.settings()
  if (!settings.silentMode.enabled) return false
  if (Date.now() - silentCache.at < 20_000) return silentCache.active
  const processes = await powershell('Get-Process | Select-Object -ExpandProperty ProcessName -Unique', 20_000)
  const running = new Set(processes.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean))
  const active = settings.silentMode.programs.some((program) => {
    const name = path.basename(program).replace(/\.exe$/i, '').toLowerCase()
    return running.has(name)
  })
  silentCache = { at: Date.now(), active }
  return active
}

async function startQueued(requests: DefragRequest[], scheduledShutdown = false, notifyEach = true): Promise<DefragJob[]> {
  if (batchRunning) throw new Error('A disk operation is already running.')
  if (!Array.isArray(requests) || requests.some((request) => !request || typeof request.volume !== 'string' ||
      (request.dryRun !== undefined && typeof request.dryRun !== 'boolean') ||
      (request.files !== undefined && (!Array.isArray(request.files) || request.files.some((file) => typeof file !== 'string'))))) {
    throw new Error('Invalid disk operation request.')
  }
  batchRunning = true
  batchCancelled = false
  const realWork = requests.some((request) => !request.dryRun)
  if (realWork) cancelPowerAction()
  const jobs: DefragJob[] = []
  try {
    for (const request of requests) {
      if (batchCancelled || quitting) break
      const job = await runner.run(request)
      jobs.push(job)
      if (notifyEach && !job.dryRun && job.action !== 'analyze' && job.state === 'completed' && store.settings().notifications.optimizeComplete) {
        notify(`${ACTION_LABELS[job.action]} finished`, `${job.volume} completed`)
      }
    }
    if (realWork && !quitting && !batchCancelled && jobs.length === requests.length && jobs.every((job) => job.state === 'completed') && jobs.some((job) => !job.dryRun && job.action !== 'analyze')) {
      const { action, delaySeconds } = store.settings().afterTask
      if (scheduledShutdown) armPowerAction('shutdown', 60)
      else if (action !== 'none') armPowerAction(action, delaySeconds)
    }
    return jobs
  } finally {
    batchRunning = false
    await emitStatus()
  }
}

async function tickScheduler(): Promise<void> {
  if (schedulerRunning || batchRunning || !env.elevated || !engineAvailable || quitting) return
  schedulerRunning = true
  try {
    await runScheduledWork()
  } finally {
    schedulerRunning = false
  }
}

async function runScheduledWork(): Promise<void> {
  const settings = store.settings()
  if (!settings.scheduled.enabled && !settings.autoDefrag.enabled) return
  const onBattery = powerMonitor.isOnBatteryPower?.() ?? false
  if (onBattery && settings.defrag.batteryGuard) return
  if (await silentModeActive()) return
  if (batchRunning || quitting) return

  const excluded = new Set(settings.defrag.excludeList.map((letter) => letter.trim().slice(0, 1).toUpperCase()))
  const fixed = volumes.filter(
    (v) =>
      v.kind === 'fixed' &&
      v.fileSystem.toUpperCase() === 'NTFS' &&
      !!v.letter &&
      !excluded.has(v.letter.toUpperCase())
  )
  if (!fixed.length) return
  const requestFor = (volume: VolumeInfo, action: DefragAction): DefragRequest => ({
    action: action === 'analyze' ? action : volume.mediaType === 'SSD' ? 'retrim' : action === 'traditional' && volume.mediaType !== 'HDD' ? 'optimize' : action,
    volume: volume.letter!
  })

  // Scheduled defrag
  if (settings.scheduled.enabled) {
    const now = new Date()
    const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
    const matchesTime = now.getHours() === settings.scheduled.hour && now.getMinutes() === settings.scheduled.minute
    const matchesCadence =
      settings.scheduled.cadence === 'daily'
        ? true
        : settings.scheduled.cadence === 'weekly'
          ? now.getDay() === settings.scheduled.weekday
          : now.getDate() === settings.scheduled.dayOfMonth
    if (matchesTime && matchesCadence && store.automationState().scheduledDay !== dayKey) {
      store.markAutomationRun({ scheduledDay: dayKey })
      store.addLog('schedule', 'info', 'Scheduled defrag started', `${settings.scheduled.action} on ${fixed.map((v) => v.letter).join(', ')}`)
      const jobs = await startQueued(fixed.map((volume) => requestFor(volume, settings.scheduled.action)), settings.scheduled.shutdownAfter, false)
      if (settings.scheduled.notify && settings.general.trayNotifications) {
        notify('Scheduled defrag finished', `${jobs.filter((j) => j.state === 'completed').length}/${fixed.length} volume(s) completed`)
      }
      return
    }
  }

  // Auto defrag while idle: analyze, then optimize anything above the threshold.
  if (settings.autoDefrag.enabled) {
    const idleSeconds = powerMonitor.getSystemIdleTime()
    if (idleSeconds < settings.autoDefrag.idleMinutes * 60) return
    if (Date.now() - store.automationState().autoAt < 6 * 3_600_000) return
    store.markAutomationRun({ autoAt: Date.now() })
    const analyses = await startQueued(fixed.map((volume) => requestFor(volume, 'analyze')), false, false)
    if (batchCancelled || batchRunning || quitting) return
    const targets = analyses
      .filter((job) => job.state === 'completed' && (job.statsAfter?.totalFragmentedSpacePercent ?? 0) >= settings.autoDefrag.thresholdPercent)
      .flatMap((job) => {
        const volume = findVolume(job.volume)
        return volume ? [requestFor(volume, settings.autoDefrag.action)] : []
      })
    if (targets.length) {
      store.addLog('schedule', 'info', 'Auto Defrag', `${targets.map((target) => target.volume).join(', ')} at or above ${settings.autoDefrag.thresholdPercent}%`)
      const jobs = await startQueued(targets, false, false)
      if (settings.autoDefrag.notify && settings.general.trayNotifications) notify('Auto Defrag finished', `${jobs.filter((j) => j.state === 'completed').length}/${targets.length} volume(s) optimized`)
    }
  }
}

function createWindow(): void {
  // Never open larger than the work area — a 1280x720 display must still see every row.
  const work = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: Math.min(1280, work.width),
    height: Math.min(820, work.height),
    minWidth: Math.min(1060, work.width),
    minHeight: Math.min(620, work.height),
    show: false,
    frame: false,
    backgroundColor: '#0a0b0f',
    title: 'Ultra Harddisk Defrag 1.0',
    icon: nativeIcon().isEmpty() ? undefined : nativeIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (store.settings().general.minimizeToTray && !quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })

  const rendererPath = path.join(__dirname, '../renderer/index.html')
  const devUrl = isDev ? process.env.ELECTRON_RENDERER_URL : undefined
  const rendererUrl = new URL(devUrl ?? pathToFileURL(rendererPath).href)
  const wc = mainWindow.webContents
  const preventNavigation = (event: Electron.Event): void => event.preventDefault()
  wc.on('will-frame-navigate', preventNavigation)
  wc.on('will-redirect', preventNavigation)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url).catch(console.error)
    return { action: 'deny' }
  })
  if (devUrl) void mainWindow.loadURL(rendererUrl.href)
  else void mainWindow.loadFile(rendererPath)
}

function createTray(): void {
  tray = new Tray(nativeIcon())
  tray.setToolTip('Ultra Harddisk Defrag 1.0')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ultra Harddisk Defrag 1.0', enabled: false },
      { type: 'separator' },
      {
        label: 'Open',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      {
        label: 'Analyze all volumes',
        click: () => {
          mainWindow?.show()
          broadcast('ultra:navigate', 'defrag')
          if (!batchRunning) void startQueued(volumes.filter((v) => v.letter && v.kind === 'fixed').map((v) => ({ action: 'analyze', volume: v.letter! })))
        }
      },
      {
        label: 'Optimize all volumes',
        click: () => {
          mainWindow?.show()
          broadcast('ultra:navigate', 'defrag')
          if (!batchRunning) void startQueued(volumes.filter((v) => v.letter && v.kind === 'fixed').map((v) => ({ action: 'optimize', volume: v.letter! })))
        }
      },
      { type: 'separator' },
      { label: 'Cancel pending power action', click: () => { cancelPowerAction() } },
      { label: 'Exit', click: () => app.quit() }
    ])
  )
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

async function relaunchElevated(): Promise<{ ok: boolean; message: string }> {
  if (env.elevated) return { ok: true, message: 'Already running elevated' }
  if (batchRunning) return { ok: false, message: 'Wait for the current disk operation to finish.' }
  const exe = process.execPath
  const args = [...(app.isPackaged ? [] : [`"${app.getAppPath()}"`]), `--wait-for-pid=${process.pid}`]
  const quotedExe = `'${exe.replace(/'/g, "''")}'`
  const argList = args.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(',')
  const script = `Start-Process -FilePath ${quotedExe} -ArgumentList ${argList} -Verb RunAs -ErrorAction Stop`
  const result = await runPowerShell(script, 120_000)
  if (!result.ok) {
    const message = `${result.stderr || result.stdout}`.trim() || 'The elevation request was dismissed'
    store.addLog('app', 'warn', 'Elevation request failed', message)
    return { ok: false, message }
  }
  setTimeout(() => app.quit(), 100)
  return { ok: true, message: 'Elevated instance starting' }
}

function applySettingsChange(before: Settings, next: Settings): void {
  if (before.general.autoStart !== next.general.autoStart) {
    const args = app.isPackaged ? [] : [app.getAppPath()]
    app.setLoginItemSettings({ name: APP_ID, openAtLogin: next.general.autoStart, path: process.execPath, args })
  }
  if (before.afterTask.action !== next.afterTask.action || before.afterTask.delaySeconds !== next.afterTask.delaySeconds ||
      (before.scheduled.shutdownAfter && !next.scheduled.shutdownAfter)) cancelPowerAction()
  silentCache = { at: 0, active: false }
}

function registerIpc(): void {
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    !!mainWindow && event.sender === mainWindow.webContents && event.senderFrame === event.sender.mainFrame
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted IPC sender')
      return listener(event, ...args)
    })
  }
  ipcMain.on('ultra:win', (event, action: 'minimize' | 'maximize' | 'close') => {
    if (!trusted(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
    else if (action === 'close') win.close()
  })

  handle('ultra:status', () => appStatus())
  handle('ultra:volumes:refresh', async () => {
    await detectEnv()
    await refreshVolumes(true)
    await emitStatus()
    return appStatus()
  })
  handle('ultra:settings', () => store.settings())
  handle('ultra:settings:save', async (_event, patch: DeepPartial<Settings>) => {
    const before = store.settings()
    const next = await store.updateSettings(patch)
    applySettingsChange(before, next)
    await emitStatus()
    return next
  })
  handle('ultra:settings:reset', async () => {
    const before = store.settings()
    const next = await store.resetSettings()
    applySettingsChange(before, next)
    await emitStatus()
    return next
  })
  handle('ultra:analyze', async (_event, volume: string, dryRun?: boolean) =>
    (await startQueued([{ action: 'analyze', volume, dryRun }]))[0])
  handle('ultra:job:start', async (_event, request: DefragRequest) => (await startQueued([request]))[0])
  handle('ultra:jobs:start', (_event, requests: DefragRequest[]) => startQueued(requests))
  handle('ultra:job:cancel', () => {
    if (batchRunning) batchCancelled = true
    runner.cancel()
  })
  handle('ultra:power:cancel', () => cancelPowerAction())
  handle('ultra:job:current', () => runner.current())
  handle('ultra:job:preview', (_e, request: DefragRequest): DefragCommand => runner.preview(request))
  handle('ultra:history', () => store.historyEntries())

  handle('ultra:health', async () => {
    health = await diskHealth(volumes)
    return health
  })
  handle('ultra:libraries', async () => detectLibraries(volumes, store.libraries()))
  handle('ultra:libraries:add', async (_e, target: string) => {
    await store.addLibrary(target)
    return store.libraries()
  })
  handle('ultra:libraries:remove', async (_e, target: string) => {
    await store.removeLibrary(target)
    return store.libraries()
  })
  handle('ultra:largefiles', async (_e, options: { volume?: string; root?: string; minSizeMb: number; limit: number }) => {
    const result = await scanLargeFiles(options)
    const where = options.root ?? options.volume ?? 'C:'
    store.addLog('analyze', 'info', `Large-file scan on ${where}`, `${result.files.length} file(s) ≥ ${options.minSizeMb} MB, ${result.scannedFiles} scanned${result.truncated ? ' (time budget reached)' : ''}`)
    return result.files
  })
  handle('ultra:files:defrag', async (_event, volume: string, files: string[], dryRun?: boolean) =>
    (await startQueued([{ action: 'files', volume, files, dryRun }]))[0])

  handle('ultra:actioncenter', () => actionCenterIssues())
  handle('ultra:fixall', async () => {
    const issues = actionCenterIssues()
    const requests: DefragRequest[] = []
    if (env.elevated && engineAvailable) {
      for (const issue of issues) {
        if (issue.fixId === 'analyze') {
          requests.push(...volumes.filter((volume) => volume.letter && volume.kind === 'fixed')
            .map((volume): DefragRequest => ({ action: 'analyze', volume: volume.letter! })))
        } else {
          const [action, volume] = issue.fixId.split(':')
          if (volume && (action === 'retrim' || action === 'optimize')) requests.push({ action, volume })
        }
      }
    }
    const jobs = requests.length ? await startQueued(requests) : []
    let fixed = jobs.filter((job) => job.action !== 'analyze' && job.state === 'completed').length
    if (jobs.some((job) => job.action === 'analyze' && job.state === 'completed')) fixed++
    if (issues.some((issue) => issue.fixId === 'enable-automation')) {
      await store.updateSettings({ autoDefrag: { enabled: true }, scheduled: { enabled: true } })
      fixed++
    }
    store.addLog('app', 'info', 'Fix All completed', `${fixed} of ${issues.length} issue(s) addressed`)
    await emitStatus()
    return { fixed, issues: issues.length }
  })

  handle('ultra:logs', (_e, channel?: LogEntry['channel']) => store.getLogs(channel))
  handle('ultra:logs:clear', () => store.clearLogs())

  handle('ultra:relaunch', () => relaunchElevated())
  handle('ultra:pick', async (_e, kind: 'file' | 'folder' | 'files') => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : kind === 'files' ? ['openFile', 'multiSelections'] : ['openFile'],
      title: kind === 'folder' ? 'Select a folder' : 'Select a file'
    })
    return result.canceled ? [] : result.filePaths
  })
  handle('ultra:open', async (_e, target: string) => {
    if (!path.isAbsolute(target) || !(await fs.stat(target)).isDirectory()) throw new Error('Choose an existing folder.')
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })
  handle('ultra:show', (_e, target: string) => {
    shell.showItemInFolder(target)
  })
}

async function bootstrap(): Promise<void> {
  const paths = createPaths(app.getPath('userData'))
  await ensureDirs(paths)
  store = new Store(paths)
  await store.init()
  await detectEnv()

  const info = await engineInfo()
  engineAvailable = info.available
  engineText = info.text

  runner = new DefragRunner({
    get elevated() {
      return env.elevated
    },
    onProgress: (job) => {
      lastJob = job
      broadcast('ultra:job', job)
    },
    mediaForVolume: (volume) => findVolume(volume)?.mediaType ?? 'Unknown',
    onLog: (channel, level, message, detail) => store.addLog(channel, level, message, detail),
    onFinished: (job, history: OptimizeHistoryEntry) => {
      void store.addHistory(history)
      applyVolumeResult(job)
    }
  })

  await refreshVolumes(true)

  schedulerTimer = setInterval(() => {
    void tickScheduler().catch((err: unknown) => store.addLog('schedule', 'error', 'Scheduler tick failed', err instanceof Error ? err.message : String(err)))
  }, 30_000)
  schedulerTimer.unref?.()
  setTimeout(() => void emitStatus(), 500).unref?.()

  registerIpc()
  createWindow()
  createTray()
  await emitStatus()

  refreshTimer = setInterval(() => {
    void refreshVolumes().then(emitStatus).catch((err: unknown) =>
      store.addLog('health', 'error', 'Unable to refresh volumes', String(err)))
  }, 60_000)
  refreshTimer.unref?.()
}

async function launch(): Promise<void> {
  const previousPid = Number(app.commandLine.getSwitchValue('wait-for-pid'))
  if (Number.isSafeInteger(previousPid) && previousPid > 0 && previousPid !== process.pid) {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        process.kill(previousPid, 0)
      } catch {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  app.setAppUserModelId(APP_ID)

  let readyToQuit = false
  app.on('before-quit', (event) => {
    if (readyToQuit) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    if (schedulerTimer) clearInterval(schedulerTimer)
    if (refreshTimer) clearInterval(refreshTimer)
    cancelPowerAction()
    runner?.cancel()
    void (store?.flush() ?? Promise.resolve()).finally(() => {
      readyToQuit = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !store?.settings().general.minimizeToTray) app.quit()
  })

  await app.whenReady()
  await bootstrap()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
}

void launch().catch((error: unknown) => {
  console.error('Unable to start Ultra Harddisk Defrag', error)
  dialog.showErrorBox('Ultra Harddisk Defrag', error instanceof Error ? error.message : String(error))
  app.exit(1)
})
