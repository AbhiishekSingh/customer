import { useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import DataTable from '../components/DataTable'
import CsvImportModal from '../components/CsvImportModal'
import { PageHead, Loading, ErrBox, Pill } from '../components/ui'
import { blPill } from '../components/ui'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

const IMPORT_FIELDS = [
  { key: 'name', label: 'Company name', required: true },
  { key: 'owner_email', label: "Owner's email", required: true },
  { key: 'category', label: 'Category' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
  { key: 'company_address', label: 'Company address' },
]

const ENGAGEMENT_CLS = { Hot: 'p-ok', Warm: 'p-warn', Cold: 'p-mute', 'Non-responsive': 'p-bad', New: 'p-mute' }

export default function Customers() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const { data: customers, error, loading, reload } = useApi(() => api.get('/customers'), [])
  const { data: summary } = useApi(() => api.get('/customers/summary/list'), [])
  const { data: directory } = useApi(() => api.get('/directory/users'), [])
  const [initialQ] = useState(params.get('q') || '')
  const [importing, setImporting] = useState(false)

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const summaryById = Object.fromEntries((summary || []).map((s) => [s.id, s]))
  const userById = Object.fromEntries((directory || []).map((u) => [u.id, u]))

  const rows = customers.map((c) => ({ ...c, _s: summaryById[c.id] }))

  const columns = [
    { key: 'name', label: 'Company', get: (c) => c.name, render: (c) => (
      <>
        <b>{c.name}</b> {c.blacklist_cat ? <> {blPill(c.blacklist_cat)}</> : null}
      </>
    ) },
    { key: 'owner', label: 'Owner', get: (c) => userById[c.owner_id]?.name || '' },
    { key: 'category', label: 'Category', get: (c) => c.category || '' },
    { key: 'city', label: 'City', get: (c) => c.city || '' },
    { key: 'country', label: 'Country', get: (c) => c.country || '' },
    {
      key: 'engagement',
      label: 'Engagement',
      get: (c) => c._s?.tag || '',
      render: (c) => (c._s ? <Pill text={c._s.tag} cls={ENGAGEMENT_CLS[c._s.tag] || 'p-mute'} /> : '—'),
    },
    {
      key: 'rate',
      label: 'Reply rate',
      type: 'number',
      get: (c) => (c._s ? Math.round(c._s.rate * 100) : ''),
      render: (c) => (c._s ? `${Math.round(c._s.rate * 100)}% (${c._s.resp}/${c._s.sent})` : '—'),
    },
    { key: 'visits', label: 'Visits', type: 'number', get: (c) => c._s?.visits ?? 0 },
    { key: 'orders', label: 'Orders', type: 'number', get: (c) => c._s?.orders ?? 0 },
    { key: 'status', label: 'Status', get: (c) => c._s?.status || '', render: (c) => <Pill text={c._s?.status || '—'} cls={c.blacklist_cat ? 'p-bad' : c.marketing_only ? 'p-warn' : 'p-ok'} /> },
    { key: 'contacts', label: 'Contacts', sortable: false, get: (c) => c.contacts.length, render: (c) => c.contacts.length },
  ]

  return (
    <div>
      <PageHead
        title="Customers"
        sub="Every company with at least one visit or contact on record."
        actions={
          <>
            {isMgr(user?.role) ? (
              <button className="btn" onClick={() => setImporting(true)} type="button">
                Import CSV
              </button>
            ) : null}{' '}
            <button className="btn primary" onClick={() => navigate('/customers/new')} type="button">
              ＋ New customer
            </button>
          </>
        }
      />
      <DataTable
        id="customers"
        rows={rows}
        columns={columns}
        exportName="customers"
        searchHint="Search by company, city, country…"
        emptyText="No customers yet."
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        defaultQuery={initialQ}
        actions={(c) => (
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); navigate(`/customers/${c.id}?edit=1`) }} type="button">
            Edit
          </button>
        )}
      />
      {importing ? (
        <CsvImportModal
          title="Import customers from CSV"
          fields={IMPORT_FIELDS}
          onClose={() => setImporting(false)}
          onImport={async (importRows) => {
            const res = await api.post('/customers/import', importRows)
            reload()
            return res
          }}
        />
      ) : null}
    </div>
  )
}
