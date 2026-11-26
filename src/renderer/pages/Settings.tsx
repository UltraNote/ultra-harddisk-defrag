import React from 'react'
import { ExternalLink, Info, Plus, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../lib/context'
import { Pill, Toggle } from '../components/ui'

type Section = 'general' | 'defrag' | 'exclusions' | 'notifications' | 'log' | 'about'

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'defrag', label: 'Defrag behaviour' },
  { id: 'exclusions', label: 'Excluded volumes' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'log', label: 'Log & storage' },
  { id: 'about', label: 'About' }
]

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="grow">
        <div className="label">{label}</div>
        {desc ? <div className="desc">{desc}</div> : null}
      </div>
      <div className="control">{children}</div>
    </div>
  )
}

export default function SettingsPage(): React.JSX.Element {
  const { settings, saveSettings, resetSettings, status, pushToast } = useApp()
  const [section, setSection] = React.useState<Section>('general')
  const [exclusion, setExclusion] = React.useState('')

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Changes apply immediately and are written to <code className="mono">settings.json</code>. Nothing here enables hidden drivers, services or kernel components.</p>
        </div>
        <div className="actions">
          <Pill tone="muted">v{status?.appVersion ?? '1.0.0'}</Pill>
        </div>
      </div>

      <div className="settings-shell">
        <div className="card settings-nav">
          {SECTIONS.map((item) => (
            <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="card">
          {section === 'general' ? (
            <>
              <div className="card-head"><h3>General</h3></div>
              <Row label="Minimize to tray on close" desc="Closing the window keeps the app and its scheduler alive in the notification area.">
                <Toggle on={settings.general.minimizeToTray} onChange={(next) => void saveSettings({ general: { minimizeToTray: next } })} />
              </Row>
              <Row label="Start with Windows" desc="Writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run. No service is installed.">
                <Toggle on={settings.general.autoStart} onChange={(next) => void saveSettings({ general: { autoStart: next } })} />
              </Row>
              <Row label="Tray notifications" desc="Show a balloon when a scheduled or automatic run finishes.">
                <Toggle on={settings.general.trayNotifications} onChange={(next) => void saveSettings({ general: { trayNotifications: next } })} />
              </Row>
              <Row label="Hide removable volumes" desc="Hide volumes Windows identifies as removable.">
                <Toggle on={settings.general.hideRemovable} onChange={(next) => void saveSettings({ general: { hideRemovable: next } })} />
              </Row>
              <Row label="Language" desc="Only English ships in 1.0; the string table is in the open.">
                <select className="input" style={{ width: 150 }} value={settings.general.language} onChange={(e) => void saveSettings({ general: { language: e.target.value } })}>
                  <option value="English">English</option>
                </select>
              </Row>
            </>
          ) : null}

          {section === 'defrag' ? (
            <>
              <div className="card-head"><h3>Defrag behaviour</h3></div>
              <Row label="Battery guard" desc="Automatic runs are skipped while the machine runs on battery.">
                <Toggle on={settings.defrag.batteryGuard} onChange={(next) => void saveSettings({ defrag: { batteryGuard: next } })} />
              </Row>
            </>
          ) : null}

          {section === 'exclusions' ? (
            <>
              <div className="card-head">
                <h3>Excluded volumes</h3>
                <span className="sub">Automatic and scheduled runs skip these letters</span>
              </div>
              <div style={{ padding: '14px 18px' }}>
                <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
                  {settings.defrag.excludeList.map((letter) => (
                    <span key={letter} className="chip on">
                      {letter}
                      <button
                        style={{ marginLeft: 6, color: 'var(--rose)' }}
                        onClick={() => void saveSettings({ defrag: { excludeList: settings.defrag.excludeList.filter((l) => l !== letter) } })}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {settings.defrag.excludeList.length === 0 ? <span className="dim small">Nothing excluded — every fixed volume is eligible.</span> : null}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input"
                    style={{ width: 120 }}
                    placeholder="D:"
                    value={exclusion}
                    onChange={(e) => setExclusion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      const letter = exclusion.trim().toUpperCase().slice(0, 1)
                      if (!letter) return
                      void saveSettings({ defrag: { excludeList: [...new Set([...settings.defrag.excludeList, letter])] } })
                      setExclusion('')
                    }}
                  />
                  <button
                    className="btn sm"
                    onClick={() => {
                      const letter = exclusion.trim().toUpperCase().slice(0, 1)
                      if (!letter) return
                      void saveSettings({ defrag: { excludeList: [...new Set([...settings.defrag.excludeList, letter])] } })
                      setExclusion('')
                    }}
                  >
                    <Plus size={12} /> Exclude
                  </button>
                  <button className="btn sm ghost" onClick={async () => {
                    const picked = await api.pickFiles('folder')
                    const letter = picked[0]?.slice(0, 1).toUpperCase()
                    if (!letter) return
                    await saveSettings({ defrag: { excludeList: [...new Set([...settings.defrag.excludeList, letter])] } })
                    pushToast({ title: 'Volume excluded', body: `${letter}: will be skipped`, level: 'info' })
                  }}>
                    From folder…
                  </button>
                </div>
              </div>
              <div style={{ padding: '0 18px 16px' }} className="dim small">
                Manual runs from the Defrag page still work on excluded volumes — the list only affects automatic and scheduled work.
              </div>
            </>
          ) : null}

          {section === 'notifications' ? (
            <>
              <div className="card-head"><h3>Notifications</h3></div>
              <Row label="Toast duration">
                <input
                  className="input"
                  style={{ width: 80 }}
                  type="number"
                  min={2}
                  max={30}
                  value={settings.notifications.displaySeconds}
                  onChange={(e) => void saveSettings({ notifications: { displaySeconds: Math.max(2, Math.min(30, Number(e.target.value) || 5)) } })}
                />
                <span className="dim small">seconds</span>
              </Row>
              <Row label="Notify when an optimization finishes">
                <Toggle on={settings.notifications.optimizeComplete} onChange={(next) => void saveSettings({ notifications: { optimizeComplete: next } })} />
              </Row>
              <Row label="Warn about disk health">
                <Toggle on={settings.notifications.healthWarning} onChange={(next) => void saveSettings({ notifications: { healthWarning: next } })} />
              </Row>
            </>
          ) : null}

          {section === 'log' ? (
            <>
              <div className="card-head"><h3>Log &amp; storage</h3></div>
              <Row label="Maximum log entries" desc="Older entries are dropped first; the file never grows without bound.">
                <input
                  className="input"
                  style={{ width: 100 }}
                  type="number"
                  min={50}
                  max={5000}
                  value={settings.log.maxEntries}
                  onChange={(e) => void saveSettings({ log: { maxEntries: Math.max(50, Math.min(5000, Number(e.target.value) || 500)) } })}
                />
              </Row>
              <Row label="Clear all logs" desc="Deletes state\logs.json entries.">
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    await api.clearLogs()
                    pushToast({ title: 'Log cleared', body: 'State file emptied.', level: 'info' })
                  }}
                >
                  Clear
                </button>
              </Row>
              <Row label="Restore defaults" desc="Every setting returns to the shipped default; the history and log files are kept.">
                <button
                  className="btn sm"
                  onClick={() => void resetSettings()}
                >
                  <RotateCcw size={12} /> Reset
                </button>
              </Row>
            </>
          ) : null}

          {section === 'about' ? (
            <>
              <div className="card-head"><h3>About</h3></div>
              <div style={{ padding: 18 }} className="stack small">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="dim">Application</span>
                  <span>Ultra Harddisk Defrag {status?.appVersion ?? '1.0.0'}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="dim">Engine</span>
                  <span className="mono">defrag.exe (Windows storage optimizer)</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="dim">Host</span>
                  <span className="mono">{status?.host ?? '—'} · {status?.os ?? '—'}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="dim">Elevation</span>
                  <Pill tone={status?.elevated ? 'green' : 'rose'}>{status?.elevated ? 'Administrator' : 'Standard user'}</Pill>
                </div>
                <div className="divider" />
                <div className="row" style={{ gap: 8 }}>
                  <ShieldCheck size={15} color="var(--teal)" />
                  <span>No third-party driver, service or bundled binary is installed. Optimizations are executed by Microsoft's signed defrag.exe; every command line is shown before it runs.</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Info size={15} color="var(--amber)" />
                  <span>Documentation lives in the app folder under <code className="mono">docs\</code>: user guide, feature list, roadmap and reverse-engineering notes.</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <ExternalLink size={15} color="var(--muted)" />
                  <span>Source: <span className="mono">github.com/UltraNote/ultra-harddisk-defrag</span></span>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
