/**
 * CDP-driven IPC test for Ultra Harddisk Defrag.
 *
 *   npm run test:ipc            # against port 9333 (dev build)
 *   node scripts/ipc-test.mjs 9334
 *
 * Drives the renderer's window.ultra bridge over the DevTools protocol, exactly
 * like the real UI, and asserts on the values that come back from the main process.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const port = Number(process.argv[2] ?? 9333)
const target = `http://127.0.0.1:${port}/json/list`

let passed = 0
let failed = 0
let skipped = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function skip(name, reason) {
  skipped++
  console.log(`  SKIP  ${name} — ${reason}`)
}

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(target)
      const pages = await response.json()
      const page = pages.find((entry) => entry.type === 'page' && /index\.html|localhost/.test(entry.url))
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`no renderer page on ${target}`)
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      }
    })
  }

  async ready() {
    if (this.ws.readyState === 1) return
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true })
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluation failed')
    }
    return result.result.value
  }
}

async function main() {
  console.log(`Ultra Harddisk Defrag — IPC test (port ${port})\n`)
  const page = await findPage()
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.ready()
  await cdp.send('Runtime.enable')

  const bridge = await cdp.eval('typeof window.ultra')
  check('preload bridge is exposed', bridge === 'object', bridge)

  if (bridge !== 'object') {
    console.log('\nthe renderer has no window.ultra — nothing else can be tested')
    cdp.ws.close()
    process.exitCode = 1
    return
  }

  const methods = await cdp.eval('Object.keys(window.ultra).sort()')
  const required = [
    'getStatus', 'refreshVolumes', 'getSettings', 'saveSettings', 'resetSettings',
    'analyze', 'startJob', 'startJobs', 'cancelJob', 'cancelPowerAction', 'getJob', 'getHistory', 'previewCommand',
    'getHealth', 'getLibraries', 'addLibrary', 'removeLibrary', 'scanLargeFiles', 'defragFiles',
    'getActionCenter', 'fixAll', 'getLogs', 'clearLogs',
    'relaunchElevated', 'pickFiles', 'openPath', 'showInFolder',
    'windowMinimize', 'windowMaximize', 'windowClose',
    'onJobProgress', 'onStatus', 'onNotification', 'onNavigate'
  ]
  const missing = required.filter((name) => !methods.includes(name))
  check(`all ${required.length} API methods are exposed`, missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${methods.length} keys`)

  const status = await cdp.eval('window.ultra.getStatus()')
  check('status returns the app version', status.appVersion === '1.0.0', status.appVersion)
  check('volumes are enumerated', Array.isArray(status.volumes) && status.volumes.length > 0, `${status.volumes.length} volume(s)`)
  check('volumes carry size and free space', status.volumes.every((v) => typeof v.sizeBytes === 'number' && typeof v.freeBytes === 'number'))
  check('a system volume is flagged', status.volumes.some((v) => v.isSystem), status.volumes.find((v) => v.isSystem)?.letter ?? 'none')
  check('media type is reported per volume', status.volumes.every((v) => ['SSD', 'HDD', 'Unspecified', 'Unknown'].includes(v.mediaType)),
    status.volumes.map((v) => `${v.letter}:${v.mediaType}`).join(' '))
  check('defrag.exe availability is reported', typeof status.engineAvailable === 'boolean', String(status.engineAvailable))
  check('elevation state is reported', typeof status.elevated === 'boolean', status.elevated ? 'administrator' : 'standard user')
  check('host and OS are filled in', !!status.host && !!status.os, `${status.host} / ${status.os}`)
  check('issues are computed', Array.isArray(status.issues), `${status.issues.length} issue(s)`)
  if (!status.elevated) {
    check('unelevated sessions report the elevation issue', status.issues.some((i) => i.id === 'not-elevated'))
  } else {
    skip('unelevated elevation issue', 'the app is running as Administrator')
  }
  check('stats block is present', typeof status.stats.optimizations === 'number' && typeof status.stats.analyzedVolumes === 'number')

  const settings = await cdp.eval('window.ultra.getSettings()')
  check('settings load with defaults', settings.autoDefrag.enabled === true && settings.defrag.batteryGuard === true, `autoDefrag=${settings.autoDefrag.enabled}`)
  check('scheduler defaults are sane', settings.scheduled.cadence === 'weekly' && settings.scheduled.hour === 3)
  check('after-task power action defaults to none', settings.afterTask.action === 'none')

  const saved = await cdp.eval('window.ultra.saveSettings({ autoDefrag: { thresholdPercent: 7 } })')
  check('settings save round-trips in memory', saved.autoDefrag.thresholdPercent === 7)
  const reread = await cdp.eval('window.ultra.getSettings()')
  check('settings preserve sibling values after a partial patch', reread.autoDefrag.idleMinutes === settings.autoDefrag.idleMinutes)
  await cdp.eval('window.ultra.saveSettings({ autoDefrag: { thresholdPercent: 5 } })')

  const target = status.volumes.find((volume) => volume.isSystem)
  const drive = JSON.stringify(target.letter)
  const ssd = target.mediaType === 'SSD'
  const hdd = target.mediaType === 'HDD'
  const expectedCommands = {
    analyze: ['/A', '/V'],
    optimize: ssd ? ['/L', '/U'] : ['/O', '/U', '/V'],
    quick: ssd ? ['/L', '/U'] : ['/O', '/U'],
    retrim: ['/L', '/U'],
    slab: ['/K', '/U'],
    traditional: hdd ? ['/D', '/U', '/V'] : null,
    freeSpace: hdd ? ['/X', '/U', '/V'] : null,
    bootOptimize: hdd ? ['/B'] : null
  }
  for (const [action, args] of Object.entries(expectedCommands)) {
    const command = await cdp.eval(`window.ultra.previewCommand({ action: '${action}', volume: ${drive} }).catch(() => null)`)
    if (args) {
      check(`preview ${action} matches the detected media`, JSON.stringify(command?.args) === JSON.stringify([target.letter + ':', ...args]), command?.display)
    } else {
      check(`preview ${action} requires an HDD`, command === null, target.mediaType)
    }
  }

  let rejected = false
  try {
    await cdp.eval("window.ultra.previewCommand({ action: 'analyze', volume: 'nonsense' })")
  } catch {
    rejected = true
  }
  check('invalid volumes are rejected before execution', rejected)

  await cdp.eval("window.ultra.saveSettings({ afterTask: { action: 'shutdown', delaySeconds: 600 } })")
  const beforeDryRuns = await cdp.eval('window.ultra.getStatus()')
  const dry = await cdp.eval("window.ultra.startJob({ action: 'analyze', volume: 'C:', dryRun: true })")
  check('dry run completes without executing', dry.state === 'completed' && dry.percent === 100, dry.command)
  check('dry run records the exact command', /defrag\.exe C: \/A/.test(dry.command), dry.command)

  const gated = await cdp.eval("window.ultra.analyze('C:')")
  if (status.elevated) {
    check('elevated analyze ran through defrag.exe', gated.state === 'completed', `${gated.state}${gated.error ? `: ${gated.error}` : ''}`)
  } else {
    check('unelevated analyze stops at the elevation gate', gated.state === 'needs-elevation', gated.elevationHint?.slice(0, 50) ?? '')
  }

  const progressEvents = await cdp.eval(`(() => {
    window.__jobEvents = 0
    const off = window.ultra.onJobProgress(() => { window.__jobEvents++ })
    return new Promise((resolve) => setTimeout(async () => {
      await window.ultra.startJob({ action: 'optimize', volume: 'C:', dryRun: true })
      setTimeout(() => { off(); resolve(window.__jobEvents) }, 300)
    }, 100))
  })()`)
  check('job progress events reach the renderer', progressEvents >= 1, `${progressEvents} event(s)`)

  const afterDryRuns = await cdp.eval('window.ultra.getStatus()')
  check('dry optimization does not increase successful optimization count', afterDryRuns.stats.optimizations === beforeDryRuns.stats.optimizations)
  check('dry optimization leaves the volume record unchanged', afterDryRuns.volumes.find((v) => v.isSystem).lastOptimizedAt === beforeDryRuns.volumes.find((v) => v.isSystem).lastOptimizedAt)
  check('dry runs and analysis do not arm the configured shutdown', afterDryRuns.pendingPowerAction === null)
  check('power cancellation is a no-op without a pending action', await cdp.eval('window.ultra.cancelPowerAction()') === false)
  const batch = await cdp.eval("window.ultra.startJobs([{ action: 'analyze', volume: 'C:', dryRun: true }, { action: 'optimize', volume: 'C:', dryRun: true }])")
  check('batch runs in request order with distinct job IDs', batch[0].action === 'analyze' && batch[1].action === 'optimize' && batch[0].id !== batch[1].id)
  await cdp.eval("window.ultra.saveSettings({ afterTask: { action: 'none' } })")
  const history = await cdp.eval('window.ultra.getHistory()')
  check('history records every terminal job', Array.isArray(history) && history.length >= 3, `${history.length} entries`)
  check('history marks dry runs', history.some((entry) => entry.dryRun === true && entry.state === 'completed'))
  check('history entries carry durations', history.every((entry) => typeof entry.durationMs === 'number' && entry.durationMs >= 0))
  check('history entries carry states', history.every((entry) => typeof entry.state === 'string' && entry.state.length > 0), [...new Set(history.map((h) => h.state))].join(','))

  const health = await cdp.eval('window.ultra.getHealth()')
  check('physical disks are enumerated', health.physicalDisks.length > 0, `${health.physicalDisks.length} disk(s)`)
  check('disk media types are valid', health.physicalDisks.every((disk) => ['SSD', 'HDD', 'Unspecified', 'Unknown'].includes(disk.mediaType)),
    health.physicalDisks.map((d) => `${d.name}:${d.mediaType}`).join(' | ').slice(0, 120))
  check('disk health strings are reported', health.physicalDisks.every((disk) => typeof disk.health === 'string'))
  check('TRIM state is a boolean or explicitly unknown', health.trimEnabled === true || health.trimEnabled === false || health.trimEnabled === null, String(health.trimEnabled))
  check('SMART availability is stated, not guessed', typeof health.smartSource === 'string' && health.smartSource.length > 0, health.smartSource.slice(0, 80))

  const libraries = await cdp.eval('window.ultra.getLibraries()')
  check('library detection returns a list', Array.isArray(libraries), `${libraries.length} library(ies)`)
  check('libraries carry a provider', libraries.every((library) => ['Steam', 'Epic', 'Manual'].includes(library.provider)))

  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ultra-defrag-ipc-'))
  try {
    const bigPath = path.join(fixture, 'large test.bin')
    await fs.writeFile(bigPath, Buffer.alloc(2 * 1024 ** 2))
    const scan = await cdp.eval(`window.ultra.scanLargeFiles({ root: ${JSON.stringify(fixture)}, minSizeMb: 1, limit: 5 })`)
    check('large-file scan returns the file in the selected folder', scan.length === 1 && scan[0].path.toLowerCase() === bigPath.toLowerCase())
    const manual = await cdp.eval(`window.ultra.addLibrary(${JSON.stringify(fixture)})`)
    check('manual libraries can be added', manual.includes(fixture))
    const removed = await cdp.eval(`window.ultra.removeLibrary(${JSON.stringify(fixture)})`)
    check('manual libraries can be removed', !removed.includes(fixture))
  } finally {
    await fs.rm(fixture, { recursive: true, force: true })
  }

  const filesJob = await cdp.eval(`window.ultra.defragFiles('C:', [], true)`)
  check('targeted defrag refuses an empty file list', filesJob.state === 'failed' && !!filesJob.error, filesJob.error?.slice(0, 60) ?? '')

  const issues = await cdp.eval('window.ultra.getActionCenter()')
  check('action center returns structured issues', Array.isArray(issues) && issues.every((issue) => issue.id && issue.severity && issue.title))

  if (!status.elevated) {
    const fixed = await cdp.eval('window.ultra.fixAll()')
    check('fix all reports what it addressed', typeof fixed.fixed === 'number' && typeof fixed.issues === 'number', `${fixed.fixed}/${fixed.issues}`)
  } else {
    skip('fix all', 'would write to production volumes in an Administrator session')
  }

  const logs = await cdp.eval('window.ultra.getLogs()')
  check('operations are logged', Array.isArray(logs) && logs.length > 0, `${logs.length} entries`)
  check('log entries have channels and levels', logs.every((entry) => entry.channel && ['info', 'warn', 'error'].includes(entry.level)))

  const optimizeLogs = await cdp.eval("window.ultra.getLogs('optimize')")
  check('logs filter by channel', optimizeLogs.every((entry) => entry.channel === 'optimize'), `${optimizeLogs.length} optimize entries`)

  await cdp.eval('window.ultra.clearLogs()')
  const cleared = await cdp.eval('window.ultra.getLogs()')
  check('logs can be cleared', cleared.length === 0)

  const reset = await cdp.eval('window.ultra.resetSettings()')
  check('settings can be reset to defaults', reset.autoDefrag.thresholdPercent === 5 && reset.afterTask.action === 'none')

  const shellState = await cdp.eval('({ title: document.title, hasSidebar: !!document.querySelector(".sidebar"), navCount: document.querySelectorAll(".nav-item").length })')
  check('the window renders the app shell', shellState.title.includes('Ultra Harddisk Defrag'), shellState.title)
  check('navigation is rendered', shellState.navCount >= 9, `${shellState.navCount} items`)

  const pages = ['Disk overview', 'Defrag', 'Large files', 'Disk health', 'Schedule & automation', 'Game & App Boost', 'Action Center', 'Logs', 'Settings']
  for (const [index, heading] of pages.entries()) {
    const rendered = await cdp.eval(`(async () => {
      document.querySelectorAll('.nav-item')[${index}].click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return document.querySelector('main h1')?.textContent
    })()`)
    check(`navigation opens ${heading}`, rendered?.toLowerCase() === heading.toLowerCase(), rendered)
  }
  const commandSelection = await cdp.eval(`(async () => {
    const before = (await window.ultra.getHistory()).length
    document.querySelectorAll('.nav-item')[1].click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const analyze = [...document.querySelectorAll('.action-btn')].find((button) => button.querySelector('strong')?.textContent === 'Analyze')
    analyze.click()
    for (let i = 0; i < 20 && !document.querySelector('.cmd-block code')?.textContent.includes('/A'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const preview = document.querySelector('.cmd-block code')?.textContent
    return { preview, unchanged: (await window.ultra.getHistory()).length === before }
  })()`)
  check('selecting an operation previews its command without running it', commandSelection.unchanged && /defrag\.exe .+ \/A \/V$/.test(commandSelection.preview), commandSelection.preview)
  const volumesAfter = await cdp.eval('window.ultra.refreshVolumes()')
  check('volumes can be refreshed on demand', Array.isArray(volumesAfter.volumes) && volumesAfter.volumes.length > 0)

  skip('relaunchElevated', 'would prompt a UAC dialog on the test machine')
  skip('pickFiles', 'opens a native file dialog')

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`)
  if (failed) console.log(`failures: ${failures.join(', ')}`)
  cdp.ws.close()
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((err) => {
  console.error('ipc test crashed:', err)
  process.exit(2)
})
