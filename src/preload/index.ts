import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActionCenterIssue,
  AppStatus,
  DeepPartial,
  DefragCommand,
  DefragJob,
  DefragRequest,
  DiskHealth,
  LargeFileEntry,
  LibraryEntry,
  LogEntry,
  OptimizeHistoryEntry,
  Settings,
  UltraApi
} from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: UltraApi = {
  getStatus: () => invoke<AppStatus>('ultra:status'),
  refreshVolumes: () => invoke<AppStatus>('ultra:volumes:refresh'),
  getSettings: () => invoke<Settings>('ultra:settings'),
  saveSettings: (patch: DeepPartial<Settings>) => invoke<Settings>('ultra:settings:save', patch),
  resetSettings: () => invoke<Settings>('ultra:settings:reset'),

  analyze: (volume: string, dryRun?: boolean) => invoke<DefragJob>('ultra:analyze', volume, dryRun),
  startJob: (request: DefragRequest) => invoke<DefragJob>('ultra:job:start', request),
  startJobs: (requests: DefragRequest[]) => invoke<DefragJob[]>('ultra:jobs:start', requests),
  cancelJob: () => invoke<void>('ultra:job:cancel'),
  cancelPowerAction: () => invoke<boolean>('ultra:power:cancel'),
  getJob: () => invoke<DefragJob | null>('ultra:job:current'),
  getHistory: () => invoke<OptimizeHistoryEntry[]>('ultra:history'),
  previewCommand: (request: DefragRequest) => invoke<DefragCommand>('ultra:job:preview', request),

  getHealth: () => invoke<DiskHealth>('ultra:health'),
  getLibraries: () => invoke<LibraryEntry[]>('ultra:libraries'),
  addLibrary: (target: string) => invoke<string[]>('ultra:libraries:add', target),
  removeLibrary: (target: string) => invoke<string[]>('ultra:libraries:remove', target),
  scanLargeFiles: (options: { volume?: string; root?: string; minSizeMb: number; limit: number }) => invoke<LargeFileEntry[]>('ultra:largefiles', options),
  defragFiles: (volume: string, files: string[], dryRun?: boolean) => invoke<DefragJob>('ultra:files:defrag', volume, files, dryRun),

  getActionCenter: () => invoke<ActionCenterIssue[]>('ultra:actioncenter'),
  fixAll: () => invoke<{ fixed: number; issues: number }>('ultra:fixall'),
  getLogs: (channel?: LogEntry['channel']) => invoke<LogEntry[]>('ultra:logs', channel),
  clearLogs: () => invoke<void>('ultra:logs:clear'),

  relaunchElevated: () => invoke<{ ok: boolean; message: string }>('ultra:relaunch'),
  pickFiles: (kind) => invoke<string[]>('ultra:pick', kind),
  openPath: (target: string) => invoke<void>('ultra:open', target),
  showInFolder: (target: string) => invoke<void>('ultra:show', target),

  windowMinimize: () => ipcRenderer.send('ultra:win', 'minimize'),
  windowMaximize: () => ipcRenderer.send('ultra:win', 'maximize'),
  windowClose: () => ipcRenderer.send('ultra:win', 'close'),

  onJobProgress: (handler) => subscribe<DefragJob>('ultra:job', handler),
  onStatus: (handler) => subscribe<AppStatus>('ultra:status', handler),
  onNotification: (handler) => subscribe<{ title: string; body: string; level: string }>('ultra:notify', handler),
  onNavigate: (handler) => subscribe<string>('ultra:navigate', handler)
}

contextBridge.exposeInMainWorld('ultra', api)
