import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { PageHead, Panel, Pill, Loading, ErrBox } from '../components/ui'

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
    <Panel title={title} count={data.length}>
      <p className="hint" style={{ padding: '10px 16px 0', margin: 0 }}>
        {hint}
      </p>
      <table>
        <tr>
          <th>Name</th>
          <th>Used by</th>
          <th>Status</th>
          <th></th>
        </tr>
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
      </table>
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
                  <span className="car">▸</span>
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

export default function Categories() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: fabrics } = useApi(() => api.get('/fabrics'), [])
  const { data: customers } = useApi(() => api.get('/customers'), [])

  const fabricCatCounts = fabrics ? countBy(fabrics, (f) => f.quality_category) : null
  const customerCatCounts = customers ? countBy(customers, (c) => c.category) : null
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
      <div className="grid g2">
        <CategoryBlock title="Fabric categories" hint="Used to group items (swatches) and filter them when logging a visit." type="fabric" canEdit={canEdit} usageCounts={fabricCatCounts} />
        <CategoryBlock title="Customer categories" hint="Used to group customers and filter customers and reports." type="customer" canEdit={canEdit} usageCounts={customerCatCounts} />
      </div>
      <div style={{ marginTop: 16 }}>
        <CountriesStates canEdit={canEdit} countryCounts={countryCounts} stateCounts={stateCounts} />
      </div>
    </div>
  )
}
