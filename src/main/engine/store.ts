import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_SETTINGS,
  type DeepPartial,
  type LogEntry,
  type OptimizeHistoryEntry,
  type Settings
} from '../../shared/types'
import { nowIso, readJson, uid, writeJson, type RuntimePaths } from './runtime'

export interface Stats {
  optimizations: number
  analyzedVolumes: number
  bytesOptimized: number
  lastRunAt: string | null
  installedAt: string
}

const EMPTY_STATS: Stats = {
  optimizations: 0,
  analyzedVolumes: 0,
  bytesOptimized: 0,
  lastRunAt: null,
  installedAt: nowIso()
}

/** Per-volume last action, so the dashboard can show "never optimized" honestly. */
export interface VolumeMemory {
  lastOptimizedAt: string
  lastAction: string
  fragmentedPercent: number | null
}

export interface VolumeMemoryMap {
  [letter: string]: VolumeMemory
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function mergeSettings(base: Settings, patch: DeepPartial<Settings> | Record<string, unknown>): Settings {
  const out = structuredClone(base) as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in out)) continue
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeSettings(out[key] as unknown as Settings, value)
    else if (value !== undefined) out[key] = value
  }
  return out as unknown as Settings
}

export class Store {
  private settingsValue: Settings = structuredClone(DEFAULT_SETTINGS)
  private logs: LogEntry[] = []
  private history: OptimizeHistoryEntry[] = []
  private statsValue: Stats = { ...EMPTY_STATS }
  private volumeMemory: VolumeMemoryMap = {}
  private manualLibraries: string[] = []
  private lastPersistError: string | null = null

  constructor(private readonly paths: RuntimePaths) {}

  async init(): Promise<void> {
    const loaded = await readJson<Partial<Settings>>(this.paths.settings, {})
    this.settingsValue = mergeSettings(DEFAULT_SETTINGS, loaded as Record<string, unknown>)
    this.logs = await readJson<LogEntry[]>(path.join(this.paths.state, 'logs.json'), [])
    this.history = await readJson<OptimizeHistoryEntry[]>(this.paths.history, [])
    this.statsValue = { ...EMPTY_STATS, ...(await readJson<Partial<Stats>>(path.join(this.paths.state, 'stats.json'), {})) }
    this.volumeMemory = await readJson<VolumeMemoryMap>(path.join(this.paths.state, 'volumes.json'), {})
    this.manualLibraries = await readJson<string[]>(path.join(this.paths.state, 'libraries.json'), [])
  }

  /** Best-effort persistence: a lost log line must never take the process down. */
  private persist(file: string, value: unknown): void {
    void writeJson(file, value).catch((err: unknown) => {
      this.lastPersistError = `${file}: ${err instanceof Error ? err.message : String(err)}`
      console.error('[ultra-defrag] persist failed', this.lastPersistError)
    })
  }

  settings(): Settings {
    return this.settingsValue
  }

  async updateSettings(patch: DeepPartial<Settings>): Promise<Settings> {
    this.settingsValue = mergeSettings(this.settingsValue, patch as Record<string, unknown>)
    await writeJson(this.paths.settings, this.settingsValue).catch((err: unknown) => {
      this.lastPersistError = `settings: ${err instanceof Error ? err.message : String(err)}`
    })
    return this.settingsValue
  }

  async resetSettings(): Promise<Settings> {
    this.settingsValue = structuredClone(DEFAULT_SETTINGS)
    await this.updateSettings({})
    return this.settingsValue
  }

  // ---- logs ---------------------------------------------------------------
  addLog(channel: LogEntry['channel'], level: LogEntry['level'], message: string, detail?: string): LogEntry {
    const entry: LogEntry = { id: uid('log'), at: nowIso(), channel, level, message, detail }
    this.logs.unshift(entry)
    const cap = Math.max(50, this.settingsValue.log.maxEntries)
    if (this.logs.length > cap) this.logs.length = cap
    this.persist(path.join(this.paths.state, 'logs.json'), this.logs)
    return entry
  }

  getLogs(channel?: LogEntry['channel']): LogEntry[] {
    return channel ? this.logs.filter((l) => l.channel === channel) : [...this.logs]
  }

  async clearLogs(): Promise<void> {
    this.logs = []
    await writeJson(path.join(this.paths.state, 'logs.json'), this.logs).catch(() => undefined)
  }

  // ---- history / stats ----------------------------------------------------
  async addHistory(entry: OptimizeHistoryEntry): Promise<void> {
    this.history.unshift(entry)
    if (this.history.length > 100) this.history.length = 100
    this.persist(this.paths.history, this.history)
    this.statsValue.optimizations += entry.state === 'completed' ? 1 : 0
    this.statsValue.analyzedVolumes += entry.action === 'analyze' ? 1 : 0
    this.statsValue.lastRunAt = entry.finishedAt
    await this.persistStats()
  }

  historyEntries(): OptimizeHistoryEntry[] {
    return [...this.history]
  }

  stats(): Stats {
    return { ...this.statsValue }
  }

  addBytesOptimized(bytes: number): void {
    this.statsValue.bytesOptimized += Math.max(0, bytes)
    void this.persistStats()
  }

  private async persistStats(): Promise<void> {
    await writeJson(path.join(this.paths.state, 'stats.json'), this.statsValue).catch(() => undefined)
  }

  // ---- volume memory ------------------------------------------------------
  volumeState(): VolumeMemoryMap {
    return { ...this.volumeMemory }
  }

  recordVolume(letter: string, action: string, fragmentedPercent: number | null): void {
    // Accept both "C" and "C:\\" — the caller may pass the volume identifier.
    const key = letter.trim().slice(0, 1).toUpperCase()
    this.volumeMemory[key] = { lastOptimizedAt: nowIso(), lastAction: action, fragmentedPercent }
    this.persist(path.join(this.paths.state, 'volumes.json'), this.volumeMemory)
  }

  // ---- manual libraries ---------------------------------------------------
  libraries(): string[] {
    return [...this.manualLibraries]
  }

  async addLibrary(target: string): Promise<string[]> {
    if (!this.manualLibraries.includes(target)) this.manualLibraries.push(target)
    this.persist(path.join(this.paths.state, 'libraries.json'), this.manualLibraries)
    return this.libraries()
  }

  async removeLibrary(target: string): Promise<string[]> {
    this.manualLibraries = this.manualLibraries.filter((entry) => entry !== target)
    this.persist(path.join(this.paths.state, 'libraries.json'), this.manualLibraries)
    return this.libraries()
  }
}
