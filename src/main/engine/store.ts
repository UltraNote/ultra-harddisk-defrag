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

function mergeSettings<T extends object>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base
  const out: Record<string, unknown> = { ...base } as Record<string, unknown>
  for (const [key, current] of Object.entries(base)) {
    const value = patch[key]
    if (isPlainObject(current)) out[key] = mergeSettings(current, value)
    else if (Array.isArray(current)) {
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) out[key] = [...value]
    } else if (typeof value === typeof current && (typeof value !== 'number' || Number.isFinite(value))) {
      out[key] = value
    }
  }
  return out as T
}

function normaliseSettings(next: Settings): Settings {
  const whole = (value: number, lower: number, upper: number): number => Math.max(lower, Math.min(upper, Math.trunc(value)))
  const actions = ['optimize', 'quick', 'traditional', 'retrim']
  next.scheduled = {
    ...next.scheduled,
    cadence: ['daily', 'weekly', 'monthly'].includes(next.scheduled.cadence) ? next.scheduled.cadence : DEFAULT_SETTINGS.scheduled.cadence,
    weekday: whole(next.scheduled.weekday, 0, 6),
    dayOfMonth: whole(next.scheduled.dayOfMonth, 1, 28),
    hour: whole(next.scheduled.hour, 0, 23),
    minute: whole(next.scheduled.minute, 0, 59),
    action: actions.includes(next.scheduled.action) ? next.scheduled.action : 'optimize'
  }
  next.autoDefrag = {
    ...next.autoDefrag,
    idleMinutes: whole(next.autoDefrag.idleMinutes, 1, 180),
    thresholdPercent: whole(next.autoDefrag.thresholdPercent, 1, 50),
    action: actions.includes(next.autoDefrag.action) ? next.autoDefrag.action : 'optimize'
  }
  next.afterTask = {
    ...next.afterTask,
    action: ['none', 'shutdown', 'restart', 'sleep', 'hibernate'].includes(next.afterTask.action) ? next.afterTask.action : 'none',
    delaySeconds: whole(next.afterTask.delaySeconds, 10, 600)
  }
  next.log = { maxEntries: whole(next.log.maxEntries, 50, 5000) }
  return next
}

export class Store {
  private settingsValue: Settings = structuredClone(DEFAULT_SETTINGS)
  private logs: LogEntry[] = []
  private history: OptimizeHistoryEntry[] = []
  private statsValue: Stats = { ...EMPTY_STATS }
  private volumeMemory: VolumeMemoryMap = {}
  private manualLibraries: string[] = []
  private automation = { scheduledDay: '', autoAt: 0 }
  private readonly writes = new Map<string, Promise<void>>()

  constructor(private readonly paths: RuntimePaths) {}

  async init(): Promise<void> {
    const loaded = await readJson<Partial<Settings>>(this.paths.settings, {})
    this.settingsValue = normaliseSettings(mergeSettings(DEFAULT_SETTINGS, loaded))
    const logs = await readJson<LogEntry[]>(path.join(this.paths.state, 'logs.json'), [])
    this.logs = Array.isArray(logs) ? logs.filter((entry) => entry && typeof entry.message === 'string') : []
    const history = await readJson<OptimizeHistoryEntry[]>(this.paths.history, [])
    this.history = Array.isArray(history) ? history.filter((entry) => entry && typeof entry.id === 'string') : []
    const stats = await readJson<Partial<Stats>>(path.join(this.paths.state, 'stats.json'), {})
    this.statsValue = {
      ...mergeSettings(EMPTY_STATS, stats),
      lastRunAt: typeof stats?.lastRunAt === 'string' ? stats.lastRunAt : null
    }
    const volumes = await readJson<VolumeMemoryMap>(path.join(this.paths.state, 'volumes.json'), {})
    this.volumeMemory = isPlainObject(volumes) ? volumes : {}
    const libraries = await readJson<string[]>(path.join(this.paths.state, 'libraries.json'), [])
    this.manualLibraries = Array.isArray(libraries) ? libraries.filter((entry) => typeof entry === 'string') : []
    this.automation = mergeSettings(this.automation, await readJson(path.join(this.paths.state, 'automation.json'), {}))
  }

