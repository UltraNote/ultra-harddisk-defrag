import React from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownWideNarrow,
  Boxes,
  CheckCircle2,
  CircleSlash,
  Gauge,
  Layers,
  Move3d,
  Play,
  Power,
  RefreshCw,
  ScanLine,
  SquareStack,
  Trash2,
  XCircle,
  Zap
} from 'lucide-react'
import type { DefragAction, DefragCommand, DefragJob, OptimizeHistoryEntry } from '@shared/types'
import { useApp } from '../lib/context'
import { api } from '../api'
import { ACTION_HINTS, ACTION_LABELS, formatBytes, formatDate, formatDuration, formatNumber } from '../lib/format'
import { CommandBlock, EmptyState, Pill } from '../components/ui'

const TILES: Array<{ action: DefragAction; icon: React.ReactNode }> = [
  { action: 'analyze', icon: <ScanLine size={15} /> },
  { action: 'optimize', icon: <Zap size={15} /> },
  { action: 'quick', icon: <RefreshCw size={15} /> },
  { action: 'traditional', icon: <Layers size={15} /> },
  { action: 'freeSpace', icon: <ArrowDownWideNarrow size={15} /> },
  { action: 'retrim', icon: <Trash2 size={15} /> },
  { action: 'slab', icon: <Boxes size={15} /> },
  { action: 'bootOptimize', icon: <Power size={15} /> }
]

function stateTone(state: DefragJob['state'] | OptimizeHistoryEntry['state']): 'green' | 'amber' | 'rose' | 'muted' {
  if (state === 'completed') return 'green'
  if (state === 'running') return 'amber'
  if (state === 'needs-elevation' || state === 'failed') return 'rose'
  return 'muted'
}

function StateIcon({ state }: { state: string }): React.JSX.Element {
  if (state === 'completed') return <CheckCircle2 size={14} color="var(--green)" />
  if (state === 'running') return <Activity size={14} color="var(--amber)" className="spin" />
  if (state === 'needs-elevation') return <AlertTriangle size={14} color="var(--rose)" />
  if (state === 'cancelled') return <CircleSlash size={14} color="var(--dim)" />
  return <XCircle size={14} color="var(--red)" />
}

