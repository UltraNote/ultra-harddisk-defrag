// Verifies window controls and the autostart toggle against the running app.
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const port = Number(process.argv[2] ?? 9333)
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}
const shot = async (file) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(s.data, 'base64')
  await fs.writeFile(file, buf)
  return buf.length
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const runPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const appId = 'work.selman.ultra-harddisk-defrag'
function runKey() {
  try {
    const output = execFileSync('reg', ['query', runPath, '/v', appId], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    })
    const match = output.match(/^\s*work\.selman\.ultra-harddisk-defrag\s+(REG_\w+)\s+(.*)$/m)
    if (match) return { type: match[1], value: match[2].trimEnd() }
  } catch {
    // The Run entry is absent.
  }
  return null
}

await sleep(500)
const shotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultra-defrag-window-'))

const sizeBefore = await evaluate('({ w: window.outerWidth, h: window.outerHeight })')
const workArea = await evaluate('({ w: screen.availWidth, h: screen.availHeight })')
await shot(path.join(shotDir, 'before.png'))
await evaluate('window.ultra.windowMaximize()')
await sleep(1300)
const sizeAfter = await evaluate('({ w: window.outerWidth, h: window.outerHeight })')
const after = await shot(path.join(shotDir, 'after.png'))
check(
  'maximize fills the work area',
  sizeAfter.w >= workArea.w - 8 && sizeAfter.h >= workArea.h - 8,
  `${sizeBefore.w}x${sizeBefore.h} → ${sizeAfter.w}x${sizeAfter.h} (work area ${workArea.w}x${workArea.h})`
)
check('the maximized window still renders', after > 100_000, `${after} byte capture`)
await evaluate('window.ultra.windowMaximize()')
await sleep(900)
const restored = await evaluate('({ w: window.outerWidth, h: window.outerHeight })')
check('maximizing again restores the window', restored.h <= sizeBefore.h + 4, `${restored.w}x${restored.h}`)

const titleText = await evaluate('document.querySelector(".titlebar .brand")?.innerText ?? ""')
check('title bar shows the product name', /Ultra Harddisk Defrag/.test(titleText), titleText.replace(/\s+/g, ' '))

const initialKey = runKey()
const initialSetting = (await evaluate('window.ultra.getSettings()')).general.autoStart
try {
  const on = await evaluate('window.ultra.saveSettings({ general: { autoStart: true } })')
  const enabledKey = runKey()
  check('autostart enables the setting', on.general.autoStart === true)
  check('autostart writes the app launch command to HKCU Run', /electron\.exe|Ultra Harddisk Defrag\.exe/i.test(enabledKey?.value ?? ''), enabledKey?.value ?? 'missing')

  await evaluate('window.ultra.saveSettings({ general: { autoStart: false } })')
  check('turning autostart off removes the HKCU Run value', runKey() === null)
  await evaluate('window.ultra.saveSettings({ general: { autoStart: true } })')
  const values = await evaluate('window.ultra.resetSettings()')
  check('reset restores the default autostart setting', values.general.autoStart === false)
  check('reset removes the HKCU Run value', runKey() === null)
} finally {
  try {
    await evaluate(`window.ultra.saveSettings({ general: { autoStart: ${initialSetting} } })`)
  } finally {
    if (initialKey) {
      execFileSync('reg', ['add', runPath, '/v', appId, '/t', initialKey.type, '/d', initialKey.value, '/f'], { stdio: 'ignore' })
    } else if (runKey()) {
      execFileSync('reg', ['delete', runPath, '/v', appId, '/f'], { stdio: 'ignore' })
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
console.log(`screenshots: ${shotDir}`)
ws.close()
process.exitCode = failed === 0 ? 0 : 1
