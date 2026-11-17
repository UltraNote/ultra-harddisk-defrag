import type { DefragAction, MediaType, VolumeKind } from '@shared/types'

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('en-US')
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return `${mins}m ${secs % 60}s`
}

export const ACTION_LABELS: Record<DefragAction, string> = {
  analyze: 'Analyze',
  optimize: 'Defrag & Optimize',
  traditional: 'Traditional Defrag',
  quick: 'Fast Defrag',
  freeSpace: 'Free Space Defrag',
  retrim: 'Trim & Intelligent Optimize',
  slab: 'Slab Consolidation',
  bootOptimize: 'Boot Time Defrag',
  files: 'Defrag Selected Files'
}

export const ACTION_HINTS: Record<DefragAction, string> = {
  analyze: 'Reads fragmentation statistics. Changes nothing.',
  optimize: 'Runs the Windows optimizer for the media type: defrag on HDD, retrim on SSD.',
  traditional: 'Classic defrag pass on an HDD. Slowest, most thorough.',
  quick: 'Preferred operation without the verbose report. Fastest.',
  freeSpace: 'Consolidates free space so new files are written contiguously.',
  retrim: 'Sends TRIM to an SSD and releases free blocks. Never defragments an SSD.',
  slab: 'Slab consolidation for thinly provisioned volumes.',
  bootOptimize: 'Asks Windows to optimize boot files at the next restart.',
  files: 'Defragments only the selected files (/File), on their own volume.'
}

export function mediaTone(media: MediaType): 'green' | 'amber' | 'muted' | 'teal' {
  if (media === 'SSD') return 'teal'
  if (media === 'HDD') return 'amber'
  if (media === 'Unspecified') return 'muted'
  return 'muted'
}

export function kindLabel(kind: VolumeKind): string {
  switch (kind) {
    case 'fixed':
      return 'Fixed'
    case 'removable':
      return 'Removable'
    case 'network':
      return 'Network'
    case 'cdrom':
      return 'Optical'
    default:
      return 'Unknown'
  }
}

export function basename(target: string): string {
  const parts = target.split(/[\\/]/)
  return parts[parts.length - 1] || target
}
