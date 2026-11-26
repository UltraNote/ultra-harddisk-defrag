import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  DefragAction,
  DefragCommand,
  DefragJob,
  DefragRequest,
  FragmentationStats,
  MediaType,
  OptimizeHistoryEntry
} from '../../shared/types'
import { nowIso, uid } from './runtime'
import { run, systemExecutable } from './shell'
import { requiresHdd } from '../../shared/types'

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
export function buildCommand(request: DefragRequest, media?: MediaType): DefragCommand {
  const volume = normaliseVolume(request.volume)
  if (request.action === 'files' && !(request.files ?? []).length) throw new Error('No files selected for a targeted defrag')
  if (media !== undefined && media !== 'HDD' && requiresHdd(request.action)) {
    throw new Error('This operation requires a volume identified as an HDD. Choose Optimize for automatic media selection.')
  }
  const args: string[] = [volume]
  const action = media === 'SSD' && ['optimize', 'quick'].includes(request.action) ? 'retrim' : request.action
  switch (action) {
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
      const files = request.files!
      if (filesOnVolume(files, volume).rejected.length) throw new Error('Select literal, absolute file paths on the requested drive.')
      args.push('/D', '/U', '/File', ...files)
      break
    }
    default:
      throw new Error(`Unsupported action: ${String(request.action)}`)
  }
  const argumentText = args.map(quote).join(' ')
  if (argumentText.length > 30_000) throw new Error('Select fewer files for this operation.')
  return { executable: DEFRAG, args, display: `${DEFRAG} ${argumentText}` }
}


function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

export function normaliseVolume(input: string): string {
  const trimmed = (input ?? '').trim()
  const drive = trimmed.match(/^([A-Za-z]):?(\\|\/)?$/)
  if (drive) return `${drive[1].toUpperCase()}:`
  if (/^\\\\\?\\Volume\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}\\?$/i.test(trimmed)) return trimmed
  throw new Error(`Unsupported volume identifier: ${input}`)
}

export interface ParsedStats {
  stats: FragmentationStats | null
  percent: number | null
  done: boolean
}

const NUMBER = '([\\d.,]+)'
const POST_REPORT = /^[\t ]*Post-(?:Optimization|Defragmentation) Report[^\r\n]*$/im
const PRE_REPORT = /^[\t ]*Pre-(?:Optimization|Defragmentation) Report[^\r\n]*$/im

export function parseDefragOutput(text: string): ParsedStats {
  const report = text.split(POST_REPORT).at(-1) ?? text
  const grab = (pattern: RegExp): number | null => {
    const match = report.match(pattern)
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
  const volumeSizeText = report.match(/Volume size\s*=\s*([^\r\n]+)/i)?.[1]?.trim() ?? null
  const clusterSizeText = report.match(/Cluster size\s*=\s*([^\r\n]+)/i)?.[1]?.trim() ?? null

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
  mediaForVolume?(volume: string): MediaType
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
    return buildCommand(request, this.hooks.mediaForVolume?.(normaliseVolume(request.volume)))
  }

  cancel(): void {
    if (this.job && this.job.state === 'running') {
      this.cancelRequested = true
      const child = this.child
      if (child?.pid) {
        execFile(systemExecutable('taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
          if (error && this.child === child) {
            this.cancelRequested = false
            this.hooks.onLog('optimize', 'warn', 'Unable to stop the optimizer', error.message)
          }
        })
      }
    }
  }

  async run(request: DefragRequest): Promise<DefragJob> {
    if (this.job?.state === 'running') throw new Error('A disk operation is already running.')

    let command: DefragCommand
    try {
      command = this.preview(request)
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
      if (request.action === 'files') {
        const available = await Promise.all(request.files!.map(ensureFileExists))
        if (available.some((exists) => !exists)) throw new Error('One or more selected files are no longer available.')
      }
      if (this.cancelRequested) {
        job.state = 'cancelled'
        job.phase = 'Cancelled'
        job.finishedAt = nowIso()
      } else {
        await this.spawnDefrag(job, command)
      }
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
      dryRun: request.dryRun === true,
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
      const child = spawn(systemExecutable(command.executable), command.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      let collected = ''
      const pending = { stdout: '', stderr: '' }
      let spawnError: Error | undefined

      const consume = (stream: keyof typeof pending, text: string): void => {
        collected = (collected + text).slice(-128_000)
        const parts = (pending[stream] + text).split(/[\r\n]+/)
        pending[stream] = (parts.pop() ?? '').slice(-20_000)
        for (const line of parts) {
          const trimmed = line.trim()
          if (!trimmed) continue
          job.lines.push(trimmed)
          if (job.lines.length > 400) job.lines.splice(0, job.lines.length - 400)
        }
        const progressText = [...parts, pending[stream]].filter((line) => !line.includes('=')).join('\n')
        const parsed = parseDefragOutput(progressText)
        if (parsed.percent !== null && parsed.percent >= job.percent) job.percent = parsed.percent
        if (parsed.done && job.percent < 99) job.percent = 99
        if (progressText.trim()) job.phase = describePhase(progressText, job.action)
        this.emit()
      }

      child.stdout.setEncoding('utf8').on('data', (text: string) => consume('stdout', text))
      child.stderr.setEncoding('utf8').on('data', (text: string) => consume('stderr', text))

      child.on('error', (err) => {
        spawnError = err
      })

      child.on('close', (code) => {
        this.child = null
        if (spawnError) {
          reject(spawnError)
          return
        }
        for (const tail of Object.values(pending)) {
          if (tail.trim()) job.lines.push(tail.trim())
        }
        const parsed = parseDefragOutput(collected)

        if (this.cancelRequested) {
          job.state = 'cancelled'
          job.percent = Math.min(job.percent, 99)
          job.finishedAt = nowIso()
          job.phase = 'Cancelled'
          this.hooks.onLog('optimize', 'warn', `${ACTION_LABELS[job.action]} cancelled on ${job.volume}`)
          resolve()
          return
        }

        if (looksLikeElevationError(collected) && code !== 0) {
          job.state = 'needs-elevation'
          job.phase = 'Administrator rights required'
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
        if (code === 0) {
          const [firstReport, postReport] = collected.split(POST_REPORT, 2)
          const preReport = firstReport.split(PRE_REPORT, 2)[1]
          if (preReport) job.statsBefore = parseDefragOutput(preReport).stats
          if (parsed.stats && (preReport === undefined || postReport !== undefined)) job.statsAfter = parsed.stats
        }
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
      dryRun: job.dryRun,
      volume: job.volume,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? nowIso(),
      state: job.state,
      durationMs: Math.max(0, finished - new Date(job.startedAt).getTime()),
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
  const result = await run(systemExecutable(DEFRAG), ['/?'], 15_000)
  const text = result.stdout || result.stderr
  return { available: result.ok && text.trim().length > 0, text: text.slice(0, 4000) }
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
  const drive = normaliseVolume(volume)
  const accepted: string[] = []
  const rejected: string[] = []
  for (const file of files) {
    const root = path.win32.parse(file).root
    if (path.win32.isAbsolute(file) && root.slice(0, 2).toUpperCase() === drive &&
        !/[*?"<>|\x00-\x1f:]/.test(file.slice(root.length))) accepted.push(file)
    else rejected.push(file)
  }
  return { accepted, rejected }
}
