import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { Loading, ErrBox, Panel, Empty, Pill } from '../components/ui'
import EvidenceModal from '../components/EvidenceModal'

function Kpi({ value, label, sub, onClick, alert }) {
  return (
    <div className={'kpi' + (alert ? ' kpi-alert' : '')} onClick={onClick}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
      <div className="s">{sub}</div>
    </div>
  )
}

const isMgrRole = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const isMgr = isMgrRole(user?.role)
  const [showAllTodo, setShowAllTodo] = useState(false)
  const [evidenceFor, setEvidenceFor] = useState(null)
  const [busy, setBusy] = useState(null)

  const { data, error, loading, reload } = useApi(async () => {
    const [visits, customers] = await Promise.all([api.get('/visits'), api.get('/customers')])
    let summary = null
    if (isMgr) {
      try {
        summary = await api.get('/reports/summary')
      } catch {
        summary = null
      }
    }
    let pending = { blacklist_events: [], exceptions: [] }
    try {
      pending = await api.get('/blacklist/pending')
    } catch {
      /* design role: 403, fine — no approvals widget for them */
    }
    let bCandidates = []
    if (isMgr) {
      try {
        bCandidates = await api.get('/blacklist/b-candidates')
      } catch {
        bCandidates = []
      }
    }
    let eventsWithApprovals = []
    if (user?.role === 'top' && pending.blacklist_events.length) {
      eventsWithApprovals = await Promise.all(
        pending.blacklist_events.map(async (ev) => ({ ...ev, approvals: await api.get(`/blacklist-events/${ev.id}/approvals`) }))
      )
    }

    // Build the "needs your attention" todo list from each visit's own mails. An N+1 but the
    // dataset in this system is small, and this is the same pattern already used elsewhere.
    let sent = 0
    let resp = 0
    let orderedCount = 0
    const todo = []
    await Promise.all(
      visits.map(async (v) => {
        const mails = await api.get(`/visits/${v.id}/mails`)
        mails.forEach((m) => {
          if (m.status === 'sent') {
            sent++
            if (m.responses.length) resp++
          }
          const customer = customers.find((c) => c.id === v.customer_id)
          const target = { visitId: v.id, vcId: m.visit_contact_id, mailId: m.id }
          if (m.status === 'bounced') {
            todo.push({ kind: 'bounced', text: `Email bounced on ${v.collections || 'a visit'}`, customer, ...target, cls: 'bad', ico: '!' })
          }
          if (m.requested_new && !m.request_resolved) {
            todo.push({ kind: 'link', text: 'Customer asked for a new link', customer, ...target, cls: 'warn', ico: '↻' })
          }
          if (m.unreviewed) {
            todo.push({ kind: 'unreviewed', text: 'New reply to review', customer, ...target, cls: 'info', ico: '✉' })
          }
        })
      })
    )
    for (const v of visits) {
      for (const vc of v.visit_contacts) {
        if (vc.order_placed) orderedCount++
      }
    }
    if (isMgr && summary) {
      sent = summary.stages.reduce((a, s) => a + s.sent, 0)
      resp = summary.stages.reduce((a, s) => a + s.resp, 0)
      orderedCount = summary.reached.order
    }

    for (const bc of bCandidates) {
      todo.push({
        kind: 'bcandidate',
        text: 'Possible Blacklist B — please confirm the company now only talks to marketing',
        customer: { id: bc.customer_id, name: bc.customer_name },
        customerId: bc.customer_id,
        cls: 'warn',
        ico: '⚑',
      })
    }

    const blCustomers = customers.filter((c) => c.blacklist_cat)
    return { visits, customers, summary, pending, eventsWithApprovals, sent, resp, orderedCount, todo, blCustomers }
  }, [isMgr, user?.role])

  const firstName = (user?.name || '').split(' ')[0]

  const activeVisits = useMemo(() => (data ? data.visits.filter((v) => v.visit_contacts.some((vc) => !vc.order_placed && !vc.closure_type)) : []), [data])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />
  if (!data) return null

  const replyRate = data.sent ? Math.round((data.resp / data.sent) * 100) : 0

  async function sendNewLink(t) {
    setBusy(t.mailId)
    try {
      await api.post(`/mails/${t.mailId}/resend-link`)
      toast('New link sent')
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function markReviewed(t) {
    setBusy(t.mailId)
    try {
      await api.post(`/mails/${t.mailId}/mark-reviewed`)
      toast('Marked reviewed')
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function confirmMarketingOnly(t) {
    setBusy(t.customerId)
    try {
      await api.patch(`/customers/${t.customerId}`, { marketing_only: true })
      toast('Confirmed — re-checking Blacklist B')
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(null)
    }
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

  function todoAction(t) {
    if (t.kind === 'bounced') {
      return (
        <button className="btn sm" onClick={() => navigate(`/visit/${t.visitId}/${t.vcId}`)} type="button">
          Fix email
        </button>
      )
    }
    if (t.kind === 'link') {
      return (
        <button className="btn sm" disabled={busy === t.mailId} onClick={() => sendNewLink(t)} type="button">
          Send new link
        </button>
      )
    }
    if (t.kind === 'unreviewed') {
      return (
        <>
          <button className="btn sm" onClick={() => navigate(`/visit/${t.visitId}/${t.vcId}`)} type="button">
            Open
          </button>{' '}
          <button className="btn sm" disabled={busy === t.mailId} onClick={() => markReviewed(t)} type="button">
            Mark as read
          </button>
        </>
      )
    }
    if (t.kind === 'bcandidate') {
      return (
        <button className="btn sm primary" disabled={busy === t.customerId} onClick={() => confirmMarketingOnly(t)} type="button">
          Confirm: only talks to marketing
        </button>
      )
    }
    return (
      <button className="btn sm" onClick={() => navigate(`/visit/${t.visitId}/${t.vcId}`)} type="button">
        Open
      </button>
    )
  }

  const visibleTodo = showAllTodo ? data.todo : data.todo.slice(0, 8)

  return (
    <div>
      <div className="page-head">
        <div className="grow">
          <h1>Good day, {firstName}</h1>
          <p className="hint">{isMgr ? 'Whole Design Team' : 'Your customers'}</p>
        </div>
        {user?.role !== 'top' ? (
          <button className="btn primary" onClick={() => navigate('/entry')} type="button">
            ＋ New visit entry
          </button>
        ) : null}
      </div>

      <div className="kpis">
        <Kpi value={activeVisits.length} label="Follow-ups running" sub={data.visits.length + ' in total'} onClick={() => navigate('/visits')} />
        <Kpi value={replyRate + '%'} label="Reply rate" sub={`${data.resp}/${data.sent} emails`} onClick={() => navigate(isMgr ? '/reports' : '/visits')} />
        <Kpi
          value={data.orderedCount}
          label="Orders"
          sub={Math.round((data.visits.length ? data.orderedCount / data.visits.length : 0) * 100) + '% of follow-ups'}
          onClick={() => navigate(isMgr ? '/reports' : '/visits')}
        />
        <Kpi
          value={data.blCustomers.length}
          label="Blacklisted"
          sub={`A ${data.blCustomers.filter((c) => c.blacklist_cat === 'A').length} · B ${data.blCustomers.filter((c) => c.blacklist_cat === 'B').length} · C ${data.blCustomers.filter((c) => c.blacklist_cat === 'C').length}`}
          onClick={() => navigate('/blacklist')}
          alert={data.blCustomers.length > 0}
        />
      </div>

      {user?.role === 'top' && data.eventsWithApprovals.length ? (
        <Panel title="Waiting for your approval" count={data.eventsWithApprovals.length} hot>
          <table>
            <tr>
              <th>Company</th>
              <th>Suggested</th>
              <th>Reason</th>
              <th></th>
            </tr>
            {data.eventsWithApprovals.map((ev) => {
              const c = data.customers.find((x) => x.id === ev.customer_id)
              const mine = !ev.approvals.some((a) => a.approver_id === user.id)
              return (
                <tr className="click" key={ev.id} onClick={() => navigate(`/customers/${ev.customer_id}`)}>
                  <td>
                    <b>{c?.name}</b>
                  </td>
                  <td>
                    <Pill text={'Blacklist ' + ev.cat} cls="p-warn" />
                  </td>
                  <td>{ev.reason}</td>
                  <td className="act" onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm" onClick={() => setEvidenceFor({ id: ev.customer_id, name: c?.name })} type="button">
                      Why?
                    </button>{' '}
                    {mine ? (
                      <>
                        <button className="btn sm primary" onClick={() => decide(ev.id, true)} type="button">
                          Approve
                        </button>{' '}
                        <button className="btn sm danger" onClick={() => decide(ev.id, false)} type="button">
                          Reject
                        </button>
                      </>
                    ) : (
                      <span className="hint">Already decided</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </table>
        </Panel>
      ) : null}

      {user?.role === 'top' && data.pending.exceptions.length ? (
        <Panel title="Exception requests waiting for your approval" count={data.pending.exceptions.length} hot>
          <table>
            <tr>
              <th>Company</th>
              <th>Reason</th>
              <th></th>
            </tr>
            {data.pending.exceptions.map((ex) => {
              const c = data.customers.find((x) => x.id === ex.customer_id)
              return (
                <tr className="click" key={ex.id} onClick={() => navigate(`/customers/${ex.customer_id}`)}>
                  <td>
                    <b>{c?.name}</b>
                  </td>
                  <td>{ex.reason}</td>
                  <td className="act" onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm" onClick={() => setEvidenceFor({ id: ex.customer_id, name: c?.name })} type="button">
                      Why?
                    </button>{' '}
                    <button className="btn sm primary" onClick={() => decideExc(ex.id, true)} type="button">
                      Approve
                    </button>{' '}
                    <button className="btn sm danger" onClick={() => decideExc(ex.id, false)} type="button">
                      Reject
                    </button>
                  </td>
                </tr>
              )
            })}
          </table>
        </Panel>
      ) : null}

      <Panel title="Needs your attention" count={data.todo.length} hot>
        {data.todo.length ? (
          <>
            {visibleTodo.map((t, i) => (
              <div className="todo" key={i}>
                <div className={'ico ' + t.cls}>{t.ico}</div>
                <div className="tx">
                  <div>
                    <b>{t.customer ? <a onClick={() => navigate(`/customers/${t.customer.id}`)}>{t.customer.name}</a> : 'Customer'}</b> — {t.text}
                  </div>
                </div>
                <div className="bt">{todoAction(t)}</div>
              </div>
            ))}
            {data.todo.length > 8 ? (
              <div style={{ padding: '8px 16px' }}>
                <button className="btn sm ghost" onClick={() => setShowAllTodo((s) => !s)} type="button">
                  {showAllTodo ? 'Show less' : `Show all ${data.todo.length}`}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <Empty text="All clear. Bounced emails, link requests, new replies and approvals will appear here." />
        )}
      </Panel>

      {evidenceFor ? <EvidenceModal customerId={evidenceFor.id} customerName={evidenceFor.name} onClose={() => setEvidenceFor(null)} /> : null}
    </div>
  )
}
