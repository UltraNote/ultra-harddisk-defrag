import React from 'react'
import { FolderPlus, Gamepad2, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import type { LibraryEntry } from '@shared/types'
import { api } from '../api'
import { useApp } from '../lib/context'
import { formatBytes } from '../lib/format'
import { EmptyState, Pill } from '../components/ui'

export default function LibrariesPage(): React.JSX.Element {
  const { status, runJob, pushToast } = useApp()
  const [libraries, setLibraries] = React.useState<LibraryEntry[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setLibraries(await api.getLibraries())
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Game &amp; app boost</h1>
          <p>
            Steam and Epic library folders are read from their own manifests (<code className="mono">libraryfolders.vdf</code>, Epic <code className="mono">.item</code> files). Sizes are measured on demand; folders you add yourself are stored in the app's own state file.
          </p>
        </div>
        <div className="actions">
          <button className="btn ghost" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Rescan
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              const picked = await api.pickFiles('folder')
              if (!picked[0]) return
              await api.addLibrary(picked[0])
              pushToast({ title: 'Library added', body: picked[0], level: 'info' })
              await load()
            }}
          >
            <FolderPlus size={14} /> Add folder
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Libraries</h3>
          <span className="sub">{libraries.length} found</span>
          <div className="right">
            <Pill tone="teal">SDD libraries get TRIM</Pill>
            <Pill tone="amber">HDD libraries get defrag</Pill>
          </div>
        </div>

        {loading && libraries.length === 0 ? (
          <div className="empty"><Loader2 size={20} className="spin" /> Measuring library sizes…</div>
        ) : libraries.length === 0 ? (
          <EmptyState
            icon={<Gamepad2 size={24} />}
            title="No game or app libraries found"
            detail="Install Steam or Epic, or add a folder manually — anything from a game drive to a projects directory."
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Media</th>
                  <th className="num">Size</th>
                  <th>Path</th>
                  <th style={{ width: 200 }}></th>
                </tr>
              </thead>
              <tbody>
                {libraries.map((library) => (
                  <tr key={library.id}>
                    <td className="name">{library.name}</td>
                    <td><Pill tone="violet">{library.provider}</Pill></td>
                    <td>
                      <Pill tone={library.onSsd ? 'teal' : library.mediaType === 'HDD' ? 'amber' : 'muted'}>
                        {library.mediaType}
                      </Pill>
                    </td>
                    <td className="num mono">{formatBytes(library.sizeBytes)}</td>
                    <td className="path ellipsis" title={library.path} style={{ maxWidth: 320 }}>{library.path}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button className="btn sm ghost" onClick={() => void api.openPath(library.path)}>Open</button>
                        <button
                          className="btn sm primary"
                          disabled={!library.volumeLetter}
                          onClick={() => {
                            if (!library.volumeLetter) return
                            void runJob({ action: library.onSsd ? 'retrim' : 'optimize', volume: library.volumeLetter })
                          }}
                        >
                          <Play size={12} /> {library.onSsd ? 'Retrim volume' : 'Optimize volume'}
                        </button>
                        {library.provider === 'Manual' ? (
                          <button
                            className="btn sm danger"
                            onClick={async () => {
                              await api.removeLibrary(library.path)
                              await load()
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: '12px 18px' }} className="dim small">
          Detected volumes: {(status?.volumes ?? []).filter((v) => v.letter).map((v) => `${v.letter} ${v.mediaType}`).join(' · ') || 'none'}
        </div>
      </div>
    </div>
  )
}
