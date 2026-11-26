import type { DiskHealth, MediaType, PhysicalDiskInfo, SmartAttribute, VolumeInfo, VolumeKind } from '../../shared/types'
import { asArray, parseJsonLoose, powershell, run, systemExecutable } from './shell'

interface RawVolume {
  id?: string
  letter?: string
  label?: string
  fs?: string
  type?: string
  size?: number
  free?: number
  health?: string
  diskNumber?: number | null
  physicalDeviceId?: string
  media?: string
  bus?: string
  name?: string
}

interface RawDisk {
  id?: string
  name?: string
  media?: string
  bus?: string
  health?: string
  status?: string
  size?: number
  temp?: number | null
  wear?: number | null
  hours?: number | null
  readErr?: number | null
  writeErr?: number | null
  cycles?: number | null
}

const VOLUME_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$disks = @(Get-Disk)
$physical = @(Get-PhysicalDisk)
$out = foreach ($v in Get-Volume) {
  if (-not $v.DriveLetter -and -not $v.Path) { continue }
  $p = $null
  if ($v.DriveLetter) { $p = Get-Partition -DriveLetter $v.DriveLetter | Select-Object -First 1 }
  $pd = $null
  $d = $null
  if ($p) {
    $d = $disks | Where-Object Number -eq $p.DiskNumber | Select-Object -First 1
    if ($d) {
      $matches = @($physical | Where-Object { ($d.UniqueId -and $_.UniqueId -eq $d.UniqueId) -or ($d.SerialNumber -and $_.SerialNumber -and $_.SerialNumber.Trim() -eq $d.SerialNumber.Trim()) })
      if ($matches.Count -eq 1) { $pd = $matches[0] }
    }
  }
  [pscustomobject]@{
    id = [string]$v.Path
    letter = if ($v.DriveLetter) { [string]$v.DriveLetter } else { $null }
    label = [string]$v.FileSystemLabel
    fs = [string]$v.FileSystemType
    type = [string]$v.DriveType
    size = if ($v.Size) { [int64]$v.Size } else { 0 }
    free = if ($v.SizeRemaining) { [int64]$v.SizeRemaining } else { 0 }
    health = [string]$v.HealthStatus
    diskNumber = if ($p) { [int]$p.DiskNumber } else { $null }
    physicalDeviceId = if ($pd) { [string]$pd.DeviceId } else { $null }
    media = if ($pd) { [string]$pd.MediaType } else { $null }
    bus = if ($pd) { [string]$pd.BusType } elseif ($d) { [string]$d.BusType } else { $null }
    name = if ($pd) { [string]$pd.FriendlyName } elseif ($d) { [string]$d.FriendlyName } else { $null }
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 4
`

const DISK_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$out = foreach ($d in Get-PhysicalDisk) {
  $rel = $null
  try { $rel = $d | Get-StorageReliabilityCounter -ErrorAction Stop } catch { $rel = $null }
  [pscustomobject]@{
    id = [string]$d.DeviceId
    name = [string]$d.FriendlyName
    media = [string]$d.MediaType
    bus = [string]$d.BusType
    health = [string]$d.HealthStatus
    status = ($d.OperationalStatus -join ',')
    size = if ($d.Size) { [int64]$d.Size } else { 0 }
    temp = if ($rel -and $null -ne $rel.Temperature) { [int]$rel.Temperature } else { $null }
    wear = if ($rel -and $null -ne $rel.Wear) { [int]$rel.Wear } else { $null }
    hours = if ($rel -and $null -ne $rel.PowerOnHours) { [int]$rel.PowerOnHours } else { $null }
    readErr = if ($rel -and $null -ne $rel.ReadErrorsTotal) { [int64]$rel.ReadErrorsTotal } else { $null }
    writeErr = if ($rel -and $null -ne $rel.WriteErrorsTotal) { [int64]$rel.WriteErrorsTotal } else { $null }
    cycles = if ($rel -and $null -ne $rel.StartStopCycleCount) { [int]$rel.StartStopCycleCount } else { $null }
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 4
`

const SMART_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
try {
  $rows = Get-CimInstance -Namespace root\\WMI -ClassName MSStorageDriver_ATAPISmartData -ErrorAction Stop
  $out = foreach ($row in $rows) {
    [pscustomobject]@{ instance = [string]$row.InstanceName; vendor = [string](($row.VendorSpecific | ForEach-Object { $_.ToString('X2') }) -join '') }
  }
  ConvertTo-Json -InputObject @($out) -Compress -Depth 4
} catch { '' }
`

// ATA SMART attribute identifiers used by the SMART window of the product this was modelled on.
const SMART_NAMES: Record<number, string> = {
  1: 'Read Error Rate',
  2: 'Throughput Performance',
  3: 'Spin-Up Time',
  4: 'Start/Stop Count',
  5: 'Reallocated Sectors Count',
  7: 'Seek Error Rate',
  8: 'Seek Time Performance',
  9: 'Power-On Hours',
  10: 'Spin Retry Count',
  11: 'Recalibration Retries',
  12: 'Power Cycle Count',
  13: 'Soft Read Error Rate',
  184: 'End-to-End Error',
  187: 'Reported Uncorrectable Errors',
  188: 'Command Timeout',
  189: 'High Fly Writes',
  190: 'Airflow Temperature',
  191: 'G-Sense Error Rate',
  192: 'Power-off Retract Count',
  193: 'Load/Unload Cycle Count',
  194: 'Temperature',
  195: 'Hardware ECC Recovered',
  196: 'Reallocation Event Count',
  197: 'Current Pending Sector Count',
  198: 'Uncorrectable Sector Count',
  199: 'UltraDMA CRC Error Count',
  200: 'Write Error Rate',
  201: 'Soft Read Error Rate',
  202: 'Data Address Mark Error',
  220: 'Disk Shift',
  222: 'Loaded Hours',
  223: 'Load/Unload Retry Count',
  225: 'Load/Unload Cycle Count',
  226: 'Load Friction',
  231: 'SSD Life Left',
  232: 'Available Reserved Space',
  233: 'Media Wearout Indicator',
  241: 'Total LBAs Written',
  242: 'Total LBAs Read'
}

function normaliseMedia(value: string | undefined): MediaType {
  const text = (value ?? '').toLowerCase()
  if (text.includes('ssd')) return 'SSD'
  if (text.includes('hdd') || text.includes('hard disk')) return 'HDD'
  if (!text || text === 'unspecified') return 'Unspecified'
  return 'Unknown'
}

function normaliseKind(value: string | undefined): VolumeKind {
  const text = (value ?? '').toLowerCase()
  if (text.startsWith('fixed')) return 'fixed'
  if (text.startsWith('removable')) return 'removable'
  if (text.startsWith('network')) return 'network'
  if (text.includes('cd')) return 'cdrom'
  return 'unknown'
}

/** Volumes with their backing disk, from the storage cmdlets (read-only, works unelevated). */
export async function listVolumes(): Promise<VolumeInfo[]> {
  const raw = parseJsonLoose<RawVolume[] | RawVolume>(await powershell(VOLUME_SCRIPT))
  const rows = asArray<RawVolume>(raw)
  const systemDrive = (process.env.SystemDrive ?? 'C:').replace(':', '').toUpperCase()

  return rows
    .filter((row) => row.letter || (row.size ?? 0) > 0)
    .map<VolumeInfo>((row) => {
      const letter = row.letter ? row.letter.toUpperCase() : null
      return {
        id: row.id || letter || row.label || 'volume',
        letter,
        label: row.label ?? '',
        fileSystem: row.fs ?? '',
        kind: normaliseKind(row.type),
        sizeBytes: Number(row.size ?? 0),
        freeBytes: Number(row.free ?? 0),
        health: row.health ?? 'Unknown',
        diskNumber: row.diskNumber ?? null,
        physicalDeviceId: row.physicalDeviceId ?? undefined,
        mediaType: normaliseMedia(row.media),
        busType: row.bus ?? '',
        physicalName: row.name ?? '',
        isSystem: letter === systemDrive,
        trimSupported: null,
        fragmentation: null,
        lastOptimizedAt: null,
        lastAction: null
      }
    })
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || (a.letter ?? '').localeCompare(b.letter ?? ''))
}

export async function listPhysicalDisks(volumes: VolumeInfo[]): Promise<PhysicalDiskInfo[]> {
  const raw = parseJsonLoose<RawDisk[] | RawDisk>(await powershell(DISK_SCRIPT))
  const rows = asArray<RawDisk>(raw)
  return rows.map((row) => {
    const deviceId = String(row.id ?? '')
    const attached = volumes.filter((v) => v.physicalDeviceId === deviceId && v.letter).map((v) => v.letter as string)
    const notes: string[] = []
    if (!attached.length) notes.push('no mounted volume letter')
    return {
      deviceId,
      name: row.name ?? 'Unknown disk',
      mediaType: normaliseMedia(row.media),
      busType: row.bus ?? '',
      health: row.health ?? 'Unknown',
      operationalStatus: row.status ?? '',
      sizeBytes: Number(row.size ?? 0),
      partitionStyle: null,
      temperatureC: row.temp ?? null,
      wear: row.wear ?? null,
      powerOnHours: row.hours ?? null,
      readErrorsTotal: row.readErr ?? null,
      writeErrorsTotal: row.writeErr ?? null,
      startStopCycles: row.cycles ?? null,
      volumes: attached,
      notes
    }
  })
}

/** fsutil works unelevated and tells us whether TRIM is allowed for NTFS/ReFS. */
export async function trimState(): Promise<{ enabled: boolean | null; value: number | null; raw: string }> {
  const result = await run(systemExecutable('fsutil.exe'), ['behavior', 'query', 'DisableDeleteNotify'], 15_000)
  const text = `${result.stdout}${result.stderr}`
  const match = text.match(/NTFS\s+DisableDeleteNotify\s*=\s*(\d)/i)
  const value = match ? Number(match[1]) : null
  return { enabled: value === 0 ? true : value === 1 ? false : null, value, raw: text.trim() }
}

interface RawSmart {
  instance?: string
  vendor?: string
}

/**
 * The ATA SMART attribute table is only reachable through root\WMI, which is
 * Administrator-only. Parsed when available; reported as unavailable otherwise.
 */
export async function smartAttributes(): Promise<{ attributes: SmartAttribute[]; source: string }> {
  const raw = parseJsonLoose<RawSmart[] | RawSmart>(await powershell(SMART_SCRIPT, 30_000))
  const rows = asArray<RawSmart>(raw).filter((row) => row.vendor && row.vendor.length >= 24)
  if (!rows.length) {
    return { attributes: [], source: 'unavailable (root\\WMI SMART requires Administrator)' }
  }
  const attributes: SmartAttribute[] = []
  for (const row of rows) {
    const vendor = row.vendor!
    // ATA SMART data: 2-byte revision, 2-byte offline collection status, then 30 entries of 12 bytes.
    for (let offset = 4; offset + 12 <= Math.min(vendor.length / 2, 362); offset += 12) {
      const read = (index: number): number => parseInt(vendor.slice((offset + index) * 2, (offset + index) * 2 + 2), 16)
      const id = read(0)
      if (id === 0) continue
      const value = read(3)
      const worst = read(4)
      const rawBytes = []
      for (let k = 0; k < 6; k++) rawBytes.push(read(5 + k))
      const threshold = 0
      const status: SmartAttribute['status'] = value === 0 ? 'unknown' : value > 100 ? 'ok' : value > threshold ? 'ok' : 'bad'
      attributes.push({
        id: id.toString(16).toUpperCase().padStart(2, '0'),
        name: SMART_NAMES[id] ?? 'Vendor Specific',
        status,
        value,
        worst,
        threshold,
        raw: rawBytes.join(' ')
      })
    }
    // One table per disk is enough for the UI; the caller displays the first row.
    break
  }
  return { attributes, source: `root\\WMI MSStorageDriver_ATAPISmartData (${rows.length} device(s))` }
}

export async function diskHealth(volumes: VolumeInfo[]): Promise<DiskHealth> {
  const [trim, disks, smart] = await Promise.all([trimState(), listPhysicalDisks(volumes), smartAttributes()])
  const ordered = [...disks].sort((a, b) => {
    const left = Number(a.deviceId)
    const right = Number(b.deviceId)
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right
    return a.deviceId.localeCompare(b.deviceId)
  })
  return {
    trimEnabled: trim.enabled,
    ntfsDisableDeleteNotify: trim.value,
    physicalDisks: ordered,
    smartSource: smart.source
  }
}
