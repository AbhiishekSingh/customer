import { useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { Field } from './ui'

// Shared "+ Add new…" inline-add behaviour for a master-backed select/checklist on a form (Item
// Master fields: Gender, Season, Story, Supplier, Fabric Category, Fabric Type, Print Type).
// Commits the new value to the categories master immediately via POST /categories (so it survives
// even if the surrounding form is cancelled without saving), then calls onAdded(name) so the
// caller can both refresh its category list and select the newly-added value.
function useInlineAdd(type, onAdded) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function commit() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await api.post('/categories', { type, name: trimmed })
      setAdding(false)
      setName('')
      onAdded(trimmed)
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  return { adding, setAdding, name, setName, busy, commit }
}

/** Single-select master dropdown with a leading blank option and an inline "+ Add new…" row.
 * `categories` is the active+inactive list for this type (e.g. from useApi(() => api.get(`/categories/${type}`))).
 * `value` is the currently-set name (kept even if it's since been deactivated, so editing an
 * older item never silently blanks its value — see `extra` below). */
export function MasterSelect({ label, type, categories, value, onChange, onCategoriesReload, hint }) {
  const active = (categories || []).filter((c) => c.status === 'active')
  const extra = value && !active.some((c) => c.name === value) ? [{ id: '__current__', name: value }] : []
  const options = [...active, ...extra]
  const { adding, setAdding, name, setName, busy, commit } = useInlineAdd(type, (newName) => {
    onCategoriesReload()
    onChange(newName)
  })

  return (
    <Field label={label} hint={hint}>
      <select
        value={value || ''}
        onChange={(e) => {
          if (e.target.value === '__add__') {
            setAdding(true)
            return
          }
          onChange(e.target.value)
        }}
      >
        <option value="">— not set —</option>
        {options.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
            {extra.some((x) => x.name === c.name) ? ' (inactive)' : ''}
          </option>
        ))}
        <option value="__add__">+ Add new…</option>
      </select>
      {adding ? (
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <input
            autoFocus
            style={{ flex: 1 }}
            placeholder={`New ${label.toLowerCase()}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
          />
          <button type="button" className="btn sm" disabled={busy} onClick={commit}>
            Add
          </button>
          <button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : null}
    </Field>
  )
}

/** Multi-select master checklist (Gender, LAPF Domestic/Export) with the same inline add. `values`
 * is the current array of selected names. */
export function MasterChecklist({ label, type, categories, values, onChange, onCategoriesReload, hint }) {
  const vals = values || []
  const active = (categories || []).filter((c) => c.status === 'active')
  const extras = vals.filter((v) => !active.some((c) => c.name === v)).map((v, i) => ({ id: '__current__' + i, name: v }))
  const options = [...active, ...extras]
  const { adding, setAdding, name, setName, busy, commit } = useInlineAdd(type, (newName) => {
    onCategoriesReload()
    onChange([...vals, newName])
  })

  function toggle(n) {
    onChange(vals.includes(n) ? vals.filter((x) => x !== n) : [...vals, n])
  }

  return (
    <Field label={label} hint={hint}>
      <div className="chips">
        {options.map((c) => (
          <label key={c.id} className="chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={vals.includes(c.name)} onChange={() => toggle(c.name)} style={{ marginRight: 4 }} />
            {c.name}
            {extras.some((x) => x.name === c.name) ? ' (inactive)' : ''}
          </label>
        ))}
        {!options.length ? <span className="hint">None set up yet — add one below.</span> : null}
      </div>
      {adding ? (
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <input
            autoFocus
            style={{ flex: 1 }}
            placeholder={`New ${label.toLowerCase()}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
          />
          <button type="button" className="btn sm" disabled={busy} onClick={commit}>
            Add
          </button>
          <button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>
          + Add new…
        </button>
      )}
    </Field>
  )
}
