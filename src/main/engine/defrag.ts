import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  DefragAction,
  DefragCommand,
  DefragJob,
  DefragRequest,
  FragmentationStats,
  OptimizeHistoryEntry
} from '../../shared/types'
import { nowIso, uid } from './runtime'

const DEFRAG = 'defrag.exe'

export const ACTION_LABELS: Record<DefragAction, string> = {
  analyze: 'Analyze',
  optimize: 'Defrag & Optimize',
  traditional: 'Traditional Defrag',
  quick: 'Fast Defrag',
  freeSpace: 'Free Space Defrag',
  retrim: 'Trim & Intelligent Optimize',
  slab: 'Slab Consolidation',
  bootOptimize: 'Boot Time Defrag',
  files: 'Defrag Selected Files'
}

/** Only real operations defrag.exe understands; no invented flags. */
export function buildCommand(request: DefragRequest): DefragCommand {
  const volume = normaliseVolume(request.volume)
  const args: string[] = [volume]
  switch (request.action) {
    case 'analyze':
      args.push('/A', '/V')
      break
    case 'optimize':
      // /O picks the right operation per media type: defrag on HDD, retrim/slab on SSD.
      args.push('/O', '/U', '/V')
      break
    case 'traditional':
      args.push('/D', '/U', '/V')
      break
    case 'quick':
      args.push('/O', '/U')
      break
    case 'freeSpace':
      args.push('/X', '/U', '/V')
      break
    case 'retrim':
      args.push('/L', '/U')
      break
    case 'slab':
      args.push('/K', '/U')
      break
    case 'bootOptimize':
      args.push('/B')
      break
    case 'files': {
      const files = (request.files ?? []).filter(Boolean)
      if (!files.length) throw new Error('No files selected for a targeted defrag')
      args.push('/D', '/U', '/File', ...files)
      break
    }
    default:
      throw new Error(`Unsupported action: ${String(request.action)}`)
  }
  return { executable: DEFRAG, args, display: `${DEFRAG} ${args.map(quote).join(' ')}` }
}

function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

export function normaliseVolume(input: string): string {
  const trimmed = (input ?? '').trim()
  const drive = trimmed.match(/^([A-Za-z]):?(\\|\/)?$/)
  if (drive) return `${drive[1].toUpperCase()}:`
  if (/^\\\\\?\\Volume\{[0-9a-fA-F-]+\}\\?$/.test(trimmed)) return trimmed
  throw new Error(`Unsupported volume identifier: ${input}`)
}

export interface ParsedStats {
  stats: FragmentationStats | null
  percent: number | null
  done: boolean
}

const NUMBER = '([\\d.,]+)'

export function parseDefragOutput(text: string): ParsedStats {
  const grab = (pattern: RegExp): number | null => {
    const match = text.match(pattern)
    if (!match) return null
    const value = Number(match[1].replace(/[,\s]/g, ''))
    return Number.isFinite(value) ? value : null
  }

  const totalFragmentedSpacePercent = grab(new RegExp(`Total fragmented space\\s*=\\s*${NUMBER}\\s*%`, 'i'))
  const averageFragmentsPerFile = grab(new RegExp(`Average fragments per file\\s*=\\s*${NUMBER}`, 'i'))
  const fragmentedFiles = grab(new RegExp(`Total fragmented files\\s*=\\s*${NUMBER}`, 'i'))
  const excessFragments = grab(new RegExp(`Total excess fragments\\s*=\\s*${NUMBER}`, 'i'))
  const folders = grab(new RegExp(`Total folders\\s*=\\s*${NUMBER}`, 'i'))
  const averageFragmentsPerFolder = grab(new RegExp(`Average fragments per folder\\s*=\\s*${NUMBER}`, 'i'))
  const scatteredFiles = grab(new RegExp(`Total scattered files\\s*=\\s*${NUMBER}`, 'i'))
  const freeSpacePercent = grab(new RegExp(`Percent free space\\s*=\\s*${NUMBER}\\s*%`, 'i'))
  const volumeSizeText = text.match(/Volume size\s*=\s*([^\r\n]+)/i)?.[1]?.trim() ?? null
  const clusterSizeText = text.match(/Cluster size\s*=\s*([^\r\n]+)/i)?.[1]?.trim() ?? null

  const hasStats = totalFragmentedSpacePercent !== null || fragmentedFiles !== null
  const stats: FragmentationStats | null = hasStats
    ? {
        analyzedAt: nowIso(),
        totalFragmentedSpacePercent,
        averageFragmentsPerFile,
        fragmentedFiles,
        excessFragments,
        folders,
        averageFragmentsPerFolder,
        scatteredFiles,
        volumeSizeText,
        freeSpacePercent,
        clusterSizeText,
        rawText: text.slice(-20_000)
      }
    : null

  let percent: number | null = null
  for (const match of text.matchAll(/(\d{1,3})\s*%/g)) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value >= 0 && value <= 100) percent = Math.max(percent ?? 0, value)
  }

  const done = /(operation completed successfully|defragmentation complete|optimization complete|analysis complete)/i.test(text)
  return { stats, percent, done }
}

