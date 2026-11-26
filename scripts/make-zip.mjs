// Packages release/win-unpacked into a distributable ZIP (no NSIS, no signing).
//   node scripts/make-zip.mjs
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = process.cwd()
const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const source = path.join(root, 'release', 'win-unpacked')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const out = path.join(root, 'release', `UltraHarddiskDefrag-${pkg.version}-win-x64.zip`)

await fs.access(source).catch(() => {
  throw new Error('release/win-unpacked is missing — run `npm run pack` first')
})

const temp = out.replace(/\.zip$/, `.${process.pid}.tmp.zip`)
try {
  await run(tar, ['-a', '-cf', temp, '-C', source, '.'])
  await fs.rename(temp, out)
} finally {
  await fs.rm(temp, { force: true })
}
const stat = await fs.stat(out)
console.log(`\n${out} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
