import { useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { Field } from './ui'
import Icon from './Icon'

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

/** Single-select master radio group (Gender) with the same inline add. `value` is the currently
 * selected name (or '' for none) — unlike MasterSelect this renders as visible radio buttons
 * rather than a <select>, since there are normally just two or three options and the client wants
 * them visible and exclusive (picking one visibly un-picks the other) rather than tucked in a
 * dropdown. */
export function MasterRadio({ label, type, categories, value, onChange, onCategoriesReload, hint }) {
  const active = (categories || []).filter((c) => c.status === 'active')
  const extra = value && !active.some((c) => c.name === value) ? [{ id: '__current__', name: value }] : []
  const options = [...active, ...extra]
  const { adding, setAdding, name, setName, busy, commit } = useInlineAdd(type, (newName) => {
    onCategoriesReload()
    onChange(newName)
  })

  return (
    <Field label={label} hint={hint}>
      <div className="chips">
        {options.map((c) => (
          <label key={c.id} className="chip" style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name={`master-radio-${type}`}
              checked={value === c.name}
              onChange={() => onChange(c.name)}
              style={{ marginRight: 4 }}
            />
            {c.name}
            {extra.some((x) => x.name === c.name) ? ' (inactive)' : ''}
          </label>
        ))}
        {value ? (
          <button type="button" className="btn sm ghost" onClick={() => onChange('')}>
            Clear
          </button>
        ) : null}
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

/** Multi-select master checklist (LAPF Domestic/Export) with the same inline add. `values`
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

/** Single-value type-and-search box (Supplier) — a plain text input backed by a native <datalist>
 * of active names, so typing filters the suggestions instead of scrolling a long <select> (there
 * are 40+ suppliers). Typing a name that isn't in the list yet shows a one-click "create as new
 * supplier" button, same end result as the old dropdown's inline "+ Add new…" row. */
export function MasterTypeahead({ label, type, categories, value, onChange, onCategoriesReload, hint }) {
  const active = (categories || []).filter((c) => c.status === 'active')
  const datalistId = `mt-${type}-${label.replace(/\s+/g, '')}`
  const trimmed = (value || '').trim()
  const isNew = trimmed && !active.some((c) => c.name === trimmed)
  const [busy, setBusy] = useState(false)

  async function createAndKeep() {
    setBusy(true)
    try {
      await api.post('/categories', { type, name: trimmed })
      onCategoriesReload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Field label={label} hint={hint}>
      <input list={datalistId} value={value || ''} placeholder="Type to search…" onChange={(e) => onChange(e.target.value)} />
      <datalist id={datalistId}>
        {active.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {isNew ? (
        <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} disabled={busy} onClick={createAndKeep}>
          + Add "{trimmed}" as a new {label.toLowerCase()}
        </button>
      ) : null}
    </Field>
  )
}

/** Multi-value type-and-search box (Additional LAPF Domestic, LAPF Export) — same idea as
 * MasterTypeahead but keeps a list of chips instead of one value. Replaces a checklist of 40+
 * checkboxes with: type a few letters, Enter (or the Add button) to add it as a chip, click a
 * chip's × to remove it. */
export function MasterTagInput({ label, type, categories, values, onChange, onCategoriesReload, hint }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const vals = values || []
  const active = (categories || []).filter((c) => c.status === 'active')
  const datalistId = `tag-${type}-${label.replace(/\s+/g, '')}`

  function addValue(raw) {
    const v = raw.trim()
    if (!v || vals.includes(v)) {
      setDraft('')
      return
    }
    onChange([...vals, v])
    setDraft('')
  }
  function remove(v) {
    onChange(vals.filter((x) => x !== v))
  }

  const draftTrimmed = draft.trim()
  const isNew = draftTrimmed && !active.some((c) => c.name === draftTrimmed)

  async function createAndAdd() {
    setBusy(true)
    try {
      await api.post('/categories', { type, name: draftTrimmed })
      onCategoriesReload()
      addValue(draftTrimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Field label={label} hint={hint}>
      {vals.length ? (
        <div className="chips" style={{ marginBottom: 6 }}>
          {vals.map((v) => (
            <span key={v} className="chip">
              {v}
              <button
                type="button"
                className="btn ghost sm icon-btn"
                style={{ marginLeft: 4, padding: 2 }}
                onClick={() => remove(v)}
                title={`Remove ${v}`}
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ gap: 6 }}>
        <input
          list={datalistId}
          style={{ flex: 1 }}
          placeholder="Type to search, Enter to add…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addValue(draft)
            }
          }}
        />
        <datalist id={datalistId}>
          {active
            .filter((c) => !vals.includes(c.name))
            .map((c) => (
              <option key={c.id} value={c.name} />
            ))}
        </datalist>
        <button type="button" className="btn sm" onClick={() => addValue(draft)}>
          Add
        </button>
      </div>
      {isNew ? (
        <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} disabled={busy} onClick={createAndAdd}>
          + Create "{draftTrimmed}" as a new {label.toLowerCase()} and add it
        </button>
      ) : null}
    </Field>
  )
}