const ELEVATION_MARKERS = /insufficient privileges|0x89000024|requires? elevation|access is denied/i

export function looksLikeElevationError(text: string): boolean {
  return ELEVATION_MARKERS.test(text)
}

export interface RunnerHooks {
  elevated: boolean
  onProgress(job: DefragJob): void
  onLog(channel: 'optimize' | 'analyze', level: 'info' | 'warn' | 'error', message: string, detail?: string): void
  onFinished?(job: DefragJob, history: OptimizeHistoryEntry): void
}

/**
 * Runs one defrag.exe operation at a time. Nothing here writes to a disk directly:
 * every byte moved is moved by Microsoft's own storage optimizer, which is why the
 * app needs Administrator rights and why an SSD is trimmed instead of defragmented.
 */
export class DefragRunner {
  private job: DefragJob | null = null
  private child: ChildProcess | null = null
  private cancelRequested = false
  private lastEmit = 0

  constructor(private readonly hooks: RunnerHooks) {}

  current(): DefragJob | null {
    return this.job
  }

  preview(request: DefragRequest): DefragCommand {
    return buildCommand(request)
  }

  cancel(): void {
    if (this.job && this.job.state === 'running') {
      this.cancelRequested = true
      const pid = this.child?.pid
      if (pid) {
        void import('node:child_process').then(({ execFile }) => {
          execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined)
        })
      }
    }
  }

  async run(request: DefragRequest): Promise<DefragJob> {
    if (this.job?.state === 'running') return this.job

    let command: DefragCommand
    try {
      command = buildCommand(request)
    } catch (err) {
      const failed = this.makeJob(request, 'invalid')
      failed.state = 'failed'
      failed.error = err instanceof Error ? err.message : String(err)
      failed.finishedAt = nowIso()
      this.job = failed
      this.finish(failed)
      return failed
    }

    const job = this.makeJob(request, command.display)
    this.job = job
    this.cancelRequested = false
    this.emit(true)

    if (request.dryRun) {
      job.state = 'completed'
      job.percent = 100
      job.phase = 'dry run — command not executed'
      job.lines = [`dry run: ${command.display}`]
      job.finishedAt = nowIso()
      this.hooks.onLog('optimize', 'info', 'Dry run', command.display)
      this.finish(job)
      return job
    }

    if (!this.hooks.elevated) {
      job.state = 'needs-elevation'
      job.phase = 'Administrator rights required'
      job.elevationHint = 'The Windows storage optimizer refuses to run without elevation (0x89000024). Relaunch Ultra Harddisk Defrag as Administrator.'
      job.lines = ['defrag.exe requires Administrator privileges; nothing was executed.']
      job.finishedAt = nowIso()
      this.hooks.onLog('optimize', 'warn', 'Elevation required', `${ACTION_LABELS[job.action]} on ${job.volume}`)
      this.finish(job)
      return job
    }

    this.hooks.onLog(request.action === 'analyze' ? 'analyze' : 'optimize', 'info', `${ACTION_LABELS[request.action]} started on ${job.volume}`, command.display)

    try {
      await this.spawnDefrag(job, command)
    } catch (err) {
      job.state = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      job.finishedAt = nowIso()
      this.hooks.onLog('optimize', 'error', `${ACTION_LABELS[job.action]} failed`, job.error)
    }

    this.finish(job)
    return job
  }

  /** Single exit point: history + final progress event, whatever the outcome. */
  private finish(job: DefragJob): void {
    this.hooks.onFinished?.(job, this.historyFor(job))
    this.emit(true)
  }

  private makeJob(request: DefragRequest, commandText: string): DefragJob {
    return {
      id: uid('job'),
      action: request.action,
      volume: normaliseVolumeOrFallback(request.volume),
      state: 'running',
      command: commandText,
      percent: 0,
      phase: ACTION_LABELS[request.action] ?? 'Working',
      startedAt: nowIso(),
      lines: []
    }
  }

  private spawnDefrag(job: DefragJob, command: DefragCommand): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command.executable, command.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      let collected = ''
      let pending = ''

      const consume = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        collected += text
        pending += text
        const parts = pending.split(/[\r\n]+/)
        pending = parts.pop() ?? ''
        for (const line of parts) {
          const trimmed = line.trim()
          if (!trimmed) continue
          job.lines.push(trimmed)
          if (job.lines.length > 400) job.lines.splice(0, job.lines.length - 400)
        }
        const parsed = parseDefragOutput(pending)
        if (parsed.percent !== null && parsed.percent >= job.percent) job.percent = parsed.percent
        if (parsed.done && job.percent < 99) job.percent = 99
        job.phase = describePhase(pending, job.action)
        this.emit()
      }

      child.stdout?.on('data', consume)
      child.stderr?.on('data', consume)

      child.on('error', (err) => {
        this.child = null
        reject(err)
      })

      child.on('close', (code) => {
        this.child = null
        if (pending.trim()) job.lines.push(pending.trim())
        const text = `${collected}\n${pending}`
        const parsed = parseDefragOutput(text)

        if (this.cancelRequested) {
          job.state = 'cancelled'
          job.percent = Math.min(job.percent, 99)
          job.finishedAt = nowIso()
          job.phase = 'Cancelled'
          this.hooks.onLog('optimize', 'warn', `${ACTION_LABELS[job.action]} cancelled on ${job.volume}`)
          resolve()
          return
        }

        if (looksLikeElevationError(text) && code !== 0) {
          job.state = 'needs-elevation'
          job.elevationHint = 'defrag.exe reported insufficient privileges. Relaunch the app as Administrator.'
          job.finishedAt = nowIso()
          resolve()
          return
        }

        job.exitCode = code ?? undefined
        job.state = code === 0 ? 'completed' : 'failed'
        job.percent = code === 0 ? 100 : job.percent
        job.finishedAt = nowIso()
        job.phase = code === 0 ? 'Finished' : 'Failed'
        if (code !== 0 && !job.error) job.error = job.lines.slice(-3).join(' | ') || `defrag.exe exited with code ${code}`
        if (job.action === 'analyze' && parsed.stats) job.statsAfter = parsed.stats
        this.hooks.onLog('optimize', code === 0 ? 'info' : 'error', `${ACTION_LABELS[job.action]} ${code === 0 ? 'completed' : 'failed'} on ${job.volume}`, job.error)
        resolve()
      })
    })
  }

  private historyFor(job: DefragJob): OptimizeHistoryEntry {
    const finished = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now()
    return {
      id: job.id,
      action: job.action,
      volume: job.volume,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? nowIso(),
      state: job.state,
      durationMs: finished - new Date(job.startedAt).getTime(),
      fragmentedPercentBefore: job.statsBefore?.totalFragmentedSpacePercent ?? null,
      fragmentedPercentAfter: job.statsAfter?.totalFragmentedSpacePercent ?? null,
      exitCode: job.exitCode ?? null
    }
  }

  private emit(force = false): void {
    if (!this.job) return
    const now = Date.now()
    if (!force && now - this.lastEmit < 150) return
    this.lastEmit = now
    this.hooks.onProgress({ ...this.job, lines: [...this.job.lines] })
  }
}

