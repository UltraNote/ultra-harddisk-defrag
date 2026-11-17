import React from 'react'
import { FileSearch, FolderOpen, HardDriveDownload, Loader2, Play, ScanLine } from 'lucide-react'
import type { LargeFileEntry } from '@shared/types'
import { api } from '../api'
import { useApp } from '../lib/context'
import { basename, formatBytes, formatDate } from '../lib/format'
import { EmptyState, Pill } from '../components/ui'

const SIZES = [100, 500, 1024, 5120]

export default function LargeFilesPage(): React.JSX.Element {
  const { status, runJob, pushToast, settings } = useApp()
  const volumes = (status?.volumes ?? []).filter((v) => v.letter && v.kind !== 'cdrom')
  const [volume, setVolume] = React.useState(volumes[0]?.letter ?? 'C:')
  const [minSize, setMinSize] = React.useState(1024)
  const [files, setFiles] = React.useState<LargeFileEntry[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [loading, setLoading] = React.useState(false)
  const [folder, setFolder] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!volumes.some((v) => v.letter === volume) && volumes[0]?.letter) setVolume(volumes[0].letter)
  }, [volumes, volume])

  const scan = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await api.scanLargeFiles({ volume, root: folder ?? undefined, minSizeMb: minSize, limit: 300 })
      setFiles(result)
      setSelected(new Set())
      pushToast({
        title: `${result.length} large file(s)`,
        body: result.length ? `${formatBytes(result.reduce((sum, f) => sum + f.sizeBytes, 0))} across the results.` : 'Nothing above the threshold.',
        level: 'info'
      })
    } catch (err) {
      pushToast({ title: 'Scan failed', body: err instanceof Error ? err.message : String(err), level: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const toggle = (target: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(target)) next.delete(target)
      else next.add(target)
      return next
    })
  }

  const selectedSize = files.filter((f) => selected.has(f.path)).reduce((sum, f) => sum + f.sizeBytes, 0)

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Large files</h1>
          <p>
            Finds the biggest files on a volume, then defragments only what you pick with <code className="mono">defrag.exe /File</code>. A time budget stops the walk on huge or slow disks — when that happens the log says so.
          </p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={async () => {
            const picked = await api.pickFiles('folder')
            if (picked[0]) {
              setFolder(picked[0])
              pushToast({ title: 'Folder selected', body: picked[0], level: 'info' })
            }
          }}>
            <FolderOpen size={14} /> {folder ? basename(folder) : 'Pick a folder'}
          </button>
          <button className="btn primary" disabled={loading} onClick={() => void scan()}>
            {loading ? <Loader2 size={14} className="spin" /> : <ScanLine size={14} />} Scan {folder ? 'folder' : volume}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3>Scope</h3>
          <div className="right">
            <div className="chip-set">
              {volumes.map((v) => (
                <button
                  key={v.id}
                  className={`chip ${!folder && volume === v.letter ? 'on' : ''}`}
                  onClick={() => {
                    setFolder(null)
                    setVolume(v.letter!)
                  }}
                >
                  {v.letter} · {v.mediaType}
                </button>
              ))}
            </div>
            <span className="dim small">minimum size</span>
            <select className="input" style={{ width: 130 }} value={minSize} onChange={(e) => setMinSize(Number(e.target.value))}>
              {SIZES.map((size) => (
                <option key={size} value={size}>
                  {size >= 1024 ? `${size / 1024} GB` : `${size} MB`}
                </option>
              ))}
            </select>
          </div>
        </div>
        {folder ? (
          <div style={{ padding: '10px 18px' }} className="dim small">
            Scanning {folder} instead of a whole volume.{' '}
            <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => setFolder(null)}>Clear folder</button>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Results</h3>
          <span className="sub">{files.length ? `${files.length} file(s)` : 'nothing scanned yet'}</span>
          <div className="right">
            {selected.size > 0 ? <Pill tone="amber">{selected.size} selected · {formatBytes(selectedSize)}</Pill> : null}
            <button
              className="btn sm"
              disabled={files.length === 0}
              onClick={() => setSelected(new Set(files.map((f) => f.path)))}
            >
              Select all
            </button>
            <button
              className="btn sm primary"
              disabled={selected.size === 0 || !status?.elevated}
              title={status?.elevated ? 'Defragment just these files' : 'Needs Administrator'}
              onClick={async () => {
                const target = [...selected]
                if (target.length === 0) return
                await runJob({ action: 'files', volume, files: target })
              }}
            >
              <Play size={13} /> Defrag selected
            </button>
          </div>
        </div>

        {files.length === 0 ? (
          <EmptyState
            icon={<FileSearch size={24} />}
            title="No scan results"
            detail={`Pick a volume and threshold, then Scan. Files ≥ ${minSize >= 1024 ? `${minSize / 1024} GB` : `${minSize} MB`} are listed.`}
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}></th>
                  <th>File</th>
                  <th className="num">Size</th>
                  <th>Modified</th>
                  <th style={{ width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.path}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(file.path)}
                        onChange={() => toggle(file.path)}
                        style={{ accentColor: '#f5b041' }}
                      />
                    </td>
                    <td>
                      <div className="name ellipsis" title={file.path}>{basename(file.path)}</div>
                      <div className="path ellipsis" title={file.path}>{file.path}</div>
                    </td>
                    <td className="num mono">{formatBytes(file.sizeBytes)}</td>
                    <td className="dim">{formatDate(file.modifiedAt)}</td>
                    <td>
                      <button className="btn sm ghost" onClick={() => void api.showInFolder(file.path)}>Show</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="row dim small" style={{ marginTop: 12, gap: 8 }}>
        <HardDriveDownload size={14} />
        {settings.defrag.skipFilesOver1Gb
          ? 'Setting "skip files over 1 GB" is on — the automatic runs never touch these files, only this page does.'
          : 'Files over 1 GB are included in automatic runs when the setting says so; here they are always allowed.'}
      </div>
    </div>
  )
}
