import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { Loading, ErrBox, PageHead, Panel, Pill, fmtDate } from '../components/ui'
import { BL_TEXT } from '../lib/domain'
import EvidenceModal from '../components/EvidenceModal'
import DataTable from '../components/DataTable'

export default function Blacklist() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [evidenceFor, setEvidenceFor] = useState(null) // {id, name} or null

  const { data, error, loading, reload } = useApi(async () => {
    const [pending, customers, directory, bCandidates] = await Promise.all([
      api.get('/blacklist/pending'),
      api.get('/customers'),
      api.get('/directory/users'),
      api.get('/blacklist/b-candidates'),
    ])
    const custById = Object.fromEntries(customers.map((c) => [c.id, c]))
    const userById = Object.fromEntries(directory.map((u) => [u.id, u]))
    const eventsWithApprovals = await Promise.all(
      pending.blacklist_events.map(async (ev) => ({ ...ev, approvals: await api.get(`/blacklist-events/${ev.id}/approvals`) }))
    )
    const blacklisted = customers.filter((c) => c.blacklist_cat)
    // Since/Reason/Approved by for the "Blacklisted companies" table — the approved event for
    // each company's current category, plus who on Top Management approved it. Same per-row
    // fetch-and-attach pattern as pending.blacklist_events above.
    const blacklistInfo = Object.fromEntries(
      await Promise.all(
        blacklisted.map(async (c) => {
          const evs = await api.get(`/customers/${c.id}/blacklist-events`)
          const approvedEvent = evs.find((e) => e.status === 'approved' && e.cat === c.blacklist_cat)
          if (!approvedEvent) return [c.id, null]
          const approvals = await api.get(`/blacklist-events/${approvedEvent.id}/approvals`)
          const approvedBy = approvals.filter((a) => a.decision).map((a) => userById[a.approver_id]?.name).filter(Boolean)
          return [c.id, { since: approvedEvent.created_at, reason: approvedEvent.reason, approvedBy }]
        })
      )
    )
    return { events: eventsWithApprovals, exceptions: pending.exceptions, custById, userById, blacklisted, bCandidates, blacklistInfo }
  }, [])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const { events, exceptions, custById, userById, blacklisted, bCandidates, blacklistInfo } = data
  const isTop = user?.role === 'top'
  const isAdmin = user?.role === 'admin' || user?.role === 'top'

  async function confirmMarketingOnly(customerId) {
    try {
      await api.patch(`/customers/${customerId}`, { marketing_only: true })
      toast('Confirmed — re-checking Blacklist B')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  function whyBtn(customerId, name) {
    return (
      <button className="btn sm" onClick={() => setEvidenceFor({ id: customerId, name })} type="button">
        Why?
      </button>
    )
  }

  async function decide(eventId, decision) {
    const note = decision ? null : window.prompt('Reason for rejecting (optional):')
    try {
      await api.post(`/blacklist-events/${eventId}/decide`, { decision, note: note || null })
      toast(decision ? 'Approved' : 'Rejected')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  async function decideExc(excId, decision) {
    const note = decision ? null : window.prompt('Reason for rejecting (optional):')
    try {
      await api.post(`/exceptions/${excId}/decide`, { decision, note: note || null })
      toast(decision ? 'Approved' : 'Rejected')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  async function removeFromBlacklist(customerId, name, cat) {
    const reason = window.prompt(`Reason for removing ${name} from Blacklist ${cat}:`)
    if (!reason) return
    try {
      await api.post(`/customers/${customerId}/blacklist/clear`, { reason })
      toast('Removed from blacklist')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  function approvalChips(approvals) {
    return (
      <span className="appr">
        {approvals.map((a) => (
          <Pill key={a.approver_id} text={(userById[a.approver_id]?.name || '—') + ': ' + (a.decision ? 'approved' : 'rejected')} cls={a.decision ? 'p-ok' : 'p-bad'} />
        ))}
      </span>
    )
  }

  const pendingColumns = [
    {
      key: 'company', label: 'Company', get: (ev) => custById[ev.customer_id]?.name || '',
      render: (ev) => (
        <>
          <b>{custById[ev.customer_id]?.name}</b>
          <div className="sub">{userById[custById[ev.customer_id]?.owner_id]?.name}</div>
        </>
      ),
    },
    { key: 'cat', label: 'Suggested', get: (ev) => 'Blacklist ' + ev.cat, render: (ev) => (
      <>
        <Pill text={'Blacklist ' + ev.cat} cls="p-warn" />
        <div className="sub">{fmtDate(ev.created_at)}</div>
      </>
    ) },
    { key: 'date', label: 'Date', type: 'date', get: (ev) => ev.created_at, render: (ev) => fmtDate(ev.created_at) },
    { key: 'reason', label: 'Reason', get: (ev) => ev.reason },
  ]

  const bCandColumns = [
    {
      key: 'company', label: 'Company', get: (bc) => bc.customer_name,
      render: (bc) => (
        <>
          <b>{bc.customer_name}</b>
          <div className="sub">{userById[bc.owner_id]?.name}</div>
        </>
      ),
    },
    { key: 'visit_date', label: 'Last visit', type: 'date', get: (bc) => bc.visit_date, render: (bc) => fmtDate(bc.visit_date) },
  ]

  const exceptionColumns = [
    { key: 'company', label: 'Company', get: (ex) => custById[ex.customer_id]?.name || '', render: (ex) => <b>{custById[ex.customer_id]?.name}</b> },
    {
      key: 'asked_by', label: 'Asked by', get: (ex) => userById[ex.requested_by]?.name || '',
      render: (ex) => (
        <>
          {userById[ex.requested_by]?.name}
          <div className="sub">{fmtDate(ex.created_at)}</div>
        </>
      ),
    },
    { key: 'date', label: 'Date', type: 'date', get: (ex) => ex.created_at, render: (ex) => fmtDate(ex.created_at) },
    { key: 'reason', label: 'Reason', get: (ex) => ex.reason },
  ]

  const blacklistedColumns = [
    {
      key: 'company', label: 'Company', get: (c) => c.name,
      render: (c) => (
        <>
          <b>{c.name}</b>
          <div className="sub">{userById[c.owner_id]?.name}</div>
        </>
      ),
    },
    { key: 'cat', label: 'Category', get: (c) => c.blacklist_cat, render: (c) => <Pill text={'Blacklist ' + c.blacklist_cat} cls="p-bad" /> },
    { key: 'since', label: 'Since', type: 'date', get: (c) => blacklistInfo[c.id]?.since || '', render: (c) => (blacklistInfo[c.id]?.since ? fmtDate(blacklistInfo[c.id].since) : '—') },
    { key: 'reason', label: 'Reason', get: (c) => blacklistInfo[c.id]?.reason || '' },
    { key: 'approved_by', label: 'Approved by', sortable: false, get: (c) => (blacklistInfo[c.id]?.approvedBy || []).join(', '), render: (c) => (blacklistInfo[c.id]?.approvedBy?.length ? blacklistInfo[c.id].approvedBy.join(', ') : '—') },
  ]

  return (
    <div>
      <PageHead title="Blacklist" sub="The system checks the rules every day and only SUGGESTS a blacklist. A company is blacklisted only when ALL Top Management members approve." />

      <div className="grid g3">
        {['A', 'B', 'C'].map((k) => (
          <div className="card rule" key={k}>
            <div className="row">
              <h3>Blacklist {k}</h3>
              <span className="spacer"></span>
              <span className={'cnt' + (blacklisted.some((c) => c.blacklist_cat === k) ? ' hot' : '')}>{blacklisted.filter((c) => c.blacklist_cat === k).length}</span>
            </div>
            <p>
              <span className="lbl">When</span>
              {BL_TEXT[k].rule}
            </p>
            <p>
              <span className="lbl">Action</span>
              {BL_TEXT[k].act}
            </p>
          </div>
        ))}
      </div>

      <Panel title="Waiting for Top Management approval" count={events.length} hot>
        <DataTable
          id="blacklist-pending"
          rows={events}
          columns={pendingColumns}
          exportName="blacklist_pending"
          searchHint="Search by company or reason…"
          emptyText="Nothing waiting."
          onRowClick={(ev) => navigate(`/customers/${ev.customer_id}`)}
          actions={(ev) => {
            const mine = isTop && !ev.approvals.some((a) => a.approver_id === user.id)
            return (
              <>
                {approvalChips(ev.approvals)} {whyBtn(ev.customer_id, custById[ev.customer_id]?.name)}
                {mine ? (
                  <>
                    {' '}
                    <button className="btn sm primary" onClick={() => decide(ev.id, true)} type="button">
                      Approve
                    </button>{' '}
                    <button className="btn sm danger" onClick={() => decide(ev.id, false)} type="button">
                      Reject
                    </button>
                  </>
                ) : null}
              </>
            )
          }}
        />
      </Panel>

      {bCandidates.length ? (
        <Panel title="Blacklist B — waiting for the account owner's confirmation" count={bCandidates.length} hot>
          <p className="hint" style={{ padding: '10px 16px 0', margin: 0 }}>
            These companies replied but never gave feedback or a decision. Blacklist B applies only if they now talk only to the marketing team — confirm if that is true, and the suggestion goes to Top Management.
          </p>
          <DataTable
            id="blacklist-b-candidates"
            rows={bCandidates}
            columns={bCandColumns}
            exportName="blacklist_b_candidates"
            searchHint="Search by company…"
            emptyText="Nothing waiting."
            rowKey={(bc) => bc.customer_id}
            onRowClick={(bc) => navigate(`/customers/${bc.customer_id}`)}
            actions={(bc) => (
              <button className="btn sm primary" onClick={() => confirmMarketingOnly(bc.customer_id)} type="button">
                Confirm: only talks to marketing
              </button>
            )}
          />
        </Panel>
      ) : null}

      {exceptions.length ? (
        <Panel title="Exception requests — give new swatches to a blacklisted company" count={exceptions.length} hot>
          <DataTable
            id="blacklist-exceptions"
            rows={exceptions}
            columns={exceptionColumns}
            exportName="blacklist_exceptions"
            searchHint="Search by company or reason…"
            emptyText="Nothing waiting."
            onRowClick={(ex) => navigate(`/customers/${ex.customer_id}`)}
            actions={(ex) => {
              const c = custById[ex.customer_id]
              const mine = isTop
              return (
                <>
                  {whyBtn(ex.customer_id, c?.name)}{' '}
                  {mine ? (
                    <>
                      <button className="btn sm primary" onClick={() => decideExc(ex.id, true)} type="button">
                        Approve
                      </button>{' '}
                      <button className="btn sm danger" onClick={() => decideExc(ex.id, false)} type="button">
                        Reject
                      </button>
                    </>
                  ) : null}
                </>
              )
            }}
          />
        </Panel>
      ) : null}

      <Panel title="Blacklisted companies" count={blacklisted.length}>
        <DataTable
          id="blacklisted-companies"
          rows={blacklisted}
          columns={blacklistedColumns}
          exportName="blacklisted_companies"
          searchHint="Search by company or reason…"
          emptyText="No blacklisted companies."
          onRowClick={(c) => navigate(`/customers/${c.id}`)}
          actions={(c) => (
            <>
              {whyBtn(c.id, c.name)}{' '}
              {isAdmin ? (
                <button className="btn sm" onClick={() => removeFromBlacklist(c.id, c.name, c.blacklist_cat)} type="button">
                  Remove
                </button>
              ) : null}
            </>
          )}
        />
      </Panel>

      {evidenceFor ? <EvidenceModal customerId={evidenceFor.id} customerName={evidenceFor.name} onClose={() => setEvidenceFor(null)} /> : null}
    </div>
  )
}
