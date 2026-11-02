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
    const [visits, customers, directory] = await Promise.all([api.get('/visits'), api.get('/customers'), api.get('/directory/users')])
    const custById = Object.fromEntries(customers.map((c) => [c.id, c]))
    const userById = Object.fromEntries(directory.map((u) => [u.id, u]))
    const mailsByVisit = {}
    await Promise.all(
      visits.map(async (v) => {
        mailsByVisit[v.id] = await api.get(`/visits/${v.id}/mails`)
      })
    )
    return visits.map((v) => {
      const vMails = mailsByVisit[v.id] || []
      const replied = v.visit_contacts.filter((vc) => vMails.some((m) => m.visit_contact_id === vc.id && m.responses && m.responses.length)).length
      return {
        ...v,
        _c: custById[v.customer_id],
        _presentedBy: (v.presented_by || []).map((id) => userById[id]?.name).filter(Boolean),
        _replied: replied,
      }
    })
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
    { key: 'category', label: 'Category', get: (v) => v._c?.category || '', render: (v) => v._c?.category || '—' },
    { key: 'collections', label: 'Purpose / collection', get: (v) => v.collections || '' },
    { key: 'people', label: 'People', type: 'number', get: (v) => v.visit_contacts.length, render: (v) => v.visit_contacts.length + (v.visit_contacts.length === 1 ? ' person' : ' people') },
    { key: 'presented', label: 'Presented by', sortable: false, get: (v) => v._presentedBy.join(', ') },
    { key: 'swatches', label: 'Swatches', type: 'number', get: (v) => pieces(v), render: (v) => pieces(v) + ' pcs' },
    { key: 'replies', label: 'Replies', type: 'number', get: (v) => v._replied, render: (v) => `${v._replied} of ${v.visit_contacts.length} replied` },
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