export default function DefragPage(): React.JSX.Element {
  const { status, runJob, cancelJob, elevate, job } = useApp()
  const volumes = (status?.volumes ?? []).filter((v) => v.letter)
  const [volume, setVolume] = React.useState<string>(volumes[0]?.letter ?? 'C:')
  const [preview, setPreview] = React.useState<DefragCommand | null>(null)
  const [history, setHistory] = React.useState<OptimizeHistoryEntry[]>([])
  const [action, setAction] = React.useState<DefragAction>('optimize')

  const selected = volumes.find((v) => v.letter === volume)
  const live = job?.state === 'running' ? job : null

  React.useEffect(() => {
    if (!volumes.some((v) => v.letter === volume) && volumes[0]?.letter) setVolume(volumes[0].letter)
  }, [volumes, volume])

  React.useEffect(() => {
    void api.previewCommand({ action, volume }).then(setPreview).catch(() => setPreview(null))
  }, [action, volume])

  React.useEffect(() => {
    void api.getHistory().then(setHistory)
  }, [job?.finishedAt])

  const stats = job?.statsAfter ?? selected?.fragmentation ?? null
  const percent = live?.percent ?? job?.percent ?? 0
  const logLines = job?.lines ?? []

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Defrag</h1>
          <p>
            One volume at a time, through Microsoft's own storage optimizer. Every action maps to a documented <code className="mono">defrag.exe</code> operation — the exact command line is shown before it runs.
          </p>
        </div>
        <div className="actions">
          {status && !status.elevated ? (
            <button className="btn" onClick={() => void elevate()}>Relaunch elevated</button>
          ) : null}
          {live ? (
            <button className="btn danger" onClick={() => void cancelJob()}>Cancel run</button>
          ) : null}
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.45fr 1fr', alignItems: 'start' }}>
        <div className="col" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-head">
              <h3>Volume</h3>
              <div className="right">
                <div className="chip-set">
                  {volumes.map((v) => (
                    <button
                      key={v.id}
                      className={`chip ${volume === v.letter ? 'on' : ''}`}
                      onClick={() => setVolume(v.letter!)}
                      title={`${v.label} · ${v.fileSystem} · ${v.mediaType}`}
                    >
                      {v.letter} {v.mediaType === 'SSD' ? '· SSD' : v.mediaType === 'HDD' ? '· HDD' : ''}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {selected ? (
              <div style={{ padding: 16 }}>
                <div className="row" style={{ gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div>
                    <div className="dim small">Size / free</div>
                    <div style={{ fontWeight: 600 }}>{formatBytes(selected.sizeBytes)} · {formatBytes(selected.freeBytes)} free</div>
                  </div>
                  <div>
                    <div className="dim small">Fragmented</div>
                    <div style={{ fontWeight: 600 }}>{selected.fragmentation?.totalFragmentedSpacePercent ?? '—'}%</div>
                  </div>
                  <div>
                    <div className="dim small">Files / excess fragments</div>
                    <div style={{ fontWeight: 600 }}>
                      {formatNumber(selected.fragmentation?.fragmentedFiles ?? null)} / {formatNumber(selected.fragmentation?.excessFragments ?? null)}
                    </div>
                  </div>
                  <div>
                    <div className="dim small">Media</div>
                    <div style={{ fontWeight: 600 }}>{selected.mediaType} · {selected.busType}</div>
                  </div>
                  <div className="grow" />
                  <div className="dim small" style={{ maxWidth: 260 }}>
                    {selected.fragmentation
                      ? `Analyzed ${formatDate(selected.fragmentation.analyzedAt)}`
                      : 'Not analyzed yet in this session.'}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Operations</h3>
              <span className="sub">Default is chosen for the media type</span>
              <div className="right">
                <Pill tone={selected?.mediaType === 'SSD' ? 'teal' : 'amber'}>
                  {selected?.mediaType === 'SSD' ? 'SSD: trim, never defrag' : 'HDD: real defrag'}
                </Pill>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              <div className="action-grid">
                {TILES.map((tile) => {
                  const disabled = !selected?.letter || (tile.action === 'retrim' && selected?.mediaType !== 'SSD') || live !== null
                  return (
                    <button
                      key={tile.action}
                      className="action-btn"
                      disabled={disabled}
                      onClick={() => {
                        setAction(tile.action)
                        void runJob({ action: tile.action, volume })
                      }}
                      title={tile.action === 'retrim' && selected?.mediaType !== 'SSD' ? 'TRIM only applies to SSDs' : ACTION_HINTS[tile.action]}
                    >
                      <span className="glyph">{tile.icon}</span>
                      <strong>{ACTION_LABELS[tile.action]}</strong>
                      <span>{ACTION_HINTS[tile.action]}</span>
                    </button>
                  )
                })}
              </div>

              <div className="divider" />
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="dim small">Next command</span>
                <div className="grow" style={{ minWidth: 260 }}>
                  {preview ? <CommandBlock command={preview.display} /> : <span className="dim small">—</span>}
                </div>
                <button
                  className="btn teal sm"
                  disabled={!selected || live !== null}
                  onClick={async () => {
                    const result = await api.startJob({ action, volume, dryRun: true })
                    if (result.state === 'completed') {
                      setHistory(await api.getHistory())
                    }
                  }}
                  title="Validate the command without touching the disk"
                >
                  Dry run
                </button>
              </div>
              {selected?.mediaType === 'SSD' && (action === 'traditional' || action === 'freeSpace') ? (
                <div className="row" style={{ marginTop: 10, gap: 8 }}>
                  <AlertTriangle size={15} color="var(--amber)" />
                  <span className="dim small">Defragmenting an SSD adds writes without improving read speed. Prefer Trim &amp; Intelligent Optimize.</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Run</h3>
              <div className="right">
                {job ? <Pill tone={stateTone(job.state)}>{job.state}</Pill> : <Pill>idle</Pill>}
                {live ? <Pill tone="amber">{live.percent}%</Pill> : null}
              </div>
            </div>
            <div style={{ padding: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>{live?.phase ?? job?.phase ?? 'Nothing running'}</div>
                <div className="dim small">{live?.command ?? job?.command ?? ''}</div>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.max(2, percent)}%` }} />
              </div>

              {job?.elevationHint ? (
                <div className="banner" style={{ marginTop: 14 }}>
                  <AlertTriangle size={18} color="var(--rose)" />
                  <div className="grow small">{job.elevationHint}</div>
                  <button className="btn primary sm" onClick={() => void elevate()}>Elevate</button>
                </div>
              ) : null}

              {job?.error ? (
                <div className="banner" style={{ marginTop: 14, borderColor: 'rgba(251,113,133,0.4)' }}>
                  <XCircle size={18} color="var(--rose)" />
                  <div className="grow small">{job.error}</div>
                </div>
              ) : null}

              <div className="log-box" style={{ marginTop: 14 }}>
                {logLines.length === 0 ? (
                  <span className="dim">No output yet. defrag.exe writes its report here while it runs.</span>
                ) : (
                  logLines.slice(-24).map((line, index) => (
                    <div className="line" key={`${index}-${line.slice(0, 12)}`}>{line}</div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-head">
              <h3>Fragmentation statistics</h3>
              <div className="right">
                <Pill tone="muted">{stats ? 'reported by defrag' : 'unavailable'}</Pill>
              </div>
            </div>
            {stats ? (
              <div style={{ padding: 16 }} className="stack">
                {[
                  ['Total fragmented space', `${stats.totalFragmentedSpacePercent ?? '—'}%`],
                  ['Average fragments per file', `${stats.averageFragmentsPerFile ?? '—'}`],
                  ['Fragmented files', formatNumber(stats.fragmentedFiles)],
                  ['Excess fragments', formatNumber(stats.excessFragments)],
                  ['Folders', formatNumber(stats.folders)],
                  ['Average fragments per folder', `${stats.averageFragmentsPerFolder ?? '—'}`],
                  ['Scattered files', formatNumber(stats.scatteredFiles)],
                  ['Volume size', stats.volumeSizeText ?? '—'],
                  ['Cluster size', stats.clusterSizeText ?? '—'],
                  ['Percent free space', stats.freeSpacePercent !== null ? `${stats.freeSpacePercent}%` : '—']
                ].map(([label, value]) => (
                  <div key={label} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="dim small">{label}</span>
                    <span className="mono">{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Gauge size={22} />} title="No analysis yet" detail="Run Analyze to fill this panel with real numbers." />
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Media guidance</h3>
            </div>
            <div style={{ padding: 16 }} className="stack small dim">
              <div className="row" style={{ gap: 8 }}>
                <SquareStack size={14} color="var(--teal)" />
                <span><b style={{ color: 'var(--text)' }}>SSD / NVMe:</b> TRIM and retrim only. Windows issues retrim through <code className="mono">/L</code>; the file system learns which blocks are free.</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Move3d size={14} color="var(--amber)" />
                <span><b style={{ color: 'var(--text)' }}>HDD:</b> defragmentation moves file fragments together so the head travels less. Long runs are expected on a full disk.</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Power size={14} color="var(--violet)" />
                <span><b style={{ color: 'var(--text)' }}>Boot files:</b> <code className="mono">/B</code> asks Windows to optimize the boot files at the next restart, because they are locked while running.</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <AlertTriangle size={14} color="var(--rose)" />
                <span><b style={{ color: 'var(--text)' }}>Needs Administrator:</b> every write operation returns <code className="mono">0x89000024</code> without elevation. The app never works around that.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3>History</h3>
          <span className="sub">Last 100 runs kept in %APPDATA%\Ultra Harddisk Defrag\history.json</span>
        </div>
        {history.length === 0 ? (
          <EmptyState icon={<Play size={22} />} title="No runs recorded" detail="Completed, cancelled and refused operations all appear here." />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Action</th>
                  <th>Volume</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Fragmented before → after</th>
                  <th>Exit</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td><StateIcon state={entry.state} /></td>
                    <td className="name">{ACTION_LABELS[entry.action]}</td>
                    <td>{entry.volume}</td>
                    <td className="dim">{formatDate(entry.startedAt)}</td>
                    <td className="mono">{formatDuration(entry.durationMs)}</td>
                    <td className="mono">
                      {entry.fragmentedPercentBefore ?? '—'}% → {entry.fragmentedPercentAfter ?? '—'}%
                    </td>
                    <td className="mono">{entry.exitCode ?? '—'}</td>
                    <td><Pill tone={stateTone(entry.state)}>{entry.state}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
