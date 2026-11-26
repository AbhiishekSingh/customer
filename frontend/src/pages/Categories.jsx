import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { PageHead, Panel, Pill, Loading, ErrBox } from '../components/ui'
import Icon from '../components/Icon'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

function CategoryBlock({ title, hint, type, canEdit, usageCounts }) {
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

function SeasonBlock({ canEdit, usageCounts }) {
  const toast = useToast()
  const { data, error, loading, reload } = useApi(() => api.get('/categories/season'), [])
  const [name, setName] = useState('')
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
      await api.post('/categories', { type: 'season', name: name.trim() })
      setName('')
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
        <div className="row" style={{ padding: '12px 16px' }}>
          <input placeholder="New season name" style={{ maxWidth: 260 }} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={add} type="button">
            Add
          </button>
        </div>
      ) : null}
    </Panel>
  )
}

function CountriesStates({ canEdit, countryCounts, stateCounts }) {
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

function countBy(items, getKey) {
  const out = {}
  for (const item of items) {
    const key = getKey(item)
    if (!key) continue
    out[key] = (out[key] || 0) + 1
  }
  return out
}

// Same as countBy, but getKeys returns an ARRAY of keys per item (for multi-select Item Master
// fields like gender, or a supplier that can show up in Existing Supplier/LAPF Domestic/LAPF
// Export on the same item — each counts once per item, not once per field, so a supplier used in
// two of the three fields on one item is counted once, not twice, same as Set semantics).
function countByMulti(items, getKeys) {
  const out = {}
  for (const item of items) {
    const keys = new Set((getKeys(item) || []).filter(Boolean))
    for (const key of keys) out[key] = (out[key] || 0) + 1
  }
  return out
}

export default function Categories() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: fabrics } = useApi(() => api.get('/fabrics'), [])
  const { data: customers } = useApi(() => api.get('/customers'), [])
  const { data: visits } = useApi(() => api.get('/visits'), [])

  // quality_category (legacy D&D swatch category) is intentionally not surfaced on this page
  // anymore — it's not part of the Item Master rebuild (see Fabrics.jsx), kept only in the data
  // model/API for backward compatibility with anything else that still reads it.
  const customerCatCounts = customers ? countBy(customers, (c) => c.category) : null
  // Colour variants were removed from the Item Master form, so this no longer counts
  // fabric.colour_variants (a field new items never populate) — it counts actual logged
  // VisitItem.color values instead, matching what the "Colors" master is really used for now.
  const colorCounts = visits
    ? countBy(
        visits.flatMap((v) => v.visit_contacts.flatMap((vc) => vc.items.map((i) => i.color))),
        (name) => name
      )
    : null
  const genderCounts = fabrics ? countByMulti(fabrics, (f) => f.gender) : null
  const seasonCounts = fabrics ? countBy(fabrics, (f) => f.season) : null
  const storyCounts = fabrics ? countBy(fabrics, (f) => f.story) : null
  const supplierCounts = fabrics ? countByMulti(fabrics, (f) => [f.supplier, ...(f.lapf_domestic || []), ...(f.lapf_export || [])]) : null
  const fabricCategoryCounts = fabrics ? countBy(fabrics, (f) => f.fabric_category) : null
  const fabricTypeCounts = fabrics ? countBy(fabrics, (f) => f.fabric_type) : null
  const printTypeCounts = fabrics ? countBy(fabrics, (f) => f.print_type) : null
  const countryCounts = customers ? countBy(customers, (c) => c.country) : null
  const stateCounts = customers
    ? countBy(
        [...customers, ...customers.flatMap((c) => c.contacts || [])],
        (x) => x.state
      )
    : null

  return (
    <div>
      <PageHead title="Categories" sub="Lists used across the system. Categories are never deleted, only deactivated." />
      <h3 style={{ margin: '0 0 8px' }}>Item Master</h3>
      <div className="grid g2">
        <CategoryBlock title="Gender" hint="An item can be tagged both Men's and Women's — used count is per item, not per tag." type="gender" canEdit={canEdit} usageCounts={genderCounts} />
        <SeasonBlock canEdit={canEdit} usageCounts={seasonCounts} />
        <CategoryBlock title="Story" hint="Used to group items by design story on the Item Master." type="story" canEdit={canEdit} usageCounts={storyCounts} />
        <CategoryBlock
          title="Supplier"
          hint="Used for Existing Supplier, Additional LAPF Domestic and LAPF Export on the Item Master — used count counts an item once even if a supplier appears in more than one of those fields on it."
          type="supplier"
          canEdit={canEdit}
          usageCounts={supplierCounts}
        />
        <CategoryBlock title="Fabric Category" hint="Woven or Knit." type="fabric_category" canEdit={canEdit} usageCounts={fabricCategoryCounts} />
        <CategoryBlock title="Fabric Type" hint="e.g. Twill, Jacquard, Dobby — used on the Item Master." type="fabric_type" canEdit={canEdit} usageCounts={fabricTypeCounts} />
        <CategoryBlock title="Print Type" hint="e.g. Dyed, RFD, Digital Print — used on the Item Master." type="print_type" canEdit={canEdit} usageCounts={printTypeCounts} />
      </div>
      <h3 style={{ margin: '20px 0 8px' }}>Other categories</h3>
      <div className="grid g2">
        <CategoryBlock title="Customer categories" hint="Used to group customers and filter customers and reports." type="customer" canEdit={canEdit} usageCounts={customerCatCounts} />
        <CategoryBlock title="Colors" hint="Used when logging which colour was given on a visit." type="color" canEdit={canEdit} usageCounts={colorCounts} />
      </div>
      <div style={{ marginTop: 16 }}>
        <CountriesStates canEdit={canEdit} countryCounts={countryCounts} stateCounts={stateCounts} />
      </div>
    </div>
  )
}
