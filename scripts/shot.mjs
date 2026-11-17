// Captures the running Electron window over CDP into a PNG.
//   node scripts/shot.mjs out.png [debugPort]
import { promises as fs } from 'node:fs'

const out = process.argv[2] ?? 'screenshot.png'
const port = Number(process.argv[3] ?? 9333)

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

await send('Runtime.enable')
// Give the animation one frame to settle.
await new Promise((r) => setTimeout(r, 900))
const shot = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(out, Buffer.from(shot.data, 'base64'))
console.log(`wrote ${out}`)
ws.close()
process.exit(0)
