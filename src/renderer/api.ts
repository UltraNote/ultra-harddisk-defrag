import {
  DEFAULT_SETTINGS,
  requiresHdd,
  type ActionCenterIssue,
  type AppStatus,
  type DefragCommand,
  type DefragJob,
  type DefragRequest,
  type DiskHealth,
  type LargeFileEntry,
  type LibraryEntry,
  type LogEntry,
  type OptimizeHistoryEntry,
  type Settings,
  type UltraApi
} from '@shared/types'

declare global {
  interface Window {
    ultra?: UltraApi
  }
}

const nowIso = (): string => new Date().toISOString()
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const mockStats = (percent: number) => ({
  analyzedAt: nowIso(),
  totalFragmentedSpacePercent: percent,
  averageFragmentsPerFile: 1.14,
  fragmentedFiles: 1234,
  excessFragments: 5678,
  folders: 90000,
  averageFragmentsPerFolder: 1.02,
  scatteredFiles: 12,
  volumeSizeText: '465 GB',
  freeSpacePercent: 33,
  clusterSizeText: '4 KB',
  rawText: 'preview mode sample output'
})

const mockVolumes = () => [
  {
    id: 'C',
    letter: 'C',
    label: 'Windows',
    fileSystem: 'NTFS',
    kind: 'fixed' as const,
    sizeBytes: 498_943_913_984,
    freeBytes: 165_480_964_096,
    health: 'Healthy',
    diskNumber: 0,
    mediaType: 'SSD' as const,
    busType: 'SATA',
    physicalName: 'Samsung SSD 850 EVO 500GB',
    isSystem: true,
    trimSupported: true,
    fragmentation: mockStats(6),
    lastOptimizedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
    lastAction: 'Trim & Intelligent Optimize'
  },
  {
    id: 'D',
    letter: 'D',
    label: 'Data',
    fileSystem: 'NTFS',
    kind: 'fixed' as const,
    sizeBytes: 8_001_561_817_088,
    freeBytes: 7_892_217_647_104,
    health: 'Healthy',
    diskNumber: 2,
    mediaType: 'HDD' as const,
    busType: 'SATA',
    physicalName: 'ST8000VN004-2M2101',
    isSystem: false,
    trimSupported: false,
    fragmentation: mockStats(18),
    lastOptimizedAt: new Date(Date.now() - 32 * 86_400_000).toISOString(),
    lastAction: 'Defrag & Optimize'
  },
  {
    id: 'E',
    letter: 'E',
    label: 'BUFFALO',
    fileSystem: 'NTFS',
    kind: 'removable' as const,
    sizeBytes: 500_107_800_576,
    freeBytes: 490_917_122_048,
    health: 'Healthy',
    diskNumber: 1,
    mediaType: 'Unspecified' as const,
    busType: 'USB',
    physicalName: 'BUFFALO HD-PUSU3',
    isSystem: false,
    trimSupported: false,
    fragmentation: null,
    lastOptimizedAt: null,
    lastAction: null
  }
]

const mockHealth: DiskHealth = {
  trimEnabled: true,
  ntfsDisableDeleteNotify: 0,
  smartSource: 'unavailable (root\\WMI SMART requires Administrator)',
  physicalDisks: [
    {
      deviceId: '0',
      name: 'Samsung SSD 850 EVO 500GB',
      mediaType: 'SSD',
      busType: 'SATA',
      health: 'Healthy',
      operationalStatus: 'OK',
      sizeBytes: 500_107_862_016,
      partitionStyle: null,
      temperatureC: null,
      wear: null,
      powerOnHours: null,
      readErrorsTotal: null,
      writeErrorsTotal: null,
      startStopCycles: null,
      volumes: ['C'],
      notes: []
    },
    {
      deviceId: '1',
      name: 'BUFFALO HD-PUSU3',
      mediaType: 'Unspecified',
      busType: 'USB',
      health: 'Healthy',
      operationalStatus: 'OK',
      sizeBytes: 500_107_862_016,
      partitionStyle: null,
      temperatureC: null,
      wear: null,
      powerOnHours: null,
      readErrorsTotal: null,
      writeErrorsTotal: null,
      startStopCycles: null,
      volumes: ['E'],
      notes: []
    },
    {
      deviceId: '2',
      name: 'ST8000VN004-2M2101',
      mediaType: 'HDD',
      busType: 'SATA',
      health: 'Healthy',
      operationalStatus: 'OK',
      sizeBytes: 8_001_563_222_016,
      partitionStyle: null,
      temperatureC: null,
      wear: null,
      powerOnHours: null,
      readErrorsTotal: null,
      writeErrorsTotal: null,
      startStopCycles: null,
      volumes: ['D'],
      notes: []
    }
  ]
}

