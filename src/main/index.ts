import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, shell, Tray } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createPaths, ensureDirs, nowIso, type RuntimePaths } from './engine/runtime'
import { Store } from './engine/store'
import { DefragRunner, ACTION_LABELS, engineInfo } from './engine/defrag'
import { diskHealth, listVolumes } from './engine/volumes'
import { detectLibraries } from './engine/libraries'
import { powershell, run } from './engine/shell'
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
  type LargeFileEntry,
  type LibraryEntry,
  type LogEntry,
  type OptimizeHistoryEntry,
  type Settings,
  type VolumeInfo
} from '../shared/types'

app.setName('Ultra Harddisk Defrag')

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let paths: RuntimePaths
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
let lastScheduledDay = ''
let lastAutoDefragAt = 0
let pendingPowerAction: { action: string; dueAt: number; timer: NodeJS.Timeout } | null = null
let silentCache = { at: 0, active: false }
let volumesRefreshedAt = 0

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

function nativeIcon(): Electron.NativeImage {
  const candidate = path.join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(candidate) ? nativeImage.createFromPath(candidate) : nativeImage.createEmpty()
}

function notify(title: string, body: string): void {
  if (!store.settings().notifications.optimizeComplete) return
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
  const elevated = (await run('net', ['session'], 8000)).ok
  env = { host: hostname, os: `${type} ${release} ${arch}`.trim(), elevated }
}

async function refreshVolumes(force = false): Promise<void> {
  if (!force && Date.now() - volumesRefreshedAt < 15_000 && volumes.length) return
  const previous = new Map(volumes.map((v) => [v.letter, v.fragmentation]))
  const memory = store.volumeState()
  const fresh = await listVolumes()
  for (const volume of fresh) {
    if (!volume.letter) continue
    const record = memory[volume.letter]
    if (record) {
      volume.lastOptimizedAt = record.lastOptimizedAt
      volume.lastAction = record.lastAction
    }
    const memo = previous.get(volume.letter)
    if (memo) volume.fragmentation = memo
  }
  volumes = fresh
  volumesRefreshedAt = Date.now()
  health = await diskHealth(volumes)
  for (const volume of volumes) {
    const disk = health.physicalDisks.find((d) => String(d.deviceId) === String(volume.diskNumber))
    if (disk) volume.trimSupported = disk.mediaType === 'SSD' && health.trimEnabled === true
  }
}

function settingsForStatus(): Settings {
  return store.settings()
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
    next.setDate(Math.max(1, schedule.dayOfMonth))
    if (next <= now) next.setMonth(next.getMonth() + 1, Math.max(1, schedule.dayOfMonth))
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
    const percent = volume.fragmentation?.totalFragmentedSpacePercent ?? null
    if (percent !== null && percent >= 10 && volume.kind === 'fixed') {
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
    const unhealthy = disk.health && !/healthy/i.test(disk.health)
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
    volumes,
    health,
    lastJob,
    lastOptimize: history.find((entry) => entry.action !== 'analyze') ?? null,
    onBattery: powerMonitor.isOnBatteryPower?.() ?? false,
    scheduledNext: scheduledNextRun(),
    bootPending: store.settings().bootOptimize.enabled,
    issues: actionCenterIssues(),
    stats: store.stats()
  }
}

async function emitStatus(): Promise<void> {
  broadcast('ultra:status', await appStatus())
}

function applyVolumeResult(job: DefragJob): void {
  const letter = job.volume.slice(0, 1).toUpperCase()
  const volume = volumes.find((v) => v.letter === letter)
  if (!volume) return
  if (job.statsAfter) volume.fragmentation = job.statsAfter
  if (job.action !== 'analyze' && job.state === 'completed') {
    volume.lastOptimizedAt = job.finishedAt ?? nowIso()
    volume.lastAction = ACTION_LABELS[job.action]
  }
}

