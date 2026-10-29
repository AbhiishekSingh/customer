import { useMemo, useState } from 'react'
import Icon from './Icon'

const OPS_BY_TYPE = {
  number: [['eq', '='], ['neq', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤']],
  date: [['on', 'on'], ['before', 'before'], ['after', 'after']],
  text: [['contains', 'contains'], ['not_contains', "doesn't contain"], ['eq', 'equals']],
}

function matchFilter(row, f, columns) {
  const col = columns.find((c) => c.key === f.key)
  if (!col || f.value === '' || f.value == null) return true
  const raw = col.get ? col.get(row) : ''
  const type = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'
  if (type === 'number') {
    const av = parseFloat(raw)
    const bv = parseFloat(f.value)
    if (Number.isNaN(av) || Number.isNaN(bv)) return true
    switch (f.op) {
      case 'eq': return av === bv
      case 'neq': return av !== bv
      case 'gt': return av > bv
      case 'gte': return av >= bv
      case 'lt': return av < bv
      case 'lte': return av <= bv
      default: return true
    }
  }
  if (type === 'date') {
    const av = raw ? new Date(raw).getTime() : NaN
    const bv = f.value ? new Date(f.value).getTime() : NaN
    if (Number.isNaN(av) || Number.isNaN(bv)) return true
    switch (f.op) {
      case 'on': return new Date(av).toDateString() === new Date(bv).toDateString()
      case 'before': return av < bv
      case 'after': return av > bv
      default: return true
    }
  }
  const av = String(raw ?? '').toLowerCase()
  const bv = String(f.value).toLowerCase()
  switch (f.op) {
    case 'contains': return av.includes(bv)
    case 'not_contains': return !av.includes(bv)
    case 'eq': return av === bv
    default: return true
  }
}

// Reusable list toolkit: search, sortable columns, paging, CSV export, per-column filters
// (AND/OR) and a show/hide columns picker — a React port of the prototype's table.js toolkit.
export default function DataTable({
  id,
  rows,
  columns, // [{key, label, get(row), render?(row), sortable=true, type}]
  actions, // (row) => node
  emptyText = 'Nothing matches.',
  searchHint = 'Search…',
  pageSizeDefault = 25,
  exportName,
  rowKey = (r) => r.id,
  onRowClick,
  defaultQuery = '',
  rowClass,
}) {
  const [q, setQ] = useState(defaultQuery)
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(pageSizeDefault)
  const [hidden, setHidden] = useState(() => new Set())
  const [showCols, setShowCols] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState([]) // {id, key, op, value}
  const [combinator, setCombinator] = useState('AND')

  const visibleColumns = columns.filter((c) => !hidden.has(c.key))
  const activeFilters = filters.filter((f) => f.value !== '' && f.value != null)

  function addFilter() {
    const first = columns[0]
    setFilters((fs) => [...fs, { id: Math.random().toString(36).slice(2), key: first.key, op: (OPS_BY_TYPE[first.type === 'number' ? 'number' : first.type === 'date' ? 'date' : 'text'][0])[0], value: '' }])
    setShowFilters(true)
  }
  function updateFilter(fid, patch) {
    setFilters((fs) => fs.map((f) => (f.id === fid ? { ...f, ...patch } : f)))
  }
  function removeFilter(fid) {
    setFilters((fs) => fs.filter((f) => f.id !== fid))
  }

  const filtered = useMemo(() => {
    let out = rows
    if (q) {
      const qq = q.toLowerCase()
      out = out.filter((r) => columns.some((c) => String(c.get ? c.get(r) : '').toLowerCase().includes(qq)))
    }
    if (activeFilters.length) {
      out = out.filter((r) =>
        combinator === 'AND' ? activeFilters.every((f) => matchFilter(r, f, columns)) : activeFilters.some((f) => matchFilter(r, f, columns))
      )
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey)
      if (col) {
        out = [...out].sort((a, b) => {
          let av = col.get(a)
          let bv = col.get(b)
          if (col.type === 'number') {
            av = parseFloat(av) || 0
            bv = parseFloat(bv) || 0
            return sortDir === 'asc' ? av - bv : bv - av
          }
          av = String(av == null ? '' : av)
          bv = String(bv == null ? '' : bv)
          return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
        })
      }
    }
    return out
  }, [rows, q, sortKey, sortDir, columns, activeFilters, combinator])

  const total = filtered.length
  const effectivePageSize = pageSize === 'all' ? Math.max(total, 1) : pageSize
  const pages = Math.max(1, Math.ceil(total / effectivePageSize))
  const curPage = Math.min(page, pages)
  const start = (curPage - 1) * effectivePageSize
  const pageRows = filtered.slice(start, start + effectivePageSize)

  function sort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function exportCsv() {
    const header = visibleColumns.map((c) => c.label)
    const data = filtered.map((r) => visibleColumns.map((c) => (c.exportVal ? c.exportVal(r) : c.get ? c.get(r) : '')))
    const csv = [header, ...data]
      .map((row) => row.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (exportName || id || 'export') + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="dtable">
      <div className="dt-toolbar">
        <input
          className="search"
          style={{ margin: 0, maxWidth: 240 }}
          placeholder={searchHint}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
        />
        <button className="btn sm" onClick={() => setShowFilters((s) => !s)} type="button">
          Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}
        </button>
        <button className="btn sm" onClick={() => setShowCols((s) => !s)} type="button">
          Columns
        </button>
        <span className="spacer"></span>
        <span className="hint">
          {total} row(s){total !== rows.length ? ` of ${rows.length}` : ''}
        </span>
        <button className="btn sm" onClick={exportCsv} type="button">
          <Icon name="download" size={13} /> Export
        </button>
      </div>

      {showCols ? (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="chips">
            {columns.map((c) => (
              <label key={c.key} className="chip" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!hidden.has(c.key)}
                  onChange={() =>
                    setHidden((h) => {
                      const next = new Set(h)
                      next.has(c.key) ? next.delete(c.key) : next.add(c.key)
                      return next
                    })
                  }
                  style={{ marginRight: 4 }}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {showFilters ? (
        <div className="card" style={{ marginBottom: 10 }}>
          {filters.length ? (
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="hint">Combine with</span>
              <select style={{ width: 'auto', marginLeft: 6 }} value={combinator} onChange={(e) => setCombinator(e.target.value)}>
                <option value="AND">AND — match all</option>
                <option value="OR">OR — match any</option>
              </select>
            </div>
          ) : null}
          {filters.map((f) => {
            const col = columns.find((c) => c.key === f.key) || columns[0]
            const type = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'
            const ops = OPS_BY_TYPE[type]
            return (
              <div className="row" key={f.id} style={{ marginBottom: 6, gap: 6 }}>
                <select style={{ width: 'auto' }} value={f.key} onChange={(e) => updateFilter(f.id, { key: e.target.value, op: OPS_BY_TYPE[columns.find((c) => c.key === e.target.value)?.type === 'number' ? 'number' : columns.find((c) => c.key === e.target.value)?.type === 'date' ? 'date' : 'text'][0][0] })}>
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select style={{ width: 'auto' }} value={f.op} onChange={(e) => updateFilter(f.id, { op: e.target.value })}>
                  {ops.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  style={{ flex: '0 1 180px' }}
                  type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                  value={f.value}
                  onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                  placeholder="Value"
                />
                <button className="btn ghost sm icon-btn" onClick={() => removeFilter(f.id)} type="button" title="Remove filter">
                  <Icon name="x" size={13} />
                </button>
              </div>
            )
          })}
          <button className="btn sm" onClick={addFilter} type="button">
            ＋ Add filter
          </button>
        </div>
      ) : null}

      <div className="card pad0">
        <table>
          <thead>
            <tr>
              {visibleColumns.map((c) => (
                <th
                  key={c.key}
                  className={c.sortable !== false ? 'sortable' : ''}
                  onClick={c.sortable !== false ? () => sort(c.key) : undefined}
                >
                  {c.label}
                  {sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              {actions ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {!pageRows.length ? (
              <tr>
                <td colSpan={visibleColumns.length + (actions ? 1 : 0)}>
                  <div className="empty">{emptyText}</div>
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <tr key={rowKey(r)} className={[onRowClick ? 'click' : '', rowClass ? rowClass(r) : ''].filter(Boolean).join(' ')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {visibleColumns.map((c) => (
                    <td key={c.key}>{c.render ? c.render(r) : c.get ? c.get(r) : ''}</td>
                  ))}
                  {actions ? (
                    <td className="act" onClick={(e) => e.stopPropagation()}>
                      {actions(r)}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="dt-footer">
        <select
          style={{ width: 'auto' }}
          value={String(pageSize)}
          onChange={(e) => {
            const v = e.target.value
            setPageSize(v === 'all' ? 'all' : parseInt(v, 10))
            setPage(1)
          }}
        >
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
          <option value="all">All</option>
        </select>
        <span className="hint">
          {total ? `${start + 1}–${Math.min(start + pageRows.length, total)}` : 0} of {total}
        </span>
        <span className="spacer"></span>
        <button className="btn sm" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} type="button">
          ‹ Prev
        </button>
        <span className="hint">
          Page {curPage} of {pages}
        </span>
        <button className="btn sm" disabled={curPage >= pages} onClick={() => setPage(curPage + 1)} type="button">
          Next ›
        </button>
      </div>
    </div>
  )
}
