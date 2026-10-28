import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import DataTable from '../components/DataTable'
import { PageHead, Loading, ErrBox, fmtDateTime } from '../components/ui'

export default function Activity() {
  const navigate = useNavigate()
  const [who, setWho] = useState('')
  const { data, error, loading } = useApi(() => api.get('/activity'), [])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const whoOptions = [...new Set(data.map((r) => r.by))].sort()
  const rows = who ? data.filter((r) => r.by === who) : data

  const columns = [
    { key: 'date', label: 'When', type: 'date', get: (r) => r.date, render: (r) => fmtDateTime(r.date) },
    { key: 'by', label: 'By', get: (r) => r.by },
    { key: 'action', label: 'Action', get: (r) => r.action },
    { key: 'entity_type', label: 'On', get: (r) => r.entity_type || '' },
    { key: 'customer', label: 'Customer', get: (r) => r.customer || '', render: (r) => (r.customer ? <b>{r.customer}</b> : '—') },
    {
      key: 'detail',
      label: 'Detail',
      sortable: false,
      get: (r) => JSON.stringify(r.detail || {}),
      render: (r) => (r.detail ? <span className="hint">{JSON.stringify(r.detail)}</span> : ''),
    },
  ]

  return (
    <div>
      <PageHead title="Activity log" sub="Append-only record of every significant action taken in the system." />
      <div className="row" style={{ marginBottom: 10 }}>
        <select style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {whoOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        id="activity"
        rows={rows}
        columns={columns}
        exportName="activity_log"
        emptyText="Nothing logged yet."
        onRowClick={(r) => r.link && navigate(r.link)}
      />
    </div>
  )
}