async function afterJob(job: DefragJob): Promise<void> {
  applyVolumeResult(job)
  if (job.action !== 'analyze' && job.state === 'completed') {
    const volume = volumes.find((v) => v.letter === job.volume.slice(0, 1).toUpperCase())
    if (volume) store.recordVolume(volume.letter ?? job.volume, ACTION_LABELS[job.action], job.statsAfter?.totalFragmentedSpacePercent ?? null)
    store.addBytesOptimized(0)
  }
  const settings = store.settings()
  if (settings.afterTask.action !== 'none' && job.state === 'completed') {
    armPowerAction(settings.afterTask.action, settings.afterTask.delaySeconds)
  }
  if (settings.notifications.optimizeComplete) {
    notify(
      `${ACTION_LABELS[job.action]} ${job.state === 'completed' ? 'finished' : job.state}`,
      `${job.volume} — ${job.state === 'completed' ? 'completed' : job.error ?? job.elevationHint ?? job.state}`
    )
  }
  await emitStatus()
}

function armPowerAction(action: string, delaySeconds: number): void {
  cancelPowerAction()
  const delay = Math.max(10, delaySeconds) * 1000
  broadcast('ultra:notify', {
    title: `PC will ${action} in ${Math.round(delay / 1000)}s`,
    body: 'Cancel from the notification area before the countdown ends.',
    level: 'warn'
  })
  const timer = setTimeout(() => {
    pendingPowerAction = null
    const commands: Record<string, [string, string[]]> = {
      shutdown: ['shutdown', ['/s', '/t', '0']],
      restart: ['shutdown', ['/r', '/t', '0']],
      sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
      hibernate: ['shutdown', ['/h']]
    }
    const entry = commands[action]
    if (entry) void run(entry[0], entry[1], 30_000)
  }, delay)
  pendingPowerAction = { action, dueAt: Date.now() + delay, timer }
}

