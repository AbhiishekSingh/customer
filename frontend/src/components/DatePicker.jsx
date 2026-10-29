import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function pad2(n) {
  return String(n).padStart(2, '0')
}

// yyyy-mm-dd (what every caller's state already holds, and what the backend expects) <-> dd/mm/yyyy
function isoToDisplay(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}
function displayToIso(display) {
  const m = String(display).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const d = Number(dd), mo = Number(mm), y = Number(yyyy)
  if (mo < 1 || mo > 12) return null
  const daysInMonth = new Date(y, mo, 0).getDate()
  if (d < 1 || d > daysInMonth) return null
  return `${yyyy}-${mm}-${dd}`
}
// Auto-inserts the two '/' separators as the person types digits, same UX as a card-expiry field.
function autoSlash(raw, prevDisplay) {
  const digitsOnly = raw.replace(/[^\d]/g, '')
  // Deleting a character (raw shorter than before) should never re-insert a slash we just removed.
  if (raw.length < prevDisplay.length) return raw
  let out = digitsOnly.slice(0, 8)
  if (out.length > 4) out = `${out.slice(0, 2)}/${out.slice(2, 4)}/${out.slice(4)}`
  else if (out.length > 2) out = `${out.slice(0, 2)}/${out.slice(2)}`
  return out
}

/**
 * dd/mm/yyyy date input — a drop-in replacement for `<input type="date">` whose own displayed
 * format otherwise follows the browser/OS locale rather than the project's dd/mm/yyyy standard.
 * Keeps the exact same public contract every caller already uses: `value`/`min`/`max` are plain
 * yyyy-mm-dd strings, and `onChange` is called with a `{ target: { value: isoString } }` object —
 * so swapping the tag is a one-line change, no caller's handler needs to change.
 */
export default function DatePicker({ value, onChange, min, max, required, disabled, style, placeholder }) {
  const [text, setText] = useState(() => isoToDisplay(value))
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => {
    const d = value ? new Date(value) : new Date()
    return Number.isNaN(d.getTime()) ? new Date() : d
  })
  const wrapRef = useRef(null)

  useEffect(() => {
    setText(isoToDisplay(value))
  }, [value])

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function fire(iso) {
    onChange({ target: { value: iso } })
  }

  function inRange(iso) {
    if (min && iso < min) return false
    if (max && iso > max) return false
    return true
  }

  function handleTextChange(e) {
    const next = autoSlash(e.target.value, text)
    setText(next)
    const iso = displayToIso(next)
    if (iso && inRange(iso)) {
      fire(iso)
      setViewMonth(new Date(iso))
    } else if (next === '') {
      fire('')
    }
  }

  function handleBlur() {
    // An incomplete or invalid typed value reverts to the last good one rather than left dangling
    // half-typed — the field never silently holds text that isn't a real, in-range date.
    setText(isoToDisplay(value))
  }

  function pickDay(d) {
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    if (!inRange(iso)) return
    setText(isoToDisplay(iso))
    fire(iso)
    setOpen(false)
  }

  function changeMonth(delta) {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))
  }

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayIso = (() => {
    const t = new Date()
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`
  })()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="datepicker" ref={wrapRef} style={{ position: 'relative', ...style }}>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={placeholder || 'dd/mm/yyyy'}
        disabled={disabled}
        required={required}
        onChange={handleTextChange}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        maxLength={10}
        style={{ paddingRight: 30 }}
      />
      <button
        type="button"
        className="dp-toggle"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Open calendar"
      >
        <Icon name="calendar" size={14} />
      </button>
      {open && !disabled ? (
        <div className="dp-pop">
          <div className="dp-head">
            <button type="button" className="btn ghost sm" onClick={() => changeMonth(-1)}>
              ‹
            </button>
            <b>
              {MONTHS[month]} {year}
            </b>
            <button type="button" className="btn ghost sm" onClick={() => changeMonth(1)}>
              ›
            </button>
          </div>
          <div className="dp-grid dp-dow">
            {DOW.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="dp-grid">
            {cells.map((d, i) => {
              if (d == null) return <span key={i} />
              const iso = `${year}-${pad2(month + 1)}-${pad2(d)}`
              const selected = iso === value
              const disabledDay = !inRange(iso)
              const isToday = iso === todayIso
              return (
                <button
                  type="button"
                  key={i}
                  className={'dp-day' + (selected ? ' sel' : '') + (isToday && !selected ? ' today' : '')}
                  disabled={disabledDay}
                  onClick={() => pickDay(new Date(year, month, d))}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <div className="dp-foot">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                const t = new Date()
                if (inRange(todayIso)) pickDay(t)
              }}
            >
              Today
            </button>
            {value ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setText('')
                  fire('')
                  setOpen(false)
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
