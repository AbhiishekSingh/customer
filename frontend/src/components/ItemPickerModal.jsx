import { useMemo, useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Modal, Field } from './ui'

/** Searchable/filterable modal over the active Item Master, for picking a Sort No. on a Customer
 * Visit Entry line. Needed once the Item Master rebuild took it from a handful of demo items to
 * ~200 real ones (plain browser autocomplete on a <datalist> doesn't scale well past a few dozen).
 * Typing a code directly into the line's own input still works unchanged — this is an additional,
 * easier way to find one, not a replacement for it.
 *
 * `fabrics` is the already-fetched active fabric list (NewVisitEntry already loads it) — this
 * modal only fetches the handful of category lists it needs for the filter dropdowns. */
export default function ItemPickerModal({ fabrics, onChoose, onClose }) {
  const [q, setQ] = useState('')
  const [gender, setGender] = useState('')
  const [season, setSeason] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState('')
  const [supplier, setSupplier] = useState('')

  const { data: genders } = useApi(() => api.get('/categories/gender'), [])
  const { data: seasons } = useApi(() => api.get('/categories/season'), [])
  const { data: categories } = useApi(() => api.get('/categories/fabric_category'), [])
  const { data: types } = useApi(() => api.get('/categories/fabric_type'), [])
  const { data: suppliers } = useApi(() => api.get('/categories/supplier'), [])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let rows = fabrics || []
    if (needle) {
      rows = rows.filter((f) => `${f.code} ${f.development_no || ''} ${f.supplier || ''}`.toLowerCase().includes(needle))
    }
    if (gender) rows = rows.filter((f) => (f.gender || []).includes(gender))
    if (season) rows = rows.filter((f) => f.season === season)
    if (category) rows = rows.filter((f) => f.fabric_category === category)
    if (type) rows = rows.filter((f) => f.fabric_type === type)
    if (supplier) rows = rows.filter((f) => f.supplier === supplier)
    return rows
  }, [fabrics, q, gender, season, category, type, supplier])

  const shown = results.slice(0, 200)

  function opts(list) {
    return (list || []).filter((c) => c.status === 'active').map((c) => (
      <option key={c.id} value={c.name}>
        {c.name}
      </option>
    ))
  }

  return (
    <Modal title="Choose an item" wide onClose={onClose} footer={<button className="btn" onClick={onClose} type="button">Close</button>}>
      <div className="grid g3">
        <Field label="Search">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sort no., Dev no., supplier…" />
        </Field>
        <Field label="Gender">
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">All</option>
            {opts(genders)}
          </select>
        </Field>
        <Field label="Season">
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="">All</option>
            {opts(seasons)}
          </select>
        </Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {opts(categories)}
          </select>
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {opts(types)}
          </select>
        </Field>
        <Field label="Supplier">
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">All</option>
            {opts(suppliers)}
          </select>
        </Field>
      </div>
      <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 10 }}>
        {shown.length ? (
          <table className="ie-table">
            <tr>
              <th>Code</th>
              <th>Dev No.</th>
              <th>Category</th>
              <th>Type</th>
              <th>Supplier</th>
              <th></th>
            </tr>
            {shown.map((f) => (
              <tr key={f.id}>
                <td>
                  <b>{f.code}</b>
                </td>
                <td>{f.development_no || '—'}</td>
                <td>{f.fabric_category || '—'}</td>
                <td>{f.fabric_type || '—'}</td>
                <td>{f.supplier || '—'}</td>
                <td className="act">
                  <button className="btn sm" type="button" onClick={() => onChoose(f.code)}>
                    Choose
                  </button>
                </td>
              </tr>
            ))}
          </table>
        ) : (
          <p className="hint">No items match — try fewer filters.</p>
        )}
      </div>
      {results.length > shown.length ? (
        <p className="hint" style={{ marginTop: 8 }}>
          Showing first {shown.length} of {results.length} matches — narrow your search or filters to see the rest.
        </p>
      ) : (
        <p className="hint" style={{ marginTop: 8 }}>
          {results.length} item{results.length === 1 ? '' : 's'}.
        </p>
      )}
    </Modal>
  )
}
