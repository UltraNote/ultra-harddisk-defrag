// Packages release/win-unpacked into a distributable ZIP (no NSIS, no signing).
//   node scripts/make-zip.mjs
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = process.cwd()
const sevenZip = path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
const source = path.join(root, 'release', 'win-unpacked')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const out = path.join(root, 'release', `UltraHarddiskDefrag-${pkg.version}-win-x64.zip`)

await fs.access(source).catch(() => {
  throw new Error('release/win-unpacked is missing — run `npm run pack` first')
})

await fs.rm(out, { force: true })
const { stdout } = await run(sevenZip, ['a', '-tzip', '-mx=5', out, path.join(source, '*')], { maxBuffer: 64 * 1024 * 1024 })
const tail = stdout.trim().split(/\r?\n/).slice(-3).join('\n')
const stat = await fs.stat(out)
console.log(tail)
console.log(`\n${out} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
