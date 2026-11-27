import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useToast } from '../context/ToastContext'
import { Panel, Pill, Loading, ErrBox } from './ui'
import Icon from './Icon'

// Shared building blocks for the per-master pages under pages/masters/ — each master used to be one
// card on a single bundled "Categories" page; per Urvish's final-review point 1 ("Give all masters
// in a separate link") each now has its own route and its own sidebar link, but they all still
// render with these same three components so the look, the add/activate/deactivate behaviour, and
// the "used by" counts stay identical to how the bundled page worked.

export function CategoryBlock({ title, hint, type, canEdit, usageCounts }) {
  const toast = useToast()
  const { data, error, loading, reload: reloadLocal } = useApi(() => api.get(`/categories/${type}`), [type])
  const [name, setName] = useState('')

  async function toggle(id) {
    try {
      await api.post(`/categories/${id}/toggle`)
      reloadLocal()
    } catch (e) {
      toast(e.message)
    }
  }
  async function add() {
    if (!name.trim()) return
    try {
      await api.post('/categories', { type, name: name.trim() })
      setName('')
      reloadLocal()
    } catch (e) {
      toast(e.message)
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  return (
    <Panel title={title} count={data.length} className="cat-card">
      <p className="hint" style={{ padding: '10px 16px', margin: 0 }}>
        {hint}
      </p>
      {/* Every category card is the same fixed height (see .cat-card) regardless of how many
          rows it holds — a 2-row list and a 46-row list both render as the same-sized card, with
          only this inner area scrolling, so the grid lines up edge to edge instead of some cards
          towering over others. */}
      <div className="cat-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Used by</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data
              .slice()
              .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1))
              .map((x) => (
                <tr key={x.id} className={x.status !== 'active' ? 'row-dim' : ''}>
                  <td>
                    <b>{x.name}</b>
                  </td>
                  <td>{usageCounts ? usageCounts[x.name] || 0 : '—'}</td>
                  <td>
                    <Pill text={x.status === 'active' ? 'Active' : 'Inactive'} cls={x.status === 'active' ? 'p-ok' : 'p-bad'} />
                  </td>
                  <td className="act">
                    {canEdit ? (
                      <button className={'btn sm' + (x.status === 'active' ? ' danger' : '')} onClick={() => toggle(x.id)} type="button">
                        {x.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="row" style={{ padding: '12px 16px' }}>
          <input placeholder="New category name" style={{ maxWidth: 260 }} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={add} type="button">
            Add
          </button>
        </div>
      ) : null}
    </Panel>
  )
}

export function SeasonBlock({ canEdit, usageCounts }) {
  const toast = useToast()
  const { data, error, loading, reload } = useApi(() => api.get('/categories/season'), [])
  const [name, setName] = useState('')
  const [newFrom, setNewFrom] = useState('')
  const [newTo, setNewTo] = useState('')
  const [dateDraft, setDateDraft] = useState({}) // { [id]: { date_from, date_to } }

  async function toggle(id) {
    try {
      await api.post(`/categories/${id}/toggle`)
      reload()
    } catch (e) {
      toast(e.message)
    }
  }
  async function add() {
    if (!name.trim()) return
    try {
      // The create endpoint only takes type+name (categories of every type are created the same
      // way) — From/To is a season-only extra, so it's applied as a second call right after
      // creation, same PATCH the table rows below already use to edit dates post-creation.
      const created = await api.post('/categories', { type: 'season', name: name.trim() })
      if (newFrom || newTo) {
        await api.patch(`/categories/${created.id}/dates`, { date_from: newFrom || null, date_to: newTo || null })
      }
      setName('')
      setNewFrom('')
      setNewTo('')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }
  function draftFor(s) {
    return dateDraft[s.id] || { date_from: s.date_from || '', date_to: s.date_to || '' }
  }
  function setDraft(s, field, value) {
    setDateDraft((d) => ({ ...d, [s.id]: { ...draftFor(s), [field]: value } }))
  }
  async function saveDates(s) {
    const d = draftFor(s)
    try {
      await api.patch(`/categories/${s.id}/dates`, { date_from: d.date_from || null, date_to: d.date_to || null })
      toast('Saved')
      setDateDraft((cur) => {
        const next = { ...cur }
        delete next[s.id]
        return next
      })
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  return (
    <Panel title="Season" count={data.length} className="cat-card">
      <p className="hint" style={{ padding: '10px 16px', margin: 0 }}>
        Used to tag items by season on the Item Master. From/To dates are optional (e.g. AW 27-28 ≈ Jul–Dec) — leave blank if not known.
      </p>
      <div className="cat-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>From</th>
              <th>To</th>
              <th>Used by</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data
              .slice()
              .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1))
              .map((s) => {
                const d = draftFor(s)
                const changed = d.date_from !== (s.date_from || '') || d.date_to !== (s.date_to || '')
                return (
                  <tr key={s.id} className={s.status !== 'active' ? 'row-dim' : ''}>
                    <td>
                      <b>{s.name}</b>
                    </td>
                    <td>
                      <input type="date" style={{ width: 150 }} disabled={!canEdit} value={d.date_from} onChange={(e) => setDraft(s, 'date_from', e.target.value)} />
                    </td>
                    <td>
                      <input type="date" style={{ width: 150 }} disabled={!canEdit} value={d.date_to} onChange={(e) => setDraft(s, 'date_to', e.target.value)} />
                    </td>
                    <td>{usageCounts ? usageCounts[s.name] || 0 : '—'}</td>
                    <td>
                      <Pill text={s.status === 'active' ? 'Active' : 'Inactive'} cls={s.status === 'active' ? 'p-ok' : 'p-bad'} />
                    </td>
                    <td className="act">
                      {canEdit ? (
                        <>
                          {changed ? (
                            <button className="btn sm" onClick={() => saveDates(s)} type="button">
                              Save dates
                            </button>
                          ) : null}{' '}
                          <button className={'btn sm' + (s.status === 'active' ? ' danger' : '')} onClick={() => toggle(s.id)} type="button">
                            {s.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="row" style={{ padding: '12px 16px', flexWrap: 'wrap' }}>
          <input placeholder="New season name" style={{ maxWidth: 200 }} value={name} onChange={(e) => setName(e.target.value)} />
          <input type="date" title="From (optional)" style={{ width: 150 }} value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
          <input type="date" title="To (optional)" style={{ width: 150 }} value={newTo} onChange={(e) => setNewTo(e.target.value)} />
          <button className="btn" onClick={add} type="button">
            Add
          </button>
        </div>
      ) : null}
    </Panel>
  )
}

export function CountriesStates({ canEdit, countryCounts, stateCounts }) {
  const toast = useToast()
  const { data: countries, error, loading, reload } = useApi(() => api.get('/categories/countries/all'), [])
  const [open, setOpen] = useState({})
  const [newCountry, setNewCountry] = useState('')
  const [newState, setNewState] = useState({})

  async function toggleCountry(id) {
    try {
      await api.post(`/categories/countries/${id}/toggle`)
      reload()
    } catch (e) {
      toast(e.message)
    }
  }
  async function toggleState(id) {
    try {
      await api.post(`/categories/states/${id}/toggle`)
      reload()
    } catch (e) {
      toast(e.message)
    }
  }
  async function addCountry() {
    if (!newCountry.trim()) return
    try {
      await api.post('/categories/countries', { name: newCountry.trim() })
      setNewCountry('')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }
  async function addState(countryId) {
    const name = (newState[countryId] || '').trim()
    if (!name) return
    try {
      await api.post(`/categories/countries/${countryId}/states`, { name })
      setNewState((s) => ({ ...s, [countryId]: '' }))
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  return (
    <Panel title="Countries & States" count={countries.length}>
      <p className="hint" style={{ padding: '10px 16px 0', margin: 0 }}>
        Used in registered and contact addresses. Click a country to expand its states.
      </p>
      <div style={{ padding: 12 }}>
        {countries
          .slice()
          .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1))
          .map((c) => {
            const isOpen = !!open[c.id]
            return (
              <div className={'crow' + (isOpen ? ' open' : '')} key={c.id}>
                <div className="ch" onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}>
                  <Icon name="chevron-right" size={11} className="car" />
                  <b>{c.name}</b>
                  <Pill text={c.status === 'active' ? 'Active' : 'Inactive'} cls={c.status === 'active' ? 'p-ok' : 'p-bad'} />
                  <span className="hint">{c.states.length} state{c.states.length === 1 ? '' : 's'}</span>
                  <span className="hint">· used by {countryCounts?.[c.name] || 0}</span>
                  <span className="spacer"></span>
                  {canEdit ? (
                    <button
                      className={'btn sm' + (c.status === 'active' ? ' danger' : '')}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleCountry(c.id)
                      }}
                      type="button"
                    >
                      {c.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  ) : null}
                </div>
                <div className="cb">
                  {c.states.length ? (
                    <table>
                      <tr>
                        <th>State / province</th>
                        <th>Used by</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                      {c.states.map((s) => (
                        <tr key={s.id} className={s.status !== 'active' ? 'row-dim' : ''}>
                          <td>{s.name}</td>
                          <td>{stateCounts?.[s.name] || 0}</td>
                          <td>
                            <Pill text={s.status === 'active' ? 'Active' : 'Inactive'} cls={s.status === 'active' ? 'p-ok' : 'p-bad'} />
                          </td>
                          <td className="act">
                            {canEdit ? (
                              <button className={'btn sm' + (s.status === 'active' ? ' danger' : '')} onClick={() => toggleState(s.id)} type="button">
                                {s.status === 'active' ? 'Deactivate' : 'Activate'}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </table>
                  ) : (
                    <p className="hint" style={{ margin: '0 0 10px' }}>
                      No states/provinces listed for {c.name}.
                    </p>
                  )}
                  {canEdit ? (
                    <div className="row" style={{ paddingTop: 10, gap: 8 }}>
                      <input
                        placeholder={`New state/province for ${c.name}`}
                        style={{ maxWidth: 240 }}
                        value={newState[c.id] || ''}
                        onChange={(e) => setNewState((s) => ({ ...s, [c.id]: e.target.value }))}
                      />
                      <button className="btn sm" onClick={() => addState(c.id)} type="button">
                        Add
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
      </div>
      {canEdit ? (
        <div className="row" style={{ padding: '0 16px 16px' }}>
          <input placeholder="New country name" style={{ maxWidth: 260 }} value={newCountry} onChange={(e) => setNewCountry(e.target.value)} />
          <button className="btn" onClick={addCountry} type="button">
            Add country
          </button>
        </div>
      ) : null}
    </Panel>
  )
}

export function countBy(items, getKey) {
  const out = {}
  for (const item of items) {
    const key = getKey(item)
    if (!key) continue
    out[key] = (out[key] || 0) + 1
  }
  return out
}

// Same as countBy, but getKeys returns an ARRAY of keys per item (for a supplier that can show up
// in Existing Supplier/LAPF Domestic/LAPF Export on the same item — each counts once per item, not
// once per field, so a supplier used in two of the three fields on one item is counted once, not
// twice, same as Set semantics).
export function countByMulti(items, getKeys) {
  const out = {}
  for (const item of items) {
    const keys = new Set((getKeys(item) || []).filter(Boolean))
    for (const key of keys) out[key] = (out[key] || 0) + 1
  }
  return out
}
