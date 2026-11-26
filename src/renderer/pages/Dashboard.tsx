import React from 'react'
import { ArrowRight, CircleGauge, Gauge, HardDrive, ShieldAlert, Sparkles, Timer, Wrench } from 'lucide-react'
import { useApp } from '../lib/context'
import { ACTION_HINTS, formatBytes, formatDate, mediaTone, relativeTime } from '../lib/format'
import { Dot, FragBar, FreeBar, Pill } from '../components/ui'
import type { VolumeInfo } from '@shared/types'

function StatCard({
  icon,
  label,
  value,
  sub
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}): React.JSX.Element {
  return (
    <div className="card pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div className="glyph" style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(245,176,65,0.12)', color: 'var(--amber-2)' }}>
        {icon}
      </div>
      <div className="grow">
        <div className="dim small">{label}</div>
        <div style={{ fontSize: 17, fontWeight: 650, letterSpacing: '-0.2px' }}>{value}</div>
        {sub ? <div className="dim small">{sub}</div> : null}
      </div>
    </div>
  )
}

function VolumeRow({ volume }: { volume: VolumeInfo }): React.JSX.Element {
  const { runJob, navigate, status } = useApp()
  const fragmented = volume.fragmentation?.totalFragmentedSpacePercent ?? null
  const elevated = status?.elevated ?? false

  return (
    <div className={`volume-card ${volume.isSystem ? 'system' : ''}`}>
      <div className="row" style={{ gap: 12 }}>
        <div className={`letter ${volume.mediaType === 'SSD' ? 'ssd' : volume.kind === 'removable' ? 'removable' : ''}`}>
          {volume.letter ?? '—'}
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{volume.label || 'Volume'}</strong>
            <Pill tone={mediaTone(volume.mediaType)}>{volume.mediaType === 'Unknown' ? 'Unspecified media' : volume.mediaType}</Pill>
            {volume.isSystem ? <Pill tone="amber">System</Pill> : null}
            {volume.kind !== 'fixed' ? <Pill>{volume.kind}</Pill> : null}
            {volume.health && !/healthy/i.test(volume.health) ? <Pill tone="rose">{volume.health}</Pill> : null}
          </div>
          <div className="dim small ellipsis" title={volume.physicalName}>
            {volume.fileSystem} · {formatBytes(volume.sizeBytes)} · {formatBytes(volume.freeBytes)} free
            {volume.physicalName ? ` · ${volume.physicalName}` : ''}
          </div>
        </div>
        <div style={{ width: 190 }}>
          <FragBar percent={fragmented} />
        </div>
        <div style={{ width: 150 }} className="col" >
          <FreeBar used={volume.sizeBytes - volume.freeBytes} total={volume.sizeBytes} />
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 2 }}>
        <div className="dim small">
          {volume.lastOptimizedAt ? (
            <>
              Last {volume.lastAction?.toLowerCase() ?? 'run'} {relativeTime(volume.lastOptimizedAt)} ·{' '}
              {formatDate(volume.lastOptimizedAt)}
            </>
          ) : (
            'Never optimized by Ultra Harddisk Defrag'
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn sm"
            disabled={!volume.letter || !elevated}
            title={elevated ? 'Read fragmentation statistics without changing anything' : 'Analyze needs Administrator rights'}
            onClick={() => volume.letter && void runJob({ action: 'analyze', volume: volume.letter })}
          >
            Analyze
          </button>
          <button
            className="btn sm primary"
            disabled={!volume.letter}
            onClick={() => volume.letter && void runJob({ action: volume.mediaType === 'SSD' ? 'retrim' : 'optimize', volume: volume.letter })}
          >
            {volume.mediaType === 'SSD' ? 'Trim' : 'Optimize'}
          </button>
          <button className="btn sm ghost" onClick={() => navigate('defrag')} title="Open the full defrag toolbox">
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage(): React.JSX.Element {
  const { status, settings, elevate, navigate, runJobs } = useApp()
  const volumes = status?.volumes ?? []
  const targets = volumes.filter((volume) => volume.letter && volume.kind === 'fixed')
  const analyzed = volumes.filter((v) => v.fragmentation)
  const averageFrag = analyzed.length
    ? Math.round(analyzed.reduce((sum, v) => sum + (v.fragmentation?.totalFragmentedSpacePercent ?? 0), 0) / analyzed.length)
    : null
  const unhealthy = (status?.health?.physicalDisks ?? []).filter((d) => /^(warning|unhealthy)$/i.test(d.health.trim()))
  const fragmentedVolumes = analyzed.filter((v) => (v.fragmentation?.totalFragmentedSpacePercent ?? 0) >= settings.autoDefrag.thresholdPercent)

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Disk overview</h1>
          <p>Every number on this page comes from Windows itself — Get-Volume/Get-PhysicalDisk for the disks, defrag.exe for the fragmentation level. Nothing is estimated.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => navigate('health')}>Disk health</button>
          <button
            className="btn primary"
            disabled={!targets.length || status?.lastJob?.state === 'running'}
            onClick={() => void runJobs(targets.map((volume) => ({ action: 'optimize', volume: volume.letter! })))}
          >
            <Sparkles size={15} /> Optimize all
          </button>
        </div>
      </div>

      {status && !status.elevated ? (
        <div className="banner">
          <ShieldAlert size={20} color="var(--amber)" />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Running as a standard user</div>
            <div className="dim small">Windows refuses every storage-optimizer operation without elevation (0x89000024). Analysis can be queued, but it will stop at the same wall — relaunch elevated to do real work.</div>
          </div>
          <button className="btn primary" onClick={() => void elevate()}>Relaunch as Administrator</button>
        </div>
      ) : null}

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <StatCard icon={<HardDrive size={17} />} label="Volumes" value={String(volumes.length)} sub={`${volumes.filter((v) => v.kind === 'fixed').length} fixed · ${volumes.filter((v) => v.mediaType === 'SSD').length} SSD`} />
        <StatCard icon={<Gauge size={17} />} label="Average fragmentation" value={averageFrag === null ? 'not analyzed' : `${averageFrag}%`} sub={analyzed.length ? `${analyzed.length} of ${volumes.length} analyzed` : 'run Analyze on a volume'} />
        <StatCard icon={<Timer size={17} />} label="Last optimization" value={relativeTime(status?.stats.lastRunAt ?? null)} sub={formatDate(status?.stats.lastRunAt ?? null)} />
        <StatCard icon={unhealthy.length ? <ShieldAlert size={17} /> : <CircleGauge size={17} />} label="Disk health" value={unhealthy.length ? `${unhealthy.length} warning(s)` : 'Healthy'} sub={`${status?.health?.physicalDisks.length ?? 0} physical disk(s)`} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3>Volumes</h3>
          <span className="sub">Fragmentation is only shown once a volume has been analyzed</span>
          <div className="right">
            {fragmentedVolumes.length > 0 ? <Pill tone="amber">{fragmentedVolumes.length} above {settings.autoDefrag.thresholdPercent}%</Pill> : null}
            <Pill tone={settings.autoDefrag.enabled ? 'green' : 'muted'}>{settings.autoDefrag.enabled ? 'Auto Defrag idle' : 'Auto Defrag off'}</Pill>
          </div>
        </div>
        <div className="stack" style={{ padding: 14 }}>
          {volumes.length === 0 ? (
            <div className="empty">No volumes reported by Windows yet.</div>
          ) : (
            volumes.map((volume) => <VolumeRow key={volume.id} volume={volume} />)
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Automation</h3>
            <div className="right">
              <button className="btn sm ghost" onClick={() => navigate('schedule')}>Configure</button>
            </div>
          </div>
          <div className="stack" style={{ padding: 16 }}>
            <div className="row" style={{ gap: 10 }}>
              <Dot color={settings.autoDefrag.enabled ? 'green' : 'dim'} />
              <div className="grow">
                <div style={{ fontWeight: 550 }}>Auto Defrag while idle</div>
                <div className="dim small">
                  {settings.autoDefrag.enabled
                    ? `Analyzes after ${settings.autoDefrag.idleMinutes} min idle, optimizes anything above ${settings.autoDefrag.thresholdPercent}%. ${ACTION_HINTS[settings.autoDefrag.action]}`
                    : 'Disabled — nothing happens unless you ask.'}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <Dot color={settings.scheduled.enabled ? 'green' : 'dim'} />
              <div className="grow">
                <div style={{ fontWeight: 550 }}>Scheduled defrag</div>
                <div className="dim small">
                  {settings.scheduled.enabled
                    ? `${settings.scheduled.cadence} at ${String(settings.scheduled.hour).padStart(2, '0')}:${String(settings.scheduled.minute).padStart(2, '0')} · next ${formatDate(status?.scheduledNext ?? null)}`
                    : 'No schedule configured.'}
                </div>
              </div>
            </div>

          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Recent runs</h3>
            <div className="right">
              <button className="btn sm ghost" onClick={() => navigate('defrag')}>History</button>
            </div>
          </div>
          <div className="stack" style={{ padding: 16 }}>
            {(status?.lastJob ? [status.lastJob] : []).map((job) => (
              <div key={job.id} className="row" style={{ gap: 10 }}>
                <Wrench size={15} color="var(--amber)" />
                <div className="grow">
                  <div style={{ fontWeight: 550 }}>{job.action} {job.volume}</div>
                  <div className="dim small">{job.phase} · {formatDate(job.startedAt)}</div>
                </div>
                <Pill tone={job.state === 'completed' ? 'green' : job.state === 'running' ? 'amber' : job.state === 'needs-elevation' ? 'rose' : 'muted'}>{job.state}</Pill>
              </div>
            ))}
            {!status?.lastJob ? <div className="dim small">Nothing has run in this session yet.</div> : null}
            {status?.lastOptimize ? (
              <div className="row" style={{ gap: 10, marginTop: 6 }}>
                <div className="grow">
                  <div className="dim small">Last recorded optimization</div>
                  <div style={{ fontWeight: 550 }}>
                    {status.lastOptimize.volume} · {status.lastOptimize.action} · {formatDate(status.lastOptimize.finishedAt)}
                  </div>
                </div>
                <Pill tone="teal">
                  {status.lastOptimize.fragmentedPercentBefore ?? '?'}% → {status.lastOptimize.fragmentedPercentAfter ?? '?'}%
                </Pill>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
