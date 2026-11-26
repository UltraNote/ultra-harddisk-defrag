// Shared contracts between the Electron main process, the preload bridge and the renderer.
// Dependency-free so both sides can import it.

export type MediaType = 'SSD' | 'HDD' | 'Unspecified' | 'Unknown'
export type VolumeKind = 'fixed' | 'removable' | 'network' | 'cdrom' | 'unknown'

export interface FragmentationStats {
  analyzedAt: string
  totalFragmentedSpacePercent: number | null
  averageFragmentsPerFile: number | null
  fragmentedFiles: number | null
  excessFragments: number | null
  folders: number | null
  averageFragmentsPerFolder: number | null
  scatteredFiles: number | null
  volumeSizeText: string | null
  freeSpacePercent: number | null
  clusterSizeText: string | null
  rawText: string
}

export interface VolumeInfo {
  id: string
  letter: string | null
  label: string
  fileSystem: string
  kind: VolumeKind
  sizeBytes: number
  freeBytes: number
  health: string
  diskNumber: number | null
  physicalDeviceId?: string
  mediaType: MediaType
  busType: string
  physicalName: string
  isSystem: boolean
  trimSupported: boolean | null
  fragmentation: FragmentationStats | null
  lastOptimizedAt: string | null
  lastAction: string | null
}

export interface SmartAttribute {
  id: string
  name: string
  status: 'ok' | 'warning' | 'bad' | 'unknown'
  value: number | null
  worst: number | null
  threshold: number | null
  raw: string
}

export interface PhysicalDiskInfo {
  deviceId: string
  name: string
  mediaType: MediaType
  busType: string
  health: string
  operationalStatus: string
  sizeBytes: number
  partitionStyle: string | null
  temperatureC: number | null
  wear: number | null
  powerOnHours: number | null
  readErrorsTotal: number | null
  writeErrorsTotal: number | null
  startStopCycles: number | null
  volumes: string[]
  notes: string[]
}

export interface DiskHealth {
  trimEnabled: boolean | null
  ntfsDisableDeleteNotify: number | null
  physicalDisks: PhysicalDiskInfo[]
  smartSource: string
}

export type DefragAction =
  | 'analyze'
  | 'optimize'
  | 'traditional'
  | 'quick'
  | 'freeSpace'
  | 'retrim'
  | 'slab'
  | 'bootOptimize'
  | 'files'

export function requiresHdd(action: DefragAction): boolean {
  return action === 'traditional' || action === 'freeSpace' || action === 'bootOptimize' || action === 'files'
}

export interface DefragRequest {
  action: DefragAction
  volume: string
  files?: string[]
  dryRun?: boolean
}

export interface DefragCommand {
  executable: string
  args: string[]
  display: string
}

export type JobState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-elevation'

export interface DefragJob {
  id: string
  action: DefragAction
  volume: string
  state: JobState
  dryRun?: boolean
  command: string
  percent: number
  phase: string
  startedAt: string
  finishedAt?: string
  exitCode?: number
  lines: string[]
  error?: string
  elevationHint?: string
  statsBefore?: FragmentationStats | null
  statsAfter?: FragmentationStats | null
  output?: string
}

export interface OptimizeHistoryEntry {
  id: string
  action: DefragAction
  volume: string
  startedAt: string
  finishedAt: string
  state: JobState
  durationMs: number
  dryRun?: boolean
  fragmentedPercentBefore: number | null
  fragmentedPercentAfter: number | null
  exitCode: number | null
}

export interface LibraryEntry {
  id: string
  name: string
  provider: 'Steam' | 'Epic' | 'Manual'
  path: string
  volumeLetter: string | null
  sizeBytes: number
  mediaType: MediaType
  onSsd: boolean
}

export interface LargeFileEntry {
  path: string
  sizeBytes: number
  modifiedAt: string
  volumeLetter: string | null
}

export interface LogEntry {
  id: string
  at: string
  channel: 'optimize' | 'analyze' | 'health' | 'schedule' | 'app'
  level: 'info' | 'warn' | 'error'
  message: string
  detail?: string
}

export interface AppStatus {
  appVersion: string
  host: string
  os: string
  elevated: boolean
  defragEngine: string
  engineAvailable: boolean
  volumes: VolumeInfo[]
  health: DiskHealth | null
  lastJob: DefragJob | null
  lastOptimize: OptimizeHistoryEntry | null
  onBattery: boolean
  scheduledNext: string | null
  pendingPowerAction: { action: Exclude<Settings['afterTask']['action'], 'none'>; dueAt: number } | null
  issues: ActionCenterIssue[]
  stats: {
    optimizations: number
    analyzedVolumes: number
    bytesOptimized: number
    lastRunAt: string | null
    installedAt: string
  }
}

export interface ActionCenterIssue {
  id: string
  title: string
  detail: string
  severity: 'low' | 'medium' | 'high'
  fixId: string
}

