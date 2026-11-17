// Applies the product icon and version metadata to the packaged executable with
// rcedit (already present in the electron-builder tool cache). electron-builder's
// own signAndEditExecutable step is disabled because extracting winCodeSign needs
// symlink privileges this shell does not have.
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = process.cwd()
const exe = path.join(root, 'release', 'win-unpacked', 'Ultra Harddisk Defrag.exe')
const ico = path.join(root, 'build', 'icon.ico')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))

await fs.access(exe).catch(() => {
  throw new Error(`packaged exe not found at ${exe} — run \`npm run pack\` first`)
})
await fs.access(ico).catch(() => {
  throw new Error(`icon not found at ${ico} — run \`npm run icon\` first`)
})

async function findRcedit() {
  const cache = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign')
  const entries = await fs.readdir(cache).catch(() => [])
  for (const entry of entries) {
    const candidate = path.join(cache, entry, 'rcedit-x64.exe')
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error('rcedit-x64.exe not found in the electron-builder cache — run electron-builder once with network access')
}

const rcedit = await findRcedit()
const args = [
  exe,
  '--set-icon', ico,
  '--set-file-version', `${pkg.version}.0`,
  '--set-product-version', pkg.version,
  '--set-version-string', 'ProductName', 'Ultra Harddisk Defrag',
  '--set-version-string', 'FileDescription', 'Ultra Harddisk Defrag 1.0 — anti-malware suite',
  '--set-version-string', 'CompanyName', 'UltraNote',
  '--set-version-string', 'LegalCopyright', 'MIT — indicators keep their own licences (docs/THREAT-FEED.md)'
]
await run(rcedit, args, { maxBuffer: 8 * 1024 * 1024 })
console.log(`patched ${path.basename(exe)} with icon + version metadata (rcedit: ${path.basename(path.dirname(rcedit))})`)