const mockLibraries: LibraryEntry[] = [
  {
    id: 'steam:d:\\steamlibrary',
    name: 'Steam library D:\\SteamLibrary',
    provider: 'Steam',
    path: 'D:\\SteamLibrary',
    volumeLetter: 'D',
    sizeBytes: 412_000_000_000,
    mediaType: 'HDD',
    onSsd: false
  }
]

const mockLargeFiles: LargeFileEntry[] = [
  { path: 'D:\\VMs\\win11-dev.vhdx', sizeBytes: 64 * 1024 ** 3, modifiedAt: nowIso(), volumeLetter: 'D' },
  { path: 'D:\\Games\\Starfield\\Data\\Starfield - Textures01.ba2', sizeBytes: 9 * 1024 ** 3, modifiedAt: nowIso(), volumeLetter: 'D' },
  { path: 'E:\\Backups\\laptop-2026-10.pst', sizeBytes: 3.4 * 1024 ** 3, modifiedAt: nowIso(), volumeLetter: 'E' }
]

const mockLogs: LogEntry[] = [
  { id: 'l1', at: nowIso(), channel: 'optimize', level: 'info', message: 'Defrag & Optimize started on D:', detail: 'defrag.exe D: /O /U /V' },
  { id: 'l2', at: nowIso(), channel: 'analyze', level: 'info', message: 'Analysis complete on D: 18% fragmented' },
  { id: 'l3', at: nowIso(), channel: 'app', level: 'warn', message: 'Elevation required', detail: 'defrag.exe requires Administrator privileges' }
]

const mockIssues = (): ActionCenterIssue[] => [
  {
    id: 'not-elevated',
    title: 'Analyze and optimize need Administrator',
    detail: 'Windows refuses all storage-optimizer operations without elevation (0x89000024).',
    severity: 'high',
    fixId: 'elevate'
  },
  {
    id: 'fragmented-D',
    title: 'D is 18% fragmented',
    detail: 'Threshold is 5%. A defrag pass should bring it down.',
    severity: 'medium',
    fixId: 'optimize:D'
  }
]