export interface Settings {
  general: {
    minimizeToTray: boolean
    autoStart: boolean
    trayNotifications: boolean
    hideRemovable: boolean
    language: string
    transparency: number
    accessibleMap: boolean
  }
  defrag: {
    silentWhileDefragging: boolean
    skipFilesOver1Gb: boolean
    stopVss: boolean
    replaceWindowsDefrag: boolean
    batteryGuard: boolean
    excludeList: string[]
  }
  autoDefrag: {
    enabled: boolean
    thresholdPercent: number
    idleMinutes: number
    action: DefragAction
    notify: boolean
  }
  scheduled: {
    enabled: boolean
    cadence: 'daily' | 'weekly' | 'monthly'
    weekday: number
    dayOfMonth: number
    hour: number
    minute: number
    action: DefragAction
    notify: boolean
    shutdownAfter: boolean
  }
  bootOptimize: {
    enabled: boolean
    cadence: 'firstBootOfDay' | 'everyBoot' | 'everyTwoDays' | 'nextBoot'
    files: string[]
    pagefile: boolean
    mft: boolean
    systemFiles: boolean
    registryFiles: boolean
  }
  silentMode: {
    enabled: boolean
    programs: string[]
  }
  notifications: {
    displaySeconds: number
    optimizeComplete: boolean
    healthWarning: boolean
  }
  log: {
    maxEntries: number
  }
  afterTask: {
    action: 'none' | 'shutdown' | 'sleep' | 'hibernate' | 'restart'
    delaySeconds: number
  }
}

export interface CommandResult {
  ok: boolean
  command: DefragCommand
  message: string
}

export interface UltraApi {
  getStatus(): Promise<AppStatus>
  refreshVolumes(): Promise<AppStatus>
  getSettings(): Promise<Settings>
  saveSettings(patch: DeepPartial<Settings>): Promise<Settings>
  resetSettings(): Promise<Settings>

  analyze(volume: string, dryRun?: boolean): Promise<DefragJob>
  startJob(request: DefragRequest): Promise<DefragJob>
  startJobs(requests: DefragRequest[]): Promise<DefragJob[]>
  cancelJob(): Promise<void>
  cancelPowerAction(): Promise<boolean>
  getJob(): Promise<DefragJob | null>
  getHistory(): Promise<OptimizeHistoryEntry[]>
  previewCommand(request: DefragRequest): Promise<DefragCommand>

  getHealth(): Promise<DiskHealth>
  getLibraries(): Promise<LibraryEntry[]>
  addLibrary(path: string): Promise<string[]>
  removeLibrary(path: string): Promise<string[]>
  scanLargeFiles(options: { volume?: string; root?: string; minSizeMb: number; limit: number }): Promise<LargeFileEntry[]>
  defragFiles(volume: string, files: string[], dryRun?: boolean): Promise<DefragJob>

  getActionCenter(): Promise<ActionCenterIssue[]>
  fixAll(): Promise<{ fixed: number; issues: number }>
  getLogs(channel?: LogEntry['channel']): Promise<LogEntry[]>
  clearLogs(): Promise<void>

  relaunchElevated(): Promise<{ ok: boolean; message: string }>
  pickFiles(kind: 'file' | 'folder' | 'files'): Promise<string[]>
  openPath(target: string): Promise<void>
  showInFolder(target: string): Promise<void>

  windowMinimize(): void
  windowMaximize(): void
  windowClose(): void

  onJobProgress(handler: (job: DefragJob) => void): () => void
  onStatus(handler: (status: AppStatus) => void): () => void
  onNotification(handler: (payload: { title: string; body: string; level: string }) => void): () => void
  onNavigate(handler: (page: string) => void): () => void
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export const DEFAULT_SETTINGS: Settings = {
  general: {
    minimizeToTray: true,
    autoStart: false,
    trayNotifications: true,
    hideRemovable: false,
    language: 'English',
    transparency: 0,
    accessibleMap: false
  },
  defrag: {
    silentWhileDefragging: true,
    skipFilesOver1Gb: false,
    stopVss: false,
    replaceWindowsDefrag: false,
    batteryGuard: true,
    excludeList: []
  },
  autoDefrag: {
    enabled: true,
    thresholdPercent: 5,
    idleMinutes: 10,
    action: 'optimize',
    notify: true
  },
  scheduled: {
    enabled: false,
    cadence: 'weekly',
    weekday: 0,
    dayOfMonth: 1,
    hour: 3,
    minute: 0,
    action: 'optimize',
    notify: true,
    shutdownAfter: false
  },
  bootOptimize: {
    enabled: false,
    cadence: 'firstBootOfDay',
    files: [],
    pagefile: true,
    mft: true,
    systemFiles: true,
    registryFiles: true
  },
  silentMode: {
    enabled: false,
    programs: []
  },
  notifications: {
    displaySeconds: 5,
    optimizeComplete: true,
    healthWarning: true
  },
  log: {
    maxEntries: 500
  },
  afterTask: {
    action: 'none',
    delaySeconds: 60
  }
}
