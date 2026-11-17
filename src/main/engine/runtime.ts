import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface RuntimePaths {
  root: string
  vault: string
  safeBox: string
  state: string
  logs: string
  quarantineIndex: string
  safeBoxIndex: string
  settings: string
  history: string
  detections: string
  whiteListBackup: string
}

/**
 * All engine persistence lives under one root (Electron: %APPDATA%/Ultra Malware Fighter).
 * Pure Node so the engine and the self-test never need Electron.
 */
export function createPaths(root: string): RuntimePaths {
  return {
    root,
    vault: path.join(root, 'vault'),
    safeBox: path.join(root, 'safebox'),
    state: path.join(root, 'state'),
    logs: path.join(root, 'logs'),
    quarantineIndex: path.join(root, 'state', 'quarantine.json'),
    safeBoxIndex: path.join(root, 'state', 'safebox.json'),
    settings: path.join(root, 'state', 'settings.json'),
    history: path.join(root, 'state', 'history.json'),
    detections: path.join(root, 'state', 'detections.json'),
    whiteListBackup: path.join(root, 'state', 'whitelist.backup.json')
  }
}

export async function ensureDirs(p: RuntimePaths): Promise<void> {
  for (const dir of [p.root, p.vault, p.safeBox, p.state, p.logs]) {
    await fs.mkdir(dir, { recursive: true })
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Write via temp file + rename so a crash mid-write cannot truncate the store.
 *
 * Retries: another antivirus, a backup tool or the user deleting the data directory
 * can make the directory or the target file briefly unavailable (ENOENT/EPERM/EBUSY).
 * A failed persist must never take the app down or leave a stale .tmp behind.
 */
export async function writeJson(file: string, value: unknown): Promise<void> {
  const dir = path.dirname(file)
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  const payload = JSON.stringify(value, null, 2)
  let lastError: unknown = null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(tmp, payload, 'utf8')
      await fs.rename(tmp, file)
      return
    } catch (err) {
      lastError = err
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export function fileExists(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

export function expandEnv(input: string): string {
  return input.replace(/%([^%]+)%/g, (_, name: string) => process.env[name.toUpperCase()] ?? process.env[name] ?? `%${name}%`)
}

export function uid(prefix = 'u'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
