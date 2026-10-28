import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import DataTable from '../components/DataTable'
import { PageHead, Loading, ErrBox, blPill, fmtDate } from '../components/ui'

function pieces(v) {
  return v.visit_contacts.reduce((a, vc) => a + vc.items.reduce((b, i) => b + i.qty, 0), 0)
}

export default function EntryList() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data, error, loading } = useApi(async () => {
    const [visits, customers] = await Promise.all([api.get('/visits'), api.get('/customers')])
    const custById = Object.fromEntries(customers.map((c) => [c.id, c]))
    return visits.map((v) => ({ ...v, _c: custById[v.customer_id] }))
  }, [])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const columns = [
    { key: 'date', label: 'Date', type: 'date', get: (v) => v.date, render: (v) => <b>{fmtDate(v.date)}</b> },
    { key: 'company', label: 'Company', get: (v) => v._c?.name || '', render: (v) => (
      <>
        {v._c?.name} {v._c?.blacklist_cat ? blPill(v._c.blacklist_cat) : null}
      </>
    ) },
    { key: 'collections', label: 'Purpose / collection', get: (v) => v.collections || '' },
    { key: 'people', label: 'People', type: 'number', get: (v) => v.visit_contacts.length, render: (v) => v.visit_contacts.length + (v.visit_contacts.length === 1 ? ' person' : ' people') },
    { key: 'swatches', label: 'Swatches', type: 'number', get: (v) => pieces(v), render: (v) => pieces(v) + ' pcs' },
  ]

  return (
    <div>
      <PageHead
        title="Customer Visit Entry"
        sub="One entry per meeting with a company. Record who attended and what each person selected — every person who takes swatches gets their own 5 follow-up emails."
        actions={
          user?.role !== 'top' ? (
            <button className="btn primary" onClick={() => navigate('/entry/new')} type="button">
              ＋ New visit entry
            </button>
          ) : null
        }
      />
      <DataTable
        id="entry"
        rows={data}
        columns={columns}
        exportName="visits"
        searchHint="Search by company or purpose…"
        emptyText='No visits yet. Click "New visit entry" to log the first one.'
        onRowClick={(v) => navigate(`/presentation/${v.id}`)}
      />
    </div>
  )
}
