import React from 'react'
import { AlertTriangle, HeartPulse, Info, RefreshCw, Thermometer, Trash2 } from 'lucide-react'
import type { DiskHealth } from '@shared/types'
import { api } from '../api'
import { useApp } from '../lib/context'
import { formatBytes } from '../lib/format'
import { EmptyState, Pill } from '../components/ui'

export default function HealthPage(): React.JSX.Element {
  const { status, runJob, pushToast } = useApp()
  const [health, setHealth] = React.useState<DiskHealth | null>(status?.health ?? null)
  const [loading, setLoading] = React.useState(false)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      setHealth(await api.getHealth())
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    if (status?.health) setHealth(status.health)
  }, [status?.health])

  const disks = health?.physicalDisks ?? []
  const ssdVolumes = (status?.volumes ?? []).filter((v) => v.mediaType === 'SSD' && v.letter)

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Disk health</h1>
          <p>
            Health, media type and TRIM state come from Windows storage APIs. SMART detail is only shown when the storage provider actually returns it — missing values read "unavailable" instead of being guessed.
          </p>
        </div>
        <div className="actions">
          <button className="btn" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card pad">
          <div className="row" style={{ gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: health?.trimEnabled ? 'rgba(20,184,166,0.14)' : 'rgba(251,113,133,0.14)' }}>
              <Trash2 size={18} color={health?.trimEnabled ? 'var(--teal)' : 'var(--rose)'} />
            </div>
            <div className="grow">
              <div style={{ fontWeight: 650 }}>TRIM / UNMAP</div>
              <div className="dim small">
                {health?.trimEnabled === null
                  ? 'Windows did not report a DisableDeleteNotify value.'
                  : health?.trimEnabled
                    ? `Enabled for NTFS (DisableDeleteNotify = ${health?.ntfsDisableDeleteNotify ?? 0}). SSDs can release deleted blocks.`
                    : `Disabled (DisableDeleteNotify = ${health?.ntfsDisableDeleteNotify ?? 1}). SSDs will slow down over time.`}
              </div>
            </div>
            <Pill tone={health?.trimEnabled ? 'green' : health?.trimEnabled === null ? 'muted' : 'rose'}>
              {health?.trimEnabled === null ? 'unknown' : health?.trimEnabled ? 'enabled' : 'disabled'}
            </Pill>
          </div>
          {ssdVolumes.length ? (
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              {ssdVolumes.map((volume) => (
                <button key={volume.id} className="btn teal sm" onClick={() => void runJob({ action: 'retrim', volume: volume.letter! })}>
                  Retrim {volume.letter}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card pad">
          <div className="row" style={{ gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'rgba(245,176,65,0.12)' }}>
              <HeartPulse size={18} color="var(--amber)" />
            </div>
            <div className="grow">
              <div style={{ fontWeight: 650 }}>SMART source</div>
              <div className="dim small">{health?.smartSource ?? 'not queried yet'}</div>
            </div>
            <Pill tone="muted">{disks.length} disk(s)</Pill>
          </div>
          <div className="row small dim" style={{ marginTop: 12, gap: 8 }}>
            <Info size={14} />
            NVMe drives rarely expose SMART through root\WMI; the app reports the gap rather than inventing temperature or wear.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Physical disks</h3>
          <span className="sub">Get-PhysicalDisk + storage reliability counters</span>
        </div>
        {disks.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={22} />} title="No physical disks reported" detail="Refresh to query the storage cmdlets again." />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Disk</th>
                  <th>Media</th>
                  <th>Bus</th>
                  <th className="num">Size</th>
                  <th>Health</th>
                  <th className="num">Temp</th>
                  <th className="num">Wear</th>
                  <th className="num">Hours</th>
                  <th className="num">Read err</th>
                  <th className="num">Write err</th>
                  <th>Volumes</th>
                </tr>
              </thead>
              <tbody>
                {disks.map((disk) => (
                  <tr key={disk.deviceId}>
                    <td>
                      <div className="name">{disk.name}</div>
                      <div className="path">Disk {disk.deviceId}{disk.partitionStyle ? ` · ${disk.partitionStyle}` : ''}</div>
                    </td>
                    <td><Pill tone={disk.mediaType === 'SSD' ? 'teal' : disk.mediaType === 'HDD' ? 'amber' : 'muted'}>{disk.mediaType}</Pill></td>
                    <td className="dim">{disk.busType}</td>
                    <td className="num mono">{formatBytes(disk.sizeBytes)}</td>
                    <td>
                      <Pill tone={/healthy/i.test(disk.health) ? 'green' : 'rose'}>{disk.health || 'unknown'}</Pill>
                    </td>
                    <td className="num mono">{disk.temperatureC !== null ? `${disk.temperatureC} °C` : '—'}</td>
                    <td className="num mono">{disk.wear !== null ? `${disk.wear}%` : '—'}</td>
                    <td className="num mono">{disk.powerOnHours ?? '—'}</td>
                    <td className="num mono">{disk.readErrorsTotal ?? '—'}</td>
                    <td className="num mono">{disk.writeErrorsTotal ?? '—'}</td>
                    <td className="mono">{disk.volumes.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {disks.some((d) => d.notes.length > 0) ? (
          <div style={{ padding: '12px 18px' }} className="stack small dim">
            {disks.flatMap((disk) =>
              disk.notes.map((note) => (
                <div key={`${disk.deviceId}-${note}`} className="row" style={{ gap: 8 }}>
                  <Thermometer size={13} /> {disk.name}: {note}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3>What this app can and cannot see</h3>
        </div>
        <div style={{ padding: 18 }} className="stack small dim">
          <div>✔ Media type and bus type: <span style={{ color: 'var(--text)' }}>reliable</span> (Get-PhysicalDisk).</div>
          <div>✔ Volume health and file system: <span style={{ color: 'var(--text)' }}>reliable</span> (Get-Volume).</div>
          <div>✔ TRIM state: <span style={{ color: 'var(--text)' }}>reliable</span> (fsutil behavior query DisableDeleteNotify).</div>
          <div>✖ SMART attributes on NVMe: <span style={{ color: 'var(--rose)' }}>usually unavailable</span> in user space.</div>
          <div>✖ SSD wear normalised values: <span style={{ color: 'var(--rose)' }}>only when the provider returns them</span>.</div>
        </div>
      </div>
    </div>
  )
}
