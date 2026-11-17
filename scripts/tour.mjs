// Screenshots every page of the running app: node scripts/tour.mjs [port] [outDirBase]
import { promises as fs } from 'node:fs'
import path from 'node:path'

const port = Number(process.argv[2] ?? 9333)
const base = process.argv[3] ?? path.join(process.env.LOCALAPPDATA ?? 'C:\\Temp', 'Temp', 'udefrag-tour')

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) throw new Error('no page target')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})

let id = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
    pending.delete(msg.id)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const messageId = ++id
    pending.set(messageId, resolve)
    ws.send(JSON.stringify({ id: messageId, method, params }))
  })

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return result?.result?.value
}

await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await fs.mkdir(base, { recursive: true })

const labels = await evaluate('[...document.querySelectorAll(".nav-item")].map(b => b.textContent.trim())')
const pages = labels.map((label) => label.replace(/\s*\d+$/, ''))

for (const [index, label] of pages.entries()) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); b && b.click(); return true })()`)
  await new Promise((r) => setTimeout(r, 900))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(base, `${String(index).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`)
  await fs.writeFile(file, Buffer.from(shot.data, 'base64'))
  console.log(file)
}

await send('Emulation.clearDeviceMetricsOverride')
ws.close()