function buildMock(): UltraApi {
  let settings: Settings = structuredClone(DEFAULT_SETTINGS)
  let job: DefragJob | null = null
  let volumes = mockVolumes()
  let history: OptimizeHistoryEntry[] = []
  const jobListeners = new Set<(job: DefragJob) => void>()
  const statusListeners = new Set<(status: AppStatus) => void>()

  const status = (): AppStatus => ({
    appVersion: '1.0.0',
    host: 'NEO',
    os: 'Windows_NT 10.0.26200 x64',
    elevated: false,
    defragEngine: 'Defrag <Volumes> <Operations> [<Options>]',
    engineAvailable: true,
    volumes,
    health: mockHealth,
    lastJob: job,
    lastOptimize: history[0] ?? null,
    onBattery: false,
    scheduledNext: settings.scheduled.enabled ? new Date(Date.now() + 6 * 3600_000).toISOString() : null,
    pendingPowerAction: null,
    issues: mockIssues(),
    stats: { optimizations: 2, analyzedVolumes: 3, bytesOptimized: 0, lastRunAt: new Date(Date.now() - 5 * 3600_000).toISOString(), installedAt: nowIso() }
  })

  const emit = (): void => {
    for (const listener of statusListeners) listener(status())
  }

  const previewCommand = (request: DefragRequest): DefragCommand => {
    const volume = `${request.volume[0].toUpperCase()}:`
    const media = volumes.find((entry) => `${entry.letter}:` === volume)?.mediaType
    if (requiresHdd(request.action) && media !== 'HDD') throw new Error('This operation requires a detected HDD.')
    const action = media === 'SSD' && (request.action === 'optimize' || request.action === 'quick') ? 'retrim' : request.action
    const flags = {
      analyze: ['/A', '/V'], optimize: ['/O', '/U', '/V'], traditional: ['/D', '/U', '/V'],
      quick: ['/O', '/U'], freeSpace: ['/X', '/U', '/V'], retrim: ['/L', '/U'],
      slab: ['/K', '/U'], bootOptimize: ['/B'], files: ['/D', '/U', '/File', ...(request.files ?? [])]
    }
    const args = [volume, ...flags[action]]
    return { executable: 'defrag.exe', args, display: `defrag.exe ${args.map((arg) => /\s/.test(arg) ? `"${arg}"` : arg).join(' ')}` }
  }

  const runJob = async (request: DefragRequest): Promise<DefragJob> => {
    const base: DefragJob = {
      id: `job_${Date.now()}`,
      action: request.action,
      volume: request.volume,
      state: 'running',
      command: previewCommand(request).display,
      percent: 0,
      phase: request.action === 'analyze' ? 'Analyzing' : 'Optimizing',
      startedAt: nowIso(),
      lines: []
    }

    if (request.dryRun) {
      job = { ...base, dryRun: true, state: 'completed', percent: 100, phase: 'dry run — command not executed', finishedAt: nowIso(), lines: [`dry run: ${base.command}`] }
      for (const listener of jobListeners) listener(job)
      return job
    }

    // Preview mode has no Administrator rights, so it shows the same honest gate the real app shows.
    if (window.ultra === undefined) {
      job = {
        ...base,
        state: 'needs-elevation',
        phase: 'Administrator rights required',
        elevationHint: 'The Windows storage optimizer refuses to run without elevation (0x89000024). Relaunch Ultra Harddisk Defrag as Administrator.',
        finishedAt: nowIso(),
        lines: ['defrag.exe requires Administrator privileges; nothing was executed.']
      }
      for (const listener of jobListeners) listener(job)
      emit()
      return job
    }
    return base
  }

  return {
    getStatus: async () => status(),
    refreshVolumes: async () => {
      volumes = mockVolumes()
      emit()
      return status()
    },
    getSettings: async () => settings,
    saveSettings: async (patch) => {
      settings = Object.fromEntries(Object.entries(settings).map(([key, section]) =>
        [key, { ...section, ...patch[key as keyof Settings] }])) as unknown as Settings
      emit()
      return settings
    },
    resetSettings: async () => {
      settings = structuredClone(DEFAULT_SETTINGS)
      return settings
    },

    analyze: async (volume, dryRun) => runJob({ action: 'analyze', volume, dryRun }),
    startJob: async (request) => runJob(request),
    startJobs: async (requests) => Promise.all(requests.map(runJob)),
    cancelJob: async () => {
      if (job) job = { ...job, state: 'cancelled', finishedAt: nowIso() }
    },
    cancelPowerAction: async () => false,
    getJob: async () => job,
    getHistory: async () => history,
    previewCommand: async (request) => previewCommand(request),

    getHealth: async () => mockHealth,
    getLibraries: async () => mockLibraries,
    addLibrary: async () => mockLibraries.map((l) => l.path),
    removeLibrary: async () => [],
    scanLargeFiles: async ({ volume, minSizeMb, limit }) => {
      await delay(400)
      return mockLargeFiles.filter((file) => (!volume || file.volumeLetter === volume[0].toUpperCase()) && file.sizeBytes >= minSizeMb * 1024 ** 2).slice(0, limit)
    },
    defragFiles: async (volume, files, dryRun) => runJob({ action: 'files', volume, files, dryRun }),

    getActionCenter: async () => mockIssues(),
    fixAll: async () => ({ fixed: 0, issues: mockIssues().length }),
    getLogs: async (channel) => (channel ? mockLogs.filter((l) => l.channel === channel) : mockLogs),
    clearLogs: async () => undefined,

    relaunchElevated: async () => ({ ok: false, message: 'Preview mode cannot elevate — run the Electron build.' }),
    pickFiles: async () => [],
    openPath: async () => undefined,
    showInFolder: async () => undefined,

    windowMinimize: () => undefined,
    windowMaximize: () => undefined,
    windowClose: () => undefined,

    onJobProgress: (handler) => {
      jobListeners.add(handler)
      return () => jobListeners.delete(handler)
    },
    onStatus: (handler) => {
      statusListeners.add(handler)
      return () => statusListeners.delete(handler)
    },
    onNotification: () => () => undefined,
    onNavigate: () => () => undefined
  }
}

const hadBridge = !!window.ultra
if (!hadBridge) window.ultra = buildMock()

export const api: UltraApi = window.ultra!
export const isMock = !hadBridge
