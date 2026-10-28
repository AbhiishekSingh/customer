import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import DataTable from '../components/DataTable'
import CsvImportModal from '../components/CsvImportModal'
import { PageHead, Loading, ErrBox, blPill, fmtDate } from '../components/ui'
import { dotsFor, visitStageText, visitStageCls } from '../lib/domain'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

const IMPORT_FIELDS = [
  { key: 'customer_name', label: 'Company name', required: true },
  { key: 'contact_name', label: 'Contact (attendee) name', required: true },
  { key: 'visit_date', label: 'Visit date (YYYY-MM-DD)', required: true },
  { key: 'collections', label: 'Collection / purpose', required: true },
  { key: 'fabric_code', label: 'Sort no. (fabric code)', required: true },
  { key: 'swatch_type', label: 'Type (Hanger/Swatch/Yardage)' },
  { key: 'qty', label: 'Qty' },
  { key: 'way_forward', label: 'Way forward / notes' },
]

export default function Visits() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [filter, setFilter] = useState(() => (['active', 'hold', 'ordered', 'completed', 'all'].includes(params.get('filter')) ? params.get('filter') : 'active'))
  const [importing, setImporting] = useState(false)

  const { data, error, loading, reload } = useApi(async () => {
    const [visits, customers, directory] = await Promise.all([api.get('/visits'), api.get('/customers'), api.get('/directory/users')])
    const custById = Object.fromEntries(customers.map((c) => [c.id, c]))
    const userById = Object.fromEntries(directory.map((u) => [u.id, u]))
    const rows = []
    await Promise.all(
      visits.map(async (v) => {
        const mails = await api.get(`/visits/${v.id}/mails`)
        v.visit_contacts.forEach((vc) => {
          const vcMails = mails.filter((m) => m.visit_contact_id === vc.id).sort((a, b) => a.mail_number - b.mail_number)
          const c = custById[v.customer_id]
          const contact = c?.contacts.find((x) => x.id === vc.contact_id)
          const team = contact ? c.teams.find((t) => t.id === contact.team_id) : null
          const replyCount = vcMails.filter((m) => m.responses && m.responses.length).length
          const nextDue = vcMails.find((m) => m.status === 'scheduled')?.due_date || null
          rows.push({
            v, vc, c, contact, team,
            owner: userById[v.owner_id],
            presenters: (v.presented_by || []).map((id) => userById[id]?.name).filter(Boolean),
            mails: vcMails,
            stage: visitStageText(vc, vcMails),
            onHold: vcMails.some((m) => m.status === 'bounced'),
            replyCount,
            nextDue,
          })
        })
      })
    )
    return rows
  }, [])

  const sets = useMemo(() => {
    if (!data) return {}
    return {
      active: data.filter((r) => r.stage === 'In progress' && !r.onHold),
      hold: data.filter((r) => r.onHold),
      ordered: data.filter((r) => r.vc.order_placed),
      completed: data.filter((r) => r.stage === 'Completed'),
      all: data,
    }
  }, [data])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const rows = sets[filter] || []
  const tabs = [
    ['active', 'In progress'],
    ['hold', 'Paused'],
    ['ordered', 'Order placed'],
    ['completed', 'Completed'],
    ['all', 'All'],
  ]

  const columns = [
    { key: 'company', label: 'Company', get: (r) => r.c?.name || '', render: (r) => (
      <>
        <b>{r.c?.name}</b> {r.c?.blacklist_cat ? blPill(r.c.blacklist_cat) : null}
      </>
    ) },
    { key: 'category', label: 'Category', get: (r) => r.c?.category || '' },
    { key: 'person', label: 'Person', get: (r) => r.contact?.name || '', render: (r) => r.contact?.name || '—' },
    { key: 'team', label: 'Team', get: (r) => r.team?.name || '' },
    { key: 'date', label: 'Visit', type: 'date', get: (r) => r.v.date, render: (r) => fmtDate(r.v.date) },
    { key: 'owner', label: 'Owner', get: (r) => r.owner?.name || '' },
    { key: 'presented_by', label: 'Presented by', sortable: false, get: (r) => r.presenters.join(', '), render: (r) => r.presenters.length ? r.presenters.join(', ') : '—' },
    { key: 'replies', label: 'Replies', type: 'number', get: (r) => r.replyCount, render: (r) => `${r.replyCount}/${r.mails.length}` },
    { key: 'next_due', label: 'Next action due', type: 'date', get: (r) => r.nextDue || '', render: (r) => (r.nextDue ? fmtDate(r.nextDue) : '—') },
    {
      key: 'mails',
      label: 'Mail 1 → 5',
      sortable: false,
      get: () => '',
      render: (r) => (
        <span className="dots">
          {dotsFor(r.mails).map((k, i) => (
            <i key={i} className={k === 'resp' ? 'resp' : k === 'sent' ? 'sent' : k === 'bounce' ? 'bounce' : k === 'skip' ? 'skip' : ''} />
          ))}
        </span>
      ),
    },
    { key: 'status', label: 'Status', get: (r) => r.stage, render: (r) => <span className={'pill ' + visitStageCls(r.stage)}>{r.stage}</span> },
  ]

  return (
    <div>
      <PageHead
        title="Follow-ups"
        sub="One follow-up per person who took swatches. Each sends 5 emails automatically."
        actions={
          <>
            {isMgr(user?.role) ? (
              <button className="btn" onClick={() => setImporting(true)} type="button">
                Import CSV
              </button>
            ) : null}{' '}
            <button className="btn primary" onClick={() => navigate('/entry/new')} type="button">
              ＋ New visit entry
            </button>
          </>
        }
      />
      <div className="tabs">
        {tabs.map(([k, l]) => (
          <a key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
            {l}
            <span className={'cnt' + (k === 'hold' && (sets[k] || []).length ? ' hot' : '')}>{(sets[k] || []).length}</span>
          </a>
        ))}
      </div>
      <div className="dots-legend hint" style={{ marginBottom: 10 }}>
        <span className="dots"><i className="resp" /></span> Replied &nbsp;
        <span className="dots"><i className="sent" /></span> Sent, no reply &nbsp;
        <span className="dots"><i className="bounce" /></span> Bounced &nbsp;
        <span className="dots"><i className="skip" /></span> Not needed &nbsp;
        <span className="dots"><i /></span> Planned
      </div>
      <DataTable
        id={'visits-' + filter}
        rows={rows}
        columns={columns}
        exportName={'followups_' + filter}
        emptyText="Nothing here."
        onRowClick={(r) => navigate(`/visit/${r.v.id}/${r.vc.id}`)}
      />
      {importing ? (
        <CsvImportModal
          title="Import visits from CSV"
          fields={IMPORT_FIELDS}
          sampleHeader="customer_name,contact_name,visit_date,collections,fabric_code,swatch_type,qty,way_forward"
          onClose={() => setImporting(false)}
          onImport={async (rows) => {
            const res = await api.post(
              '/visits/import',
              rows.map((r) => ({
                ...r,
                qty: r.qty ? parseInt(r.qty, 10) || 1 : 1,
                swatch_type: r.swatch_type || 'Hanger',
                way_forward: r.way_forward || null,
              }))
            )
            reload()
            return res
          }}
        />
      ) : null}
    </div>
  )
}