  private persist(file: string, value: unknown): Promise<void> {
    const snapshot = structuredClone(value)
    const write = (this.writes.get(file) ?? Promise.resolve()).then(() => writeJson(file, snapshot))
    const settled = write.catch((err: unknown) => {
      console.error('[ultra-defrag] persist failed', file, err)
    })
    this.writes.set(file, settled)
    void settled.then(() => {
      if (this.writes.get(file) === settled) this.writes.delete(file)
    })
    return write
  }

  async flush(): Promise<void> {
    while (this.writes.size) await Promise.all(this.writes.values())
  }

  settings(): Settings {
    return this.settingsValue
  }

  async updateSettings(patch: DeepPartial<Settings>): Promise<Settings> {
    const next = normaliseSettings(mergeSettings(this.settingsValue, patch))
    this.settingsValue = next
    await this.persist(this.paths.settings, next)
    return next
  }

  async resetSettings(): Promise<Settings> {
    return this.updateSettings(DEFAULT_SETTINGS)
  }

  automationState(): { scheduledDay: string; autoAt: number } {
    return this.automation
  }

  markAutomationRun(update: Partial<typeof this.automation>): void {
    this.automation = { ...this.automation, ...update }
    void this.persist(path.join(this.paths.state, 'automation.json'), this.automation)
  }

  // ---- logs ---------------------------------------------------------------
  addLog(channel: LogEntry['channel'], level: LogEntry['level'], message: string, detail?: string): LogEntry {
    const entry: LogEntry = { id: uid('log'), at: nowIso(), channel, level, message, detail }
    this.logs.unshift(entry)
    const cap = Math.max(50, this.settingsValue.log.maxEntries)
    if (this.logs.length > cap) this.logs.length = cap
    void this.persist(path.join(this.paths.state, 'logs.json'), this.logs)
    return entry
  }

  getLogs(channel?: LogEntry['channel']): LogEntry[] {
    return channel ? this.logs.filter((l) => l.channel === channel) : [...this.logs]
  }

  async clearLogs(): Promise<void> {
    this.logs = []
    await this.persist(path.join(this.paths.state, 'logs.json'), this.logs)
  }

  // ---- history / stats ----------------------------------------------------
  async addHistory(entry: OptimizeHistoryEntry): Promise<void> {
    this.history.unshift(entry)
    if (this.history.length > 100) this.history.length = 100
    const writes = [this.persist(this.paths.history, this.history)]
    if (!entry.dryRun && entry.state === 'completed') {
      if (entry.action === 'analyze') this.statsValue.analyzedVolumes++
      else this.statsValue.optimizations++
      this.statsValue.lastRunAt = entry.finishedAt
      writes.push(this.persist(path.join(this.paths.state, 'stats.json'), this.statsValue))
    }
    await Promise.allSettled(writes)
  }

  historyEntries(): OptimizeHistoryEntry[] {
    return [...this.history]
  }

  stats(): Stats {
    return { ...this.statsValue }
  }

  // ---- volume memory ------------------------------------------------------
  volumeState(): VolumeMemoryMap {
    return { ...this.volumeMemory }
  }

  recordVolume(identifier: string, action: string, fragmentedPercent: number | null): void {
    const drive = identifier.match(/^([a-z])(?::[\\/]?)?$/i)
    const key = drive ? drive[1].toUpperCase() : identifier
    this.volumeMemory[key] = { lastOptimizedAt: nowIso(), lastAction: action, fragmentedPercent }
    void this.persist(path.join(this.paths.state, 'volumes.json'), this.volumeMemory)
  }

  // ---- manual libraries ---------------------------------------------------
  libraries(): string[] {
    return [...this.manualLibraries]
  }

  async addLibrary(target: string): Promise<string[]> {
    if (!this.manualLibraries.includes(target)) this.manualLibraries.push(target)
    await this.persist(path.join(this.paths.state, 'libraries.json'), this.manualLibraries)
    return this.libraries()
  }

  async removeLibrary(target: string): Promise<string[]> {
    this.manualLibraries = this.manualLibraries.filter((entry) => entry !== target)
    await this.persist(path.join(this.paths.state, 'libraries.json'), this.manualLibraries)
    return this.libraries()
  }
}
