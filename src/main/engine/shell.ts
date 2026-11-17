import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const POWERSHELL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export interface RunResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

/** Plain child_process run; never throws, always resolves. */
export function run(command: string, args: string[], timeout = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? ((err as unknown as { code: number }).code) : err ? 1 : 0
      resolve({ ok: !err, code, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' })
    })
  })
}

/** Run a PowerShell snippet and return stdout. Empty result means failure. */
export async function powershell(script: string, timeout = 90_000): Promise<string> {
  if (!existsSync(POWERSHELL)) return ''
  const result = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], timeout)
  return result.stdout
}

/** JSON helper: PowerShell returns a single object for one row, an array for many. */
export function asArray<T>(value: unknown): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? (value as T[]) : [value as T]
}

export function parseJsonLoose<T>(text: string): T | null {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as T
  } catch {
    // PowerShell sometimes prefixes warnings; take the last JSON-looking line.
    const lines = text.trim().split(/\r?\n/).filter((line) => line.trim().startsWith('{') || line.trim().startsWith('['))
    if (!lines.length) return null
    try {
      return JSON.parse(lines[lines.length - 1]) as T
    } catch {
      return null
    }
  }
}

export function isElevatedSync(): Promise<boolean> {
  return run('net', ['session'], 8000).then((r) => r.ok && r.stdout.length > 0)
}
