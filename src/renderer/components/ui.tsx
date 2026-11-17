import React from 'react'

export function Toggle({
  on,
  onChange,
  disabled,
  title
}: {
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={disabled}
      className={`toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
    />
  )
}

export function Pill({
  children,
  tone = 'muted'
}: {
  children: React.ReactNode
  tone?: 'muted' | 'green' | 'amber' | 'rose' | 'teal' | 'violet'
}): React.JSX.Element {
  return <span className={`pill ${tone}`}>{children}</span>
}

export function Dot({ color }: { color: 'green' | 'amber' | 'rose' | 'dim' }): React.JSX.Element {
  return <span className={`dot ${color}`} />
}

export function DiskMark({ size = 20 }: { size?: number }): React.JSX.Element {
  const id = React.useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`dm-${id}`} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fbbf24" />
          <stop offset="0.55" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <ellipse cx="16" cy="9" rx="11" ry="4.4" stroke={`url(#dm-${id})`} strokeWidth="1.7" fill={`url(#dm-${id})`} fillOpacity="0.14" />
      <path d="M5 9v7c0 2.4 4.9 4.4 11 4.4s11-2 11-4.4V9" stroke={`url(#dm-${id})`} strokeWidth="1.7" />
      <path d="M5 16v7c0 2.4 4.9 4.4 11 4.4s11-2 11-4.4v-7" stroke={`url(#dm-${id})`} strokeWidth="1.7" />
    </svg>
  )
}

/** Real fragmentation level, no invented cluster map. */
export function FragBar({
  percent,
  label,
  height = 8
}: {
  percent: number | null
  label?: string
  height?: number
}): React.JSX.Element {
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent))
  const tone = percent === null ? 'unknown' : value >= 20 ? 'bad' : value >= 10 ? 'warn' : 'good'
  return (
    <div className="frag">
      <div className="frag-track" style={{ height }}>
        {percent === null ? (
          <div className="frag-unknown" />
        ) : (
          <div className={`frag-fill ${tone}`} style={{ width: `${Math.max(1.5, value)}%` }} />
        )}
      </div>
      <span className="frag-label">{label ?? (percent === null ? 'not analyzed' : `${value}% fragmented`)}</span>
    </div>
  )
}

export function FreeBar({ used, total }: { used: number; total: number }): React.JSX.Element {
  const pct = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0
  return (
    <div className="frag">
      <div className="frag-track" style={{ height: 6 }}>
        <div className="frag-fill used" style={{ width: `${pct}%` }} />
      </div>
      <span className="frag-label">{pct.toFixed(0)}% used</span>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  detail
}: {
  icon?: React.ReactNode
  title: string
  detail?: string
}): React.JSX.Element {
  return (
    <div className="empty">
      <div>{icon}</div>
      <div style={{ color: 'var(--muted)', fontWeight: 550 }}>{title}</div>
      {detail ? <div style={{ marginTop: 4, fontSize: 12 }}>{detail}</div> : null}
    </div>
  )
}

export function Modal({
  title,
  description,
  children,
  onClose,
  footer
}: {
  title: string
  description?: string
  children?: React.ReactNode
  onClose: () => void
  footer?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal fade-in" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
        {children}
        <div className="actions">{footer ?? <button className="btn" onClick={onClose}>Close</button>}</div>
      </div>
    </div>
  )
}

export function CommandBlock({ command }: { command: string }): React.JSX.Element {
  return (
    <div className="cmd-block">
      <span className="cmd-prompt">$</span>
      <code>{command}</code>
    </div>
  )
}
