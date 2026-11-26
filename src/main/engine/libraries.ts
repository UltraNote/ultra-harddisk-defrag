import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { LargeFileEntry, LibraryEntry, MediaType, VolumeInfo } from '../../shared/types'
import { normaliseVolume } from './defrag'
import { run, systemExecutable } from './shell'

const SKIP_DIRS = new Set([
  'windows', 'winsxs', 'servicing', 'system volume information', '$recycle.bin', 'recovery',
  'node_modules', '.git', 'drivers', 'driverstore', 'assembly'
])

interface SteamLibrary {
  path: string
}

function steamRoots(): string[] {
  const roots = new Set<string>()
  for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files']) {
    if (base) roots.add(path.join(base, 'Steam'))
  }
  return [...roots]
}

/** Valve keeps library paths in libraryfolders.vdf as `"path"  "D:\\SteamLibrary"` lines. */
async function readSteamLibraries(): Promise<SteamLibrary[]> {
  const libraries: SteamLibrary[] = []
  const seen = new Set<string>()

  const registry = await run(systemExecutable('reg.exe'), ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], 3000)
  const regPath = registry.stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)?.[1]?.trim()
  const roots = [...(regPath ? [regPath.replace(/\//g, '\\')] : []), ...steamRoots()]

  for (const root of roots) {
    for (const file of [path.join(root, 'steamapps', 'libraryfolders.vdf'), path.join(root, 'config', 'libraryfolders.vdf')]) {
      try {
        const text = await fs.readFile(file, 'utf8')
        for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
          const value = match[1].replace(/\\\\/g, '\\')
          if (!seen.has(value.toLowerCase()) && existsSync(value)) {
            seen.add(value.toLowerCase())
            libraries.push({ path: value })
          }
        }
      } catch {
        /* no library file here */
      }
    }
  }
  return libraries
}

interface EpicManifest {
  DisplayName?: string
  InstallLocation?: string
  AppName?: string
}

async function readEpicLibraries(): Promise<Array<{ name: string; path: string }>> {
  const manifests = path.join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
  const found: Array<{ name: string; path: string }> = []
  try {
    const files = await fs.readdir(manifests)
    for (const file of files.filter((name) => name.endsWith('.item'))) {
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(manifests, file), 'utf8')) as EpicManifest
        if (manifest.InstallLocation && existsSync(manifest.InstallLocation)) {
          found.push({ name: manifest.DisplayName ?? manifest.AppName ?? file, path: manifest.InstallLocation })
        }
      } catch {
        /* malformed manifest */
      }
    }
  } catch {
    /* launcher not installed */
  }
  return found
}

async function directorySize(target: string, deadline: number): Promise<number> {
  let total = 0
  const stack = [target]
  while (stack.length) {
    if (Date.now() > deadline) break
    const dir = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (Date.now() >= deadline) return total
      const full = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name.toLowerCase())) stack.push(full)
        } else if (entry.isFile()) {
          total += (await fs.stat(full)).size
        }
      } catch {
        /* unreadable entry */
      }
    }
  }
  return total
}

export async function detectLibraries(volumes: VolumeInfo[], manual: string[], budgetMs = 8000): Promise<LibraryEntry[]> {
  const deadline = Date.now() + budgetMs
  const byLetter = new Map(volumes.filter((v) => v.letter).map((v) => [v.letter!.toUpperCase(), v]))
  const results: LibraryEntry[] = []

  const push = async (name: string, provider: LibraryEntry['provider'], target: string): Promise<void> => {
    const letter = path.parse(target).root.slice(0, 1).toUpperCase() || null
    const volume = letter ? byLetter.get(letter) : undefined
    const media: MediaType = volume?.mediaType ?? 'Unspecified'
    results.push({
      id: `${provider}:${target}`.toLowerCase(),
      name,
      provider,
      path: target,
      volumeLetter: volume?.letter ?? null,
      sizeBytes: await directorySize(target, deadline),
      mediaType: media,
      onSsd: media === 'SSD'
    })
  }

  for (const library of await readSteamLibraries()) {
    if (Date.now() > deadline) break
    await push(`Steam library ${library.path}`, 'Steam', library.path)
  }
  for (const library of await readEpicLibraries()) {
    if (Date.now() > deadline) break
    await push(library.name, 'Epic', library.path)
  }
  for (const target of manual) {
    if (Date.now() > deadline) break
    if (existsSync(target)) await push(path.basename(target), 'Manual', target)
  }
  return results
}

/**
 * Finds the largest files on a volume. Bounded by a time budget so the UI never
 * hangs on an 8 TB disk; the log records when the walk was cut short.
 */
export interface LargeFileOptions {
  volume?: string
  /** Scan a specific folder instead of a whole volume. */
  root?: string
  minSizeMb: number
  limit: number
  budgetMs?: number
}

export async function scanLargeFiles(
  options: LargeFileOptions
): Promise<{ files: LargeFileEntry[]; truncated: boolean; scannedFiles: number }> {
  const { minSizeMb, limit } = options
  if (!Number.isFinite(minSizeMb) || !Number.isInteger(limit) || limit < 1 || limit > 2000) {
    throw new Error('Choose a valid size and a result limit between 1 and 2,000.')
  }
  const budgetMs = options.budgetMs ?? 25_000
  const drive = options.root ? null : normaliseVolume(options.volume ?? process.env.SystemDrive ?? 'C:')
  const root = options.root ?? `${drive!.replace(/\\$/, '')}\\`
  if (!path.isAbsolute(root)) throw new Error('Choose an absolute folder path.')
  const threshold = Math.max(1, minSizeMb) * 1024 * 1024
  const deadline = Date.now() + budgetMs
  const all: LargeFileEntry[] = []
  let scanned = 0
  let truncated = false
  const stack = [root]

  walk: while (stack.length) {
    if (Date.now() >= deadline) {
      truncated = true
      break
    }
    const dir = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      if (dir === root) throw new Error(`Cannot read folder: ${root}`)
      continue
    }
    for (const entry of entries) {
      if (Date.now() >= deadline) {
        truncated = true
        break walk
      }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        if (entry.name.toLowerCase() === 'microsoft' && path.basename(dir).toLowerCase() === 'programdata') continue
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = await fs.stat(full)
        scanned++
        if (stat.size >= threshold) {
          all.push({
            path: full,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            volumeLetter: path.parse(full).root.slice(0, 1).toUpperCase() || null
          })
        }
      } catch {
        /* locked file */
      }
      if (all.length > 4000) {
        // keep memory bounded but continue counting; sort/trim below
        all.sort((a, b) => b.sizeBytes - a.sizeBytes)
        all.length = 2000
      }
    }
  }

  all.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { files: all.slice(0, Math.max(1, limit)), truncated, scannedFiles: scanned }
}
