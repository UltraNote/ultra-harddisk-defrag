import React from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import type { LogEntry } from '@shared/types'
import { api } from '../api'
import { useApp } from '../lib/context'
import { formatDate } from '../lib/format'
import { EmptyState, Pill } from '../components/ui'

const CHANNELS: Array<{ id: LogEntry['channel'] | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'optimize', label: 'Optimize' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'health', label: 'Health' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'app', label: 'App' }
]

export default function LogsPage(): React.JSX.Element {
  const { pushToast } = useApp()
  const [channel, setChannel] = React.useState<LogEntry['channel'] | 'all'>('all')
  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setLogs(await api.getLogs(channel === 'all' ? undefined : channel))
    } finally {
      setLoading(false)
    }
  }, [channel])

  React.useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), 5000)
    return () => clearInterval(interval)
  }, [load])

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Logs</h1>
          <p>Every operation, refusal and scheduler decision is written to <code className="mono">%APPDATA%\Ultra Harddisk Defrag\state\logs.json</code>, capped by the log setting.</p>
        </div>
        <div className="actions">
          <button className="btn ghost" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              await api.clearLogs()
              await load()
              pushToast({ title: 'Log cleared', body: 'The log file was emptied.', level: 'info' })
            }}
          >
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="chip-set">
            {CHANNELS.map((item) => (
              <button key={item.id} className={`chip ${channel === item.id ? 'on' : ''}`} onClick={() => setChannel(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="right">
            <Pill tone="muted">{logs.length} entries</Pill>
          </div>
        </div>
        {logs.length === 0 ? (
          <EmptyState title="Nothing logged yet" detail="Start an analysis or an optimization and the output lands here." />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Time</th>
                  <th style={{ width: 90 }}>Level</th>
                  <th style={{ width: 100 }}>Channel</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td className="dim mono">{formatDate(entry.at)}</td>
                    <td>
                      <Pill tone={entry.level === 'error' ? 'rose' : entry.level === 'warn' ? 'amber' : 'green'}>{entry.level}</Pill>
                    </td>
                    <td className="dim">{entry.channel}</td>
                    <td>
                      <div>{entry.message}</div>
                      {entry.detail ? <div className="path mono" style={{ marginTop: 2 }}>{entry.detail}</div> : null}
                    </td>
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
