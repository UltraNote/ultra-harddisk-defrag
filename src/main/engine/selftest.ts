/**
 * Engine self-test — no Electron, no elevation, no disk writes beyond a temp folder.
 *
 *   npm run selftest
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPaths, ensureDirs } from './runtime'
import { Store } from './store'
import {
  buildCommand,
  engineInfo,
  filesOnVolume,
  looksLikeElevationError,
  normaliseVolume,
  parseDefragOutput,
  DefragRunner
} from './defrag'
import { diskHealth, listVolumes, trimState } from './volumes'
import { scanLargeFiles } from './libraries'
import type { DefragJob } from '../../shared/types'

let passed = 0
let failed = 0
let skipped = 0
const lines: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++
    lines.push(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    lines.push(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function skip(name: string, reason: string): void {
  skipped++
  lines.push(`  SKIP  ${name} — ${reason}`)
}

const SAMPLE_ANALYSIS = `
Windows Disk Defragmenter
Copyright (c) 2006 Microsoft Corp.

Analyzing C: ...
Analysis complete.

     Volume Information:
            Volume size                         = 465 GB
            Cluster size                        = 4 KB
            Used space                          = 310 GB
            Free space                          = 154 GB
            Percent free space                  = 33 %

     Fragmentation level:
            Total fragmented space              = 6%
            Average fragments per file          = 1.12
            Total fragmented files              = 1,234
            Total excess fragments              = 5,678
            Total folders                       = 90,000
            Average fragments per folder        = 1.02
            Total scattered files               = 12
`

const SAMPLE_PROGRESS = `
Defragmentation of C: started
  0% .......... 10% .......... 25% .......... 62% .......... 99%
Operation completed successfully.
`

async function main(): Promise<void> {
  const root = path.join(os.tmpdir(), `ultra-defrag-selftest-${Date.now()}`)
  console.log(`Ultra Harddisk Defrag 1.0 — engine self-test\nwork dir: ${root}\n`)
  const paths = createPaths(path.join(root, 'appdata'))
  await ensureDirs(paths)

  // ---- command construction ---------------------------------------------
  const expected: Array<[Parameters<typeof buildCommand>[0]['action'], string[]]> = [
    ['analyze', ['C:', '/A', '/V']],
    ['optimize', ['C:', '/O', '/U', '/V']],
    ['traditional', ['C:', '/D', '/U', '/V']],
    ['quick', ['C:', '/O', '/U']],
    ['freeSpace', ['C:', '/X', '/U', '/V']],
    ['retrim', ['C:', '/L', '/U']],
    ['slab', ['C:', '/K', '/U']],
    ['bootOptimize', ['C:', '/B']]
  ]
  let commandsOk = true
  const commandReport: string[] = []
  for (const [action, args] of expected) {
    const command = buildCommand({ action, volume: 'c:\\' })
    const match = JSON.stringify(command.args) === JSON.stringify(args)
    if (!match) commandsOk = false
    commandReport.push(`${action}:${match ? 'ok' : `got ${command.args.join(' ')}`}`)
  }
  check('every action builds the documented defrag.exe command line', commandsOk, commandReport.join(', '))

  const fileCommand = buildCommand({ action: 'files', volume: 'D:', files: ['D:\\Games\\big.bin', 'D:\\VMs\\disk.vhdx'] })
  check(
    'targeted defrag uses /File with the selected paths',
    fileCommand.args.includes('/File') && fileCommand.args.includes('D:\\Games\\big.bin'),
    fileCommand.display
  )

  let rejectedBadVolume = false
  try {
    buildCommand({ action: 'analyze', volume: 'not-a-volume' })
  } catch {
    rejectedBadVolume = true
  }
  check('invalid volume identifiers are rejected', rejectedBadVolume)
  check('volume normalisation folds case and trailing slash', normaliseVolume('d:\\') === 'D:')
  check('bare drive letters are accepted', normaliseVolume('c') === 'C:' && normaliseVolume('E') === 'E:')
  check('targeted defrag refuses an empty file list', (() => {
    try {
      buildCommand({ action: 'files', volume: 'C:', files: [] })
      return false
    } catch {
      return true
    }
  })())
  check('SSD optimization selects retrim', buildCommand({ action: 'optimize', volume: 'C:' }, 'SSD').args.join(' ') === 'C: /L /U')
  check('unknown media delegates to Windows', buildCommand({ action: 'optimize', volume: 'C:' }, 'Unknown').args.includes('/O'))
  check('explicit data-moving operations require a detected HDD', (['traditional', 'freeSpace', 'bootOptimize', 'files'] as const).every((action) => {
    try {
      buildCommand({ action, volume: 'C:', files: ['C:\\file.bin'] }, 'SSD')
      return false
    } catch (error) {
      return error instanceof Error && error.message.includes('HDD')
    }
  }))

  // ---- output parsing ----------------------------------------------------
  const parsed = parseDefragOutput(SAMPLE_ANALYSIS)
  check('analysis statistics parse', parsed.stats?.totalFragmentedSpacePercent === 6 && parsed.stats?.fragmentedFiles === 1234,
    `${parsed.stats?.totalFragmentedSpacePercent}% / ${parsed.stats?.fragmentedFiles} files / ${parsed.stats?.excessFragments} excess`)
  check('free space percentage parses', parsed.stats?.freeSpacePercent === 33)
  check('analysis completion is detected', parsed.done === true)
  check('optimization stats use the post-operation report', parseDefragOutput(
    'Pre-Optimization Report:\r\nTotal fragmented space = 9%\r\nPost-Optimization Report:\r\nTotal fragmented space = 2%'
  ).stats?.totalFragmentedSpacePercent === 2)

  const progress = parseDefragOutput(SAMPLE_PROGRESS)
  check('progress percentage is the highest value seen', progress.percent === 99, `${progress.percent}%`)
  check('completion line is recognised', progress.done === true)

  const elevation = parseDefragOutput('The storage optimizer cannot start because you have insufficient privileges to perform this operation. (0x89000024)')
  check('elevation failure text is recognised', looksLikeElevationError('insufficient privileges (0x89000024)') === true && elevation.done === false)

  const crossVolume = filesOnVolume(['C:\\a.bin', 'D:\\b.bin'], 'C:')
  check('targeted files are filtered by volume', crossVolume.accepted.length === 1 && crossVolume.rejected.length === 1)
  check('targeted file selection rejects wildcard, relative and alternate-stream paths',
    filesOnVolume(['C:\\*.bin', 'C:relative.bin', 'C:\\file.bin:stream', '/FileList'], 'C:').accepted.length === 0)

  // ---- live volume / health probing -------------------------------------
  const volumes = await listVolumes()
  check('volumes enumerate from the storage cmdlets', volumes.length > 0, volumes.map((v) => `${v.letter ?? '?'} ${Math.round(v.sizeBytes / 1e9)}GB ${v.mediaType}`).join(', '))
  const systemVolume = volumes.find((v) => v.isSystem)
  check('the system volume is identified', !!systemVolume, systemVolume?.letter ?? 'none')
  check('volume sizes and free space are numbers', volumes.every((v) => v.sizeBytes >= v.freeBytes && v.freeBytes >= 0))

  const trim = await trimState()
  if (trim.enabled === null) skip('TRIM state query', 'fsutil returned no NTFS DisableDeleteNotify line')
  else check('TRIM state is readable unelevated', typeof trim.enabled === 'boolean', `DisableDeleteNotify=${trim.value} → ${trim.enabled ? 'enabled' : 'disabled'}`)

  const health = await diskHealth(volumes)
  check('physical disks are enumerated with media type', health.physicalDisks.length > 0,
    health.physicalDisks.map((d) => `${d.name} (${d.mediaType})`).join(', '))
  check('SMART source is reported honestly', typeof health.smartSource === 'string' && health.smartSource.length > 0, health.smartSource)

  const engine = await engineInfo()
  check('defrag.exe is callable and prints its usage', engine.available === true, `${engine.text.split(/\r?\n/)[0] ?? ''}`.trim())

  // ---- large-file scan ---------------------------------------------------
  const bigDir = path.join(root, 'bigfiles')
  await fs.mkdir(path.join(bigDir, 'nested'), { recursive: true })
  await fs.writeFile(path.join(bigDir, 'small.bin'), Buffer.alloc(1024))
  const bigPath = path.join(bigDir, 'nested', 'big.bin')
  const handle = await fs.open(bigPath, 'w')
  await handle.truncate(64 * 1024 * 1024)
  await handle.close()
  const bigScan = await scanLargeFiles({ root: bigDir, minSizeMb: 32, limit: 10, budgetMs: 20_000 })
  const foundBig = bigScan.files.some((f) => f.path.toLowerCase() === bigPath.toLowerCase())
  check('large-file scan finds a file above the threshold', foundBig, `${bigScan.files.length} candidate(s), scanned ${bigScan.scannedFiles}`)
  check('large-file scan reports an expired budget', (await scanLargeFiles({ root: bigDir, minSizeMb: 1, limit: 10, budgetMs: 0 })).truncated)

  // ---- runner: dry run and elevation gate --------------------------------
  const jobs: DefragJob[] = []
  const finished: string[] = []
  const runner = new DefragRunner({
    elevated: false,
    onProgress: (job) => jobs.push(job),
    onLog: () => undefined,
    onFinished: (job) => finished.push(`${job.action}:${job.state}`)
  })

  const dry = await runner.run({ action: 'analyze', volume: 'C:', dryRun: true })
  check('dry run completes without touching the disk', dry.state === 'completed' && /\/A/.test(dry.command), dry.command)

  const gated = await runner.run({ action: 'optimize', volume: 'C:' })
  check('unelevated optimize is refused before any process starts', gated.state === 'needs-elevation', gated.elevationHint?.slice(0, 60) ?? '')
  check('history is emitted for every job', finished.length === 2, finished.join(', '))

  const preview = runner.preview({ action: 'freeSpace', volume: 'c:' })
  check('preview returns a copyable command', preview.display.startsWith('defrag.exe C: /X'), preview.display)

  // ---- store -------------------------------------------------------------
  const store = new Store(paths)
  await store.init()
  check('settings defaults', store.settings().autoDefrag.enabled === true && store.settings().defrag.batteryGuard === true)
  const saved = await store.updateSettings({ autoDefrag: { thresholdPercent: 3 }, afterTask: { action: 'sleep' } })
  const store2 = new Store(paths)
  await store2.init()
  check('settings persist across instances', saved.autoDefrag.thresholdPercent === 3 && store2.settings().afterTask.action === 'sleep')

  store.addLog('optimize', 'info', 'self-test entry')
  check('logs are recorded', store.getLogs('optimize').length >= 1)

  await store.addHistory({
    id: 'h1',
    action: 'optimize',
    volume: 'C:',
    startedAt: new Date(Date.now() - 1000).toISOString(),
    finishedAt: new Date().toISOString(),
    state: 'completed',
    durationMs: 1000,
    fragmentedPercentBefore: 6,
    fragmentedPercentAfter: 1,
    exitCode: 0
  })
  check('history and counters update', store.historyEntries().length === 1 && store.stats().optimizations === 1)
  const successful = store.historyEntries()[0]
  await store.addHistory({ ...successful, id: 'h2', dryRun: true, exitCode: null })
  await store.addHistory({ ...successful, id: 'h3', action: 'analyze', state: 'failed' })
  await store.addHistory({ ...successful, id: 'h4', action: 'analyze' })
  check('only completed real operations count in their respective categories', store.stats().optimizations === 1 && store.stats().analyzedVolumes === 1)

  store.recordVolume('C:', 'optimize', 1)
  check('per-volume memory is recorded', store.volumeState().C?.lastAction === 'optimize')
  const firstSave = store.updateSettings({ autoDefrag: { thresholdPercent: 15 } })
  const secondSave = store.updateSettings({ scheduled: { hour: 7 } })
  await Promise.all([firstSave, secondSave])
  store.addLog('app', 'info', 'Clear this log entry')
  await store.clearLogs()
  store.markAutomationRun({ scheduledDay: '2026-11-26', autoAt: 123456789 })
  await store.flush()
  const reopened = new Store(paths)
  await reopened.init()
  check('rapid settings saves preserve both changes on disk', reopened.settings().scheduled.hour === 7 && reopened.settings().autoDefrag.thresholdPercent === 15)
  check('log clearing cannot be overwritten by an earlier log write', reopened.getLogs().length === 0)
  check('automation run tracking survives restarts', reopened.automationState().scheduledDay === '2026-11-26' && reopened.automationState().autoAt === 123456789)

  console.log(lines.join('\n'))
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`)
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
  process.exit(failed === 0 ? 0 : 1)
}

void main().catch((err) => {
  console.error('self-test crashed:', err)
  process.exit(2)
})
