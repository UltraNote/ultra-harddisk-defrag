import React from 'react'
import { CalendarClock, Moon, Play, Power, Plus, Timer, X } from 'lucide-react'
import type { DefragAction } from '@shared/types'
import { api } from '../api'
import { useApp } from '../lib/context'
import { ACTION_LABELS } from '../lib/format'
import { Pill, Toggle } from '../components/ui'

const ACTIONS: DefragAction[] = ['optimize', 'quick', 'traditional', 'retrim']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function SettingRow({
  label,
  desc,
  children
}: {
  label: string
  desc?: string
  children: React.ReactNode
}): React.JSX.Element {
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

export default function SchedulePage(): React.JSX.Element {
  const { settings, saveSettings, status, runJob, pushToast, busy } = useApp()
  const systemVolume = status?.volumes.find((volume) => volume.isSystem)
  const [program, setProgram] = React.useState('')

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>Schedule &amp; automation</h1>
          <p>
            Idle optimization and scheduled runs require an Administrator session. The battery guard and silent-mode program list apply to both.
          </p>
        </div>
        <div className="actions">
          {status?.scheduledNext ? <Pill tone="amber">Next: {new Date(status.scheduledNext).toLocaleString()}</Pill> : null}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3><Timer size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Auto Defrag</h3>
          <span className="sub">Analyze while idle, optimize only what needs it</span>
        </div>
        <SettingRow label="Enabled" desc="Requires Administrator rights; disabled automatically when running unelevated.">
          <Toggle on={settings.autoDefrag.enabled} onChange={(next) => void saveSettings({ autoDefrag: { enabled: next } })} />
        </SettingRow>
        <SettingRow label="Fragmentation threshold" desc="Volumes below this level are left alone.">
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            min={1}
            max={50}
            value={settings.autoDefrag.thresholdPercent}
            onChange={(e) => void saveSettings({ autoDefrag: { thresholdPercent: Math.max(1, Math.min(50, Number(e.target.value) || 1)) } })}
          />
          <span className="dim small">%</span>
        </SettingRow>
        <SettingRow label="Idle time before starting" desc="Measured with GetLastInputInfo through powerMonitor.">
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            min={1}
            max={180}
            value={settings.autoDefrag.idleMinutes}
            onChange={(e) => void saveSettings({ autoDefrag: { idleMinutes: Math.max(1, Number(e.target.value) || 1) } })}
          />
          <span className="dim small">min</span>
        </SettingRow>
        <SettingRow label="Operation">
          <select
            className="input"
            style={{ width: 220 }}
            value={settings.autoDefrag.action}
            onChange={(e) => void saveSettings({ autoDefrag: { action: e.target.value as DefragAction } })}
          >
            {ACTIONS.map((action) => (
              <option key={action} value={action}>{ACTION_LABELS[action]}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Notify when finished">
          <Toggle on={settings.autoDefrag.notify} onChange={(next) => void saveSettings({ autoDefrag: { notify: next } })} />
        </SettingRow>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3><CalendarClock size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Scheduled defrag</h3>
          <span className="sub">Checked every 30 seconds while the app is running</span>
        </div>
        <SettingRow label="Enabled">
          <Toggle on={settings.scheduled.enabled} onChange={(next) => void saveSettings({ scheduled: { enabled: next } })} />
        </SettingRow>
        <SettingRow label="Cadence">
          <select
            className="input"
            style={{ width: 140 }}
            value={settings.scheduled.cadence}
            onChange={(e) => void saveSettings({ scheduled: { cadence: e.target.value as 'daily' | 'weekly' | 'monthly' } })}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {settings.scheduled.cadence === 'weekly' ? (
            <select
              className="input"
              style={{ width: 130 }}
              value={settings.scheduled.weekday}
              onChange={(e) => void saveSettings({ scheduled: { weekday: Number(e.target.value) } })}
            >
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>{day}</option>
              ))}
            </select>
          ) : null}
          {settings.scheduled.cadence === 'monthly' ? (
            <select
              className="input"
              style={{ width: 110 }}
              value={settings.scheduled.dayOfMonth}
              onChange={(e) => void saveSettings({ scheduled: { dayOfMonth: Number(e.target.value) } })}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>Day {day}</option>
              ))}
            </select>
          ) : null}
        </SettingRow>
        <SettingRow label="Time">
          <input
            className="input"
            style={{ width: 70 }}
            type="number"
            min={0}
            max={23}
            value={settings.scheduled.hour}
            onChange={(e) => void saveSettings({ scheduled: { hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) } })}
          />
          <span className="dim">:</span>
          <input
            className="input"
            style={{ width: 70 }}
            type="number"
            min={0}
            max={59}
            value={settings.scheduled.minute}
            onChange={(e) => void saveSettings({ scheduled: { minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) } })}
          />
        </SettingRow>
        <SettingRow label="Operation">
          <select
            className="input"
            style={{ width: 220 }}
            value={settings.scheduled.action}
            onChange={(e) => void saveSettings({ scheduled: { action: e.target.value as DefragAction } })}
          >
            {ACTIONS.map((action) => (
              <option key={action} value={action}>{ACTION_LABELS[action]}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Notify when finished">
          <Toggle on={settings.scheduled.notify} onChange={(next) => void saveSettings({ scheduled: { notify: next } })} />
        </SettingRow>
        <SettingRow label="Shut down the PC afterwards" desc="Only when every volume finished successfully. A 60-second countdown is shown and can be cancelled.">
          <Toggle on={settings.scheduled.shutdownAfter} onChange={(next) => void saveSettings({ scheduled: { shutdownAfter: next } })} />
        </SettingRow>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3><Power size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Boot time optimization</h3>
          </div>
          <div style={{ padding: 16 }}>
            <button
              className="btn"
              disabled={busy || systemVolume?.mediaType !== 'HDD' || !systemVolume.letter}
              onClick={() => systemVolume?.letter && void runJob({ action: 'bootOptimize', volume: systemVolume.letter })}
            >
              <Play size={14} /> Run boot-file optimization
            </button>
            <div className="dim small" style={{ marginTop: 8 }}>
              Windows runs <code className="mono">defrag.exe /B</code> on a detected system HDD.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3><Moon size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Silent mode &amp; after-task</h3>
          </div>
          <SettingRow label="Silent while these programs run" desc="Process names are compared case-insensitively; automatic runs are skipped while any is running.">
            <Toggle on={settings.silentMode.enabled} onChange={(next) => void saveSettings({ silentMode: { enabled: next } })} />
          </SettingRow>
          <div style={{ padding: '0 18px 14px' }}>
            <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
              {settings.silentMode.programs.map((item) => (
                <span key={item} className="chip on">
                  {item}
                  <button
                    style={{ marginLeft: 6, color: 'var(--rose)' }}
                    onClick={() => void saveSettings({ silentMode: { programs: settings.silentMode.programs.filter((p) => p !== item) } })}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {settings.silentMode.programs.length === 0 ? <span className="dim small">No programs listed.</span> : null}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input"
                placeholder="Game.exe or process name"
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && program.trim()) {
                    void saveSettings({ silentMode: { programs: [...new Set([...settings.silentMode.programs, program.trim()])] } })
                    setProgram('')
                  }
                }}
              />
              <button
                className="btn sm"
                onClick={() => {
                  if (!program.trim()) return
                  void saveSettings({ silentMode: { programs: [...new Set([...settings.silentMode.programs, program.trim()])] } })
                  setProgram('')
                }}
              >
                <Plus size={12} /> Add
              </button>
              <button
                className="btn sm ghost"
                onClick={async () => {
                  const picked = await api.pickFiles('file')
                  const target = picked[0]
                  if (!target) return
                  const name = target.split(/[\\/]/).pop() ?? target
                  await saveSettings({ silentMode: { programs: [...new Set([...settings.silentMode.programs, name])] } })
                  pushToast({ title: 'Added to silent list', body: name, level: 'info' })
                }}
              >
                Browse
              </button>
            </div>
          </div>
          <SettingRow label="After a finished run" desc="Power state change with a visible countdown; nothing happens while the setting is none.">
            <select
              className="input"
              style={{ width: 140 }}
              value={settings.afterTask.action}
              onChange={(e) => void saveSettings({ afterTask: { action: e.target.value as typeof settings.afterTask.action } })}
            >
              <option value="none">Do nothing</option>
              <option value="sleep">Sleep</option>
              <option value="hibernate">Hibernate</option>
              <option value="shutdown">Shut down</option>
              <option value="restart">Restart</option>
            </select>
            <input
              className="input"
              style={{ width: 80 }}
              type="number"
              min={10}
              max={600}
              value={settings.afterTask.delaySeconds}
              onChange={(e) => void saveSettings({ afterTask: { delaySeconds: Math.max(10, Number(e.target.value) || 10) } })}
            />
            <span className="dim small">s</span>
          </SettingRow>
        </div>
      </div>
    </div>
  )
}
