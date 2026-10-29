import Icon from './Icon'

// Keep only digits, capped at `max` characters (use for pincode etc.)
export function onlyDigits(s, max) {
  const d = String(s ?? '').replace(/\D/g, '')
  return max ? d.slice(0, max) : d
}

// Allow digits plus the characters a phone number legitimately uses
// (+, spaces, hyphens, parentheses) — strips letters and other symbols.
export function cleanPhone(s, max = 20) {
  return String(s ?? '').replace(/[^0-9+\-() ]/g, '').slice(0, max)
}

export function Pill({ text, cls = 'p-mute' }) {
  return <span className={'pill ' + cls}>{text}</span>
}

export function ErrBox({ message }) {
  if (!message) return null
  return <div className="err-box">{message}</div>
}

export function Loading({ text = 'Loading…' }) {
  return <div className="skeleton">{text}</div>
}

export function Empty({ text }) {
  return <div className="empty">{text}</div>
}

export function PageHead({ title, sub, actions }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub ? <p className="hint">{sub}</p> : null}
      </div>
      {actions}
    </div>
  )
}

export function Panel({ title, count, hot, extra, children }) {
  return (
    <div className="card pad0">
      <div className="panel-h">
        <h3>
          {title}
          {count != null ? <span className={'cnt' + (hot && count ? ' hot' : '')}>{count}</span> : null}
        </h3>
        <span className="spacer"></span>
        {extra}
      </div>
      {children}
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      {children}
      {hint ? <small className="hint">{hint}</small> : null}
    </div>
  )
}

export function Modal({ title, onClose, footer, wide, children }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="btn ghost sm icon-btn" onClick={onClose} type="button" title="Close">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer ? <div className="modal-f">{footer}</div> : null}
      </div>
    </div>
  )
}

export function blPill(cat) {
  return <Pill text={'Blacklist ' + cat} cls="p-bad" />
}

export function tagPill(tag) {
  const cls = { Hot: 'p-ok', Warm: 'p-info', Cold: 'p-warn', 'Non-responsive': 'p-bad', New: 'p-mute' }[tag] || 'p-mute'
  return <Pill text={tag} cls={cls} />
}

// Strict dd/mm/yyyy, always — the project standard date format everywhere in the UI, never the
// browser/OS locale's own date style. A date-only value (YYYY-MM-DD, e.g. visit dates, due dates)
// is formatted straight from its own digits rather than round-tripped through `Date`, which would
// apply the browser's local timezone and can silently shift a date-only value to the wrong
// calendar day. A real timestamp (has a time component) is still converted to local time first,
// since that part IS timezone-sensitive.
export function fmtDate(d) {
  if (!d) return '—'
  try {
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/)
    if (m && !String(d).includes('T')) return `${m[3]}/${m[2]}/${m[1]}`
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
  } catch {
    return d
  }
}

export function fmtDateTime(d) {
  if (!d) return '—'
  try {
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d
    const date = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
    const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    return `${date}, ${time}`
  } catch {
    return d
  }
}
