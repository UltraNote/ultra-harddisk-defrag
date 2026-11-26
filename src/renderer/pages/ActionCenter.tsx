import React from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, ShieldAlert, Sparkles, Wrench } from 'lucide-react'
import type { ActionCenterIssue } from '@shared/types'
import { api } from '../api'
import { useApp } from '../lib/context'
import { EmptyState, Pill } from '../components/ui'

function severityTone(severity: ActionCenterIssue['severity']): 'rose' | 'amber' | 'muted' {
  if (severity === 'high') return 'rose'
  if (severity === 'medium') return 'amber'
  return 'muted'
}

function severityIcon(severity: ActionCenterIssue['severity']): React.JSX.Element {
  if (severity === 'high') return <AlertOctagon size={17} color="var(--rose)" />
  if (severity === 'medium') return <AlertTriangle size={17} color="var(--amber)" />
  return <Info size={17} color="var(--dim)" />
}

export default function ActionCenterPage(): React.JSX.Element {
  const { status, runJob, runJobs, saveSettings, elevate, pushToast, refreshStatus } = useApp()
  const [working, setWorking] = React.useState(false)
  const issues = status?.issues ?? []

  const fixAll = async (): Promise<void> => {
    setWorking(true)
    try {
      const result = await api.fixAll()
      pushToast({
        title: result.fixed ? `${result.fixed} issue(s) fixed` : 'Nothing could be fixed automatically',
        body: `${result.fixed} of ${result.issues} issue(s) addressed. Anything needing elevation or a manual decision stays listed.`,
        level: result.fixed ? 'success' : 'warn'
      })
      await refreshStatus()
    } catch (error) {
      pushToast({ title: 'Fix All could not run', body: String(error), level: 'error' })
    } finally {
      setWorking(false)
    }
  }

  const fixOne = async (issue: ActionCenterIssue): Promise<void> => {
    if (issue.fixId === 'elevate') {
      await elevate()
      return
    }
    if (issue.fixId === 'none') {
      pushToast({ title: 'Manual action needed', body: issue.detail, level: 'warn' })
      return
    }
    if (issue.fixId === 'enable-automation') {
      await saveSettings({ autoDefrag: { enabled: true }, scheduled: { enabled: true } })
      return
    }
    if (issue.fixId === 'analyze') {
      const targets = (status?.volumes ?? []).filter((v) => v.letter && v.kind === 'fixed')
      await runJobs(targets.map((volume) => ({ action: 'analyze', volume: volume.letter! })))
      return
    }
    const [action, volume] = issue.fixId.split(':')
    if (action && volume) {
      await runJob({ action: action === 'retrim' ? 'retrim' : 'optimize', volume })
    }
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Action Center</h1>
          <p>Issues are computed from live state each time the window refreshes — an elevated session, an analyzed volume, a fragmented volume, an untrimmed SSD, an unhealthy disk. No issue appears twice.</p>
        </div>
        <div className="actions">
          {status && !status.elevated ? (
            <button className="btn" onClick={() => void elevate()}>
              <ShieldAlert size={14} /> Elevate
            </button>
          ) : null}
          <button className="btn primary" disabled={working || issues.length === 0} onClick={() => void fixAll()}>
            <Sparkles size={14} /> Fix all
          </button>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        {[
          { label: 'High', value: issues.filter((i) => i.severity === 'high').length, tone: 'rose' as const },
          { label: 'Medium', value: issues.filter((i) => i.severity === 'medium').length, tone: 'amber' as const },
          { label: 'Low', value: issues.filter((i) => i.severity === 'low').length, tone: 'muted' as const }
        ].map((item) => (
          <div key={item.label} className="card pad row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="dim small">{item.label} severity</div>
              <div style={{ fontSize: 20, fontWeight: 650 }}>{item.value}</div>
            </div>
            <Pill tone={item.tone}>{item.value === 0 ? 'clear' : 'open'}</Pill>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Open issues</h3>
          <span className="sub">{issues.length ? `${issues.length} item(s)` : 'all clear'}</span>
        </div>
        {issues.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={24} />} title="Nothing needs attention" detail="Volumes are analyzed, fragmentation is below the threshold and every disk reports healthy." />
        ) : (
          <div className="stack" style={{ padding: 14 }}>
            {issues.map((issue) => (
              <div key={issue.id} className="volume-card" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 10 }}>
                  {severityIcon(issue.severity)}
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <strong style={{ fontSize: 13.5 }}>{issue.title}</strong>
                      <Pill tone={severityTone(issue.severity)}>{issue.severity}</Pill>
                    </div>
                    <div className="dim small" style={{ marginTop: 2 }}>{issue.detail}</div>
                  </div>
                  <button className="btn sm" onClick={() => void fixOne(issue)}>
                    <Wrench size={12} /> {issue.fixId === 'elevate' ? 'Relaunch' : issue.fixId === 'none' ? 'Details' : 'Fix'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3>Session facts</h3>
        </div>
        <div style={{ padding: 18 }} className="stack small">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim">Elevation</span>
            <Pill tone={status?.elevated ? 'green' : 'rose'}>{status?.elevated ? 'Administrator' : 'Standard user'}</Pill>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim">Storage optimizer</span>
            <Pill tone={status?.engineAvailable ? 'green' : 'rose'}>{status?.engineAvailable ? 'defrag.exe available' : 'unavailable'}</Pill>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim">Power source</span>
            <Pill tone={status?.onBattery ? 'amber' : 'green'}>{status?.onBattery ? 'Battery' : 'AC power'}</Pill>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim">Analyzed volumes</span>
            <span>{(status?.volumes ?? []).filter((v) => v.fragmentation).length} / {status?.volumes.length ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
