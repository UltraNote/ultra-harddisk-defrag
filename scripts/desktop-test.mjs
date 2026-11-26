import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const executable = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('node_modules/electron/dist/electron.exe')
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ultra-defrag-desktop-'))
const listener = createServer().listen(0, '127.0.0.1')
await once(listener, 'listening')
const port = listener.address().port
await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))

const app = spawn(executable, [
  ...(process.argv[2] ? [] : [process.cwd()]),
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--enable-logging'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
const stopped = new Promise((resolve) => {
  app.once('error', resolve)
  app.once('close', resolve)
})
let appLog = ''
app.stderr?.setEncoding('utf8').on('data', (data) => { appLog = (appLog + data).slice(-4000) })

try {
  for (const suite of ['ipc-test.mjs', 'window-test.mjs']) {
    try {
      const { stdout, stderr } = await run(process.execPath, [path.join('scripts', suite), String(port)], { timeout: 90_000 })
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    } catch (error) {
      if (error.stdout) process.stdout.write(error.stdout)
      if (error.stderr) process.stderr.write(error.stderr)
      throw error
    }
  }
} catch (error) {
  console.error(error.message)
  if (appLog) console.error(appLog)
  process.exitCode = 1
} finally {
  app.kill()
  await stopped
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