function describePhase(text: string, action: DefragAction): string {
  if (/analy/i.test(text)) return 'Analyzing'
  if (/prefetch|boot/i.test(text)) return 'Boot optimization'
  if (/trim|retrim/i.test(text)) return 'Retrim'
  if (/consolidat|free space/i.test(text)) return 'Consolidating free space'
  if (/defrag|optimi/i.test(text)) return 'Optimizing'
  return ACTION_LABELS[action]
}

function normaliseVolumeOrFallback(input: string): string {
  try {
    return normaliseVolume(input)
  } catch {
    return input
  }
}

/** Reads a sample of the defrag help output — proves the engine binary is callable. */
export async function engineInfo(): Promise<{ available: boolean; text: string }> {
  return new Promise((resolve) => {
    const child = spawn(DEFRAG, ['/?'], { windowsHide: true })
    let text = ''
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    child.on('error', () => resolve({ available: false, text: '' }))
    child.on('close', () => {
      const available = /Defrag\s+<Volumes>/i.test(text)
      resolve({ available, text: text.slice(0, 4000) })
    })
  })
}

export async function ensureFileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile()
  } catch {
    return false
  }
}

export function filesOnVolume(files: string[], volume: string): { accepted: string[]; rejected: string[] } {
  const letter = normaliseVolume(volume).slice(0, 1).toUpperCase()
  const accepted: string[] = []
  const rejected: string[] = []
  for (const file of files) {
    const drive = path.parse(file).root.slice(0, 1).toUpperCase()
    if (drive === letter) accepted.push(file)
    else rejected.push(file)
  }
  return { accepted, rejected }
}
