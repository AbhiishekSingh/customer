import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import DataTable from '../components/DataTable'
import { PageHead, Loading, ErrBox, Modal, fmtDate, fmtDateTime } from '../components/ui'
import { ResponseForm } from './portal/PortalPage'

export default function Outbox() {
  const [tab, setTab] = useState('all')
  const [viewing, setViewing] = useState(null)
  const [body, setBody] = useState(null)
  const [previewing, setPreviewing] = useState(null)

  const { data, error, loading } = useApi(() => api.get('/outbox'), [])

  async function openEntry(e) {
    setViewing(e)
    try {
      const full = await api.get(`/outbox/${e.id}`)
      setBody(full)
    } catch (err) {
      setBody({ body: 'Could not load this email: ' + err.message })
    }
  }

  async function previewAsCustomer(e, mailId) {
    setPreviewing({ loading: true })
    try {
      const status = await api.get(`/mails/${mailId}/portal-preview`)
      setPreviewing({ status })
    } catch (err) {
      setPreviewing({ error: err.message })
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const sets = {
    all: data,
    followup: data.filter((e) => e.type === 'followup'),
    intimation: data.filter((e) => e.type === 'intimation'),
    report: data.filter((e) => e.type === 'report'),
    bounced: data.filter((e) => !e.delivered),
  }
  const tabs = [
    ['all', 'All'],
    ['followup', 'Follow-ups'],
    ['intimation', 'Blacklist notices'],
    ['report', 'Reports'],
    ['bounced', 'Bounced'],
  ]
  const rows = sets[tab] || []

  const columns = [
    { key: 'date', label: 'Date', type: 'date', get: (e) => e.date, render: (e) => fmtDateTime(e.date) },
    { key: 'company', label: 'Company', get: (e) => e.company || '' },
    { key: 'to', label: 'To', get: (e) => e.to },
    { key: 'cc', label: 'Cc', get: (e) => e.cc || '' },
    { key: 'subject', label: 'Subject', get: (e) => e.subject },
    { key: 'type', label: 'Type', get: (e) => e.type },
    { key: 'delivered', label: 'Delivered', get: (e) => (e.delivered ? 'Yes' : 'No'), render: (e) => <span className={'pill ' + (e.delivered ? 'p-ok' : 'p-bad')}>{e.delivered ? 'Delivered' : 'Bounced'}</span> },
    {
      key: 'preview',
      label: '',
      sortable: false,
      get: () => '',
      render: (e) =>
        e.mail_id ? (
          <button
            className="btn sm"
            type="button"
            onClick={(ev) => {
              ev.stopPropagation()
              previewAsCustomer(e, e.mail_id)
            }}
          >
            Preview as customer
          </button>
        ) : null,
    },
  ]

  return (
    <div>
      <PageHead title="Sent Emails" sub="Full log of every follow-up, intimation and management report email sent." />
      <div className="tabs">
        {tabs.map(([k, l]) => (
          <a key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {l}
            <span className={'cnt' + (k === 'bounced' && sets[k].length ? ' hot' : '')}>{sets[k].length}</span>
          </a>
        ))}
      </div>
      <DataTable id={'outbox-' + tab} rows={rows} columns={columns} exportName="outbox" emptyText="No emails sent yet." onRowClick={openEntry} />

      {viewing ? (
        <Modal title={viewing.subject} wide onClose={() => { setViewing(null); setBody(null) }}>
          {body ? (
            <div className="mail">
              <div className="mail-h">
                To: {body.to}
                {body.cc ? <><br />Cc: {body.cc}</> : null}
                <br />
                {fmtDateTime(body.date)}
              </div>
              {body.body}
            </div>
          ) : (
            <Loading />
          )}
        </Modal>
      ) : null}

      {previewing ? (
        <Modal title="Preview — what the customer sees" wide onClose={() => setPreviewing(null)}>
          <PortalPreview previewing={previewing} />
        </Modal>
      ) : null}
    </div>
  )
}

// Mirrors the prototype's renderPortal(t, true) — "Link status: …" line computed the same way
// (not opened yet / opened + active-until / expired), since the backend only hands back `opened`
// and `link_expiry` (never raw first_opened_at, which has no reason to leave the portal router).
function linkStatusText(s) {
  if (!s.opened) return 'Not opened yet — never expires until the customer opens it'
  if (s.link_expiry && new Date(s.link_expiry) <= new Date()) return `Expired ${fmtDateTime(s.link_expiry)}`
  return `Opened · active until ${fmtDateTime(s.link_expiry)}`
}

function PortalPreview({ previewing }) {
  if (previewing.loading) return <Loading />
  if (previewing.error) return <ErrBox message={previewing.error} />
  const s = previewing.status
  return (
    <div>
      <div className="alert info" style={{ marginBottom: 12 }}>
        Staff preview — exactly what the customer sees on their own link. Read-only: looking at this never starts
        or affects the customer's own link timer.
      </div>
      <div className="alert" style={{ marginBottom: 12 }}>
        Link status: <b>{linkStatusText(s)}</b>
      </div>
      <h3 style={{ marginTop: 0 }}>{s.customer_name}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {s.mail_purpose} — visit on {fmtDate(s.visit_date)} with {s.owner_name}
      </p>
      {s.latest_response ? (
        <p className="hint">
          Last response submitted by {s.latest_response.by_name}
          {s.latest_response.by_designation ? `, ${s.latest_response.by_designation}` : ''} on{' '}
          {fmtDate(s.latest_response.submitted_at)}
          {s.latest_response.version > 1 ? ` (version ${s.latest_response.version})` : ''}
        </p>
      ) : (
        <p className="hint">No response submitted yet.</p>
      )}
      <h4 style={{ marginTop: 16 }}>What the customer sees</h4>
      <div style={{ pointerEvents: 'none', opacity: 0.75 }}>
        <ResponseForm token="" status={s} onDone={() => {}} />
      </div>
    </div>
  )
}