function cancelPowerAction(): boolean {
  if (!pendingPowerAction) return false
  clearTimeout(pendingPowerAction.timer)
  pendingPowerAction = null
  return true
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

async function startQueued(requests: DefragRequest[]): Promise<DefragJob[]> {
  const jobs: DefragJob[] = []
  for (const request of requests) {
    const job = await runner.run(request)
    jobs.push(job)
    lastJob = job
    applyVolumeResult(job)
  }
  await emitStatus()
  return jobs
}

async function tickScheduler(): Promise<void> {
  const settings = store.settings()
  const onBattery = powerMonitor.isOnBatteryPower?.() ?? false
  if (onBattery && settings.defrag.batteryGuard && settings.defrag.batteryGuard) return
  if (await silentModeActive()) return
  if (runner.current()?.state === 'running') return

  const excluded = new Set(settings.defrag.excludeList.map((letter) => letter.trim().slice(0, 1).toUpperCase()))
  const fixed = volumes.filter(
    (v) =>
      v.kind === 'fixed' &&
      v.fileSystem.toUpperCase() === 'NTFS' &&
      !!v.letter &&
      !excluded.has(v.letter.toUpperCase()) &&
      (!settings.general.hideRemovable || v.kind === 'fixed')
  )
  if (!fixed.length) return

  // Scheduled defrag
  if (settings.scheduled.enabled) {
    const now = new Date()
    const dayKey = now.toISOString().slice(0, 10)
    const matchesTime = now.getHours() === settings.scheduled.hour && now.getMinutes() === settings.scheduled.minute
    const matchesCadence =
      settings.scheduled.cadence === 'daily'
        ? true
        : settings.scheduled.cadence === 'weekly'
          ? now.getDay() === settings.scheduled.weekday
          : now.getDate() === settings.scheduled.dayOfMonth
    if (matchesTime && matchesCadence && lastScheduledDay !== dayKey) {
      lastScheduledDay = dayKey
      store.addLog('schedule', 'info', 'Scheduled defrag started', `${settings.scheduled.action} on ${fixed.map((v) => v.letter).join(', ')}`)
      const jobs = await startQueued(fixed.map((v) => ({ action: settings.scheduled.action, volume: v.letter! })))
      if (settings.scheduled.notify) {
        notify('Scheduled defrag finished', `${jobs.filter((j) => j.state === 'completed').length}/${jobs.length} volume(s) completed`)
      }
      if (settings.scheduled.shutdownAfter && jobs.every((j) => j.state === 'completed')) armPowerAction('shutdown', 60)
      return
    }
  }

  // Auto defrag while idle: analyze, then optimize anything above the threshold.
  if (settings.autoDefrag.enabled && env.elevated) {
    const idleSeconds = powerMonitor.getSystemIdleTime()
    if (idleSeconds < settings.autoDefrag.idleMinutes * 60) return
    if (Date.now() - lastAutoDefragAt < 6 * 3_600_000) return
    const analyses = await startQueued(fixed.map((v) => ({ action: 'analyze', volume: v.letter! })))
    const targets = analyses
      .filter((job) => (job.statsAfter?.totalFragmentedSpacePercent ?? 0) >= settings.autoDefrag.thresholdPercent)
      .map((job) => job.volume)
    lastAutoDefragAt = Date.now()
    if (targets.length) {
      store.addLog('schedule', 'info', 'Auto Defrag', `${targets.join(', ')} above ${settings.autoDefrag.thresholdPercent}%`)
      const jobs = await startQueued(targets.map((volume) => ({ action: settings.autoDefrag.action, volume })))
      if (settings.autoDefrag.notify) notify('Auto Defrag finished', `${jobs.filter((j) => j.state === 'completed').length}/${jobs.length} volume(s) optimized`)
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
      sandbox: false,
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

  if (isDev && process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
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
          void startQueued(volumes.filter((v) => v.letter && v.kind === 'fixed').map((v) => ({ action: 'analyze', volume: v.letter! })))
        }
      },
      {
        label: 'Optimize all volumes',
        click: () => {
          mainWindow?.show()
          broadcast('ultra:navigate', 'defrag')
          void startQueued(volumes.filter((v) => v.letter && v.kind === 'fixed').map((v) => ({ action: 'optimize', volume: v.letter! })))
        }
      },
      { type: 'separator' },
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
  const exe = process.execPath
  const args = app.isPackaged ? [] : [app.getAppPath()]
  const quotedExe = `'${exe.replace(/'/g, "''")}'`
  const argList = args.length ? `-ArgumentList ${args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')}` : ''
  const script = `Start-Process -FilePath ${quotedExe} ${argList} -Verb RunAs`
  const result = await run('powershell.exe', ['-NoProfile', '-Command', script], 30_000)
  if (!result.ok) {
    const message = `${result.stderr || result.stdout}`.trim() || 'The elevation request was dismissed'
    store.addLog('app', 'warn', 'Elevation request failed', message)
    return { ok: false, message }
  }
  quitting = true
  setTimeout(() => app.quit(), 800)
  return { ok: true, message: 'Elevated instance starting' }
}

function registerIpc(): void {
  ipcMain.on('ultra:win', (event, action: 'minimize' | 'maximize' | 'close') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
    else win.close()
  })

  ipcMain.handle('ultra:status', () => appStatus())
  ipcMain.handle('ultra:volumes:refresh', async () => {
    await detectEnv()
    await refreshVolumes(true)
    await emitStatus()
    return appStatus()
  })
  ipcMain.handle('ultra:settings', () => store.settings())
  ipcMain.handle('ultra:settings:save', async (_e, patch: DeepPartial<Settings>) => {
    const before = store.settings()
    const next = await store.updateSettings(patch)
    if (before.general.autoStart !== next.general.autoStart) {
      app.setLoginItemSettings({ openAtLogin: next.general.autoStart, path: process.execPath })
    }
    silentCache = { at: 0, active: false }
    await emitStatus()
    return next
  })
  ipcMain.handle('ultra:settings:reset', async () => {
    const next = await store.resetSettings()
    await emitStatus()
    return next
  })

  ipcMain.handle('ultra:analyze', async (_e, volume: string, dryRun?: boolean) => {
    const job = await runner.run({ action: 'analyze', volume, dryRun })
    lastJob = job
    applyVolumeResult(job)
    await emitStatus()
    return job
  })
  ipcMain.handle('ultra:job:start', async (_e, request: DefragRequest) => {
    const job = await runner.run(request)
    lastJob = job
    await afterJob(job)
    return job
  })
  ipcMain.handle('ultra:job:cancel', () => runner.cancel())
  ipcMain.handle('ultra:job:current', () => runner.current())
  ipcMain.handle('ultra:job:preview', (_e, request: DefragRequest): DefragCommand => runner.preview(request))
  ipcMain.handle('ultra:history', () => store.historyEntries())

  ipcMain.handle('ultra:health', async () => {
    health = await diskHealth(volumes)
    return health
  })
  ipcMain.handle('ultra:libraries', async () => detectLibraries(volumes, store.libraries()))
  ipcMain.handle('ultra:libraries:add', async (_e, target: string) => {
    await store.addLibrary(target)
    return store.libraries()
  })
  ipcMain.handle('ultra:libraries:remove', async (_e, target: string) => {
    await store.removeLibrary(target)
    return store.libraries()
  })
  ipcMain.handle('ultra:largefiles', async (_e, options: { volume?: string; root?: string; minSizeMb: number; limit: number }) => {
    const { scanLargeFiles } = await import('./engine/libraries')
    const result = await scanLargeFiles(options)
    const where = options.root ?? options.volume ?? 'C:'
    store.addLog('analyze', 'info', `Large-file scan on ${where}`, `${result.files.length} file(s) ≥ ${options.minSizeMb} MB, ${result.scannedFiles} scanned${result.truncated ? ' (time budget reached)' : ''}`)
    return result.files as LargeFileEntry[]
  })
  ipcMain.handle('ultra:files:defrag', async (_e, volume: string, files: string[], dryRun?: boolean) => {
    const job = await runner.run({ action: 'files', volume, files, dryRun })
    lastJob = job
    await afterJob(job)
    return job
  })

  ipcMain.handle('ultra:actioncenter', () => actionCenterIssues())
  ipcMain.handle('ultra:fixall', async () => {
    const issues = actionCenterIssues()
    let fixed = 0
    for (const issue of issues) {
      if (issue.fixId === 'enable-automation') {
        await store.updateSettings({ autoDefrag: { enabled: true }, scheduled: { enabled: true, cadence: 'weekly', weekday: 0, hour: 3, minute: 0 } })
        fixed++
      } else if (issue.fixId.startsWith('retrim:')) {
        const volume = issue.fixId.split(':')[1]
        const job = await runner.run({ action: 'retrim', volume })
        if (job.state === 'completed') fixed++
      } else if (issue.fixId.startsWith('optimize:')) {
        const volume = issue.fixId.split(':')[1]
        const job = await runner.run({ action: 'optimize', volume })
        if (job.state === 'completed') fixed++
      } else if (issue.fixId === 'analyze' && env.elevated) {
        const jobs = await startQueued(volumes.filter((v) => v.letter && v.kind === 'fixed').map((v) => ({ action: 'analyze', volume: v.letter! })))
        if (jobs.some((j) => j.state === 'completed')) fixed++
      }
    }
    store.addLog('app', 'info', 'Fix All completed', `${fixed} of ${issues.length} issue(s) addressed`)
    await emitStatus()
    return { fixed, issues: issues.length }
  })

  ipcMain.handle('ultra:logs', (_e, channel?: LogEntry['channel']) => store.getLogs(channel))
  ipcMain.handle('ultra:logs:clear', () => store.clearLogs())

  ipcMain.handle('ultra:relaunch', () => relaunchElevated())
  ipcMain.handle('ultra:pick', async (_e, kind: 'file' | 'folder' | 'files') => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : kind === 'files' ? ['openFile', 'multiSelections'] : ['openFile'],
      title: kind === 'folder' ? 'Select a folder' : 'Select a file'
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('ultra:open', async (_e, target: string) => {
    await shell.openPath(target)
  })
  ipcMain.handle('ultra:show', (_e, target: string) => {
    shell.showItemInFolder(target)
  })
}

async function bootstrap(): Promise<void> {
  paths = createPaths(app.getPath('userData'))
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
    onLog: (channel, level, message, detail) => store.addLog(channel, level, message, detail),
    onFinished: (job, history: OptimizeHistoryEntry) => {
      void store.addHistory(history)
      void afterJob(job)
    }
  })

  await refreshVolumes(true)

  schedulerTimer = setInterval(() => {
    void tickScheduler().catch((err: unknown) => store.addLog('schedule', 'error', 'Scheduler tick failed', err instanceof Error ? err.message : String(err)))
  }, 60_000)
  schedulerTimer.unref?.()
  setTimeout(() => void emitStatus(), 500).unref?.()

  registerIpc()
  createWindow()
  createTray()
  await emitStatus()

  setInterval(() => {
    void refreshVolumes().then(() => emitStatus())
  }, 60_000).unref?.()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  app.setAppUserModelId('work.selman.ultra-harddisk-defrag')

  app.whenReady().then(async () => {
    await bootstrap()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
  })

  app.on('before-quit', () => {
    quitting = true
    if (schedulerTimer) clearInterval(schedulerTimer)
    cancelPowerAction()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !store?.settings().general.minimizeToTray) app.quit()
  })
}
