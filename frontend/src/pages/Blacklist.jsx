import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { Loading, ErrBox, PageHead, Panel, Empty, Pill, fmtDate } from '../components/ui'
import { BL_TEXT } from '../lib/domain'
import EvidenceModal from '../components/EvidenceModal'

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
    return { events: eventsWithApprovals, exceptions: pending.exceptions, custById, userById, blacklisted, bCandidates }
  }, [])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const { events, exceptions, custById, userById, blacklisted, bCandidates } = data
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
        {events.length ? (
          <table>
            <tr>
              <th>Company</th>
              <th>Suggested</th>
              <th>Reason</th>
              <th>Approvals</th>
            </tr>
            {events.map((ev) => {
              const c = custById[ev.customer_id]
              const mine = isTop && !ev.approvals.some((a) => a.approver_id === user.id)
              return (
                <tr className="click" key={ev.id} onClick={() => navigate(`/customers/${ev.customer_id}`)}>
                  <td>
                    <b>{c?.name}</b>
                    <div className="sub">{userById[c?.owner_id]?.name}</div>
                  </td>
                  <td>
                    <Pill text={'Blacklist ' + ev.cat} cls="p-warn" />
                    <div className="sub">{fmtDate(ev.created_at)}</div>
                  </td>
                  <td>{ev.reason}</td>
                  <td className="act" onClick={(e) => e.stopPropagation()}>
                    {approvalChips(ev.approvals)} {whyBtn(ev.customer_id, c?.name)}
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
                  </td>
                </tr>
              )
            })}
          </table>
        ) : (
          <Empty text="Nothing waiting." />
        )}
      </Panel>

      {bCandidates.length ? (
        <Panel title="Blacklist B — waiting for the account owner's confirmation" count={bCandidates.length} hot>
          <p className="hint" style={{ padding: '10px 16px 0', margin: 0 }}>
            These companies replied but never gave feedback or a decision. Blacklist B applies only if they now talk only to the marketing team — confirm if that is true, and the suggestion goes to Top Management.
          </p>
          <table>
            <tr>
              <th>Company</th>
              <th>Last visit</th>
              <th></th>
            </tr>
            {bCandidates.map((bc) => (
              <tr className="click" key={bc.customer_id} onClick={() => navigate(`/customers/${bc.customer_id}`)}>
                <td>
                  <b>{bc.customer_name}</b>
                  <div className="sub">{userById[bc.owner_id]?.name}</div>
                </td>
                <td>{fmtDate(bc.visit_date)}</td>
                <td className="act" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm primary" onClick={() => confirmMarketingOnly(bc.customer_id)} type="button">
                    Confirm: only talks to marketing
                  </button>
                </td>
              </tr>
            ))}
          </table>
        </Panel>
      ) : null}

      {exceptions.length ? (
        <Panel title="Exception requests — give new swatches to a blacklisted company" count={exceptions.length} hot>
          <table>
            <tr>
              <th>Company</th>
              <th>Asked by</th>
              <th>Reason</th>
              <th></th>
            </tr>
            {exceptions.map((ex) => {
              const c = custById[ex.customer_id]
              const mine = isTop
              return (
                <tr className="click" key={ex.id} onClick={() => navigate(`/customers/${ex.customer_id}`)}>
                  <td>
                    <b>{c?.name}</b>
                  </td>
                  <td>
                    {userById[ex.requested_by]?.name}
                    <div className="sub">{fmtDate(ex.created_at)}</div>
                  </td>
                  <td>{ex.reason}</td>
                  <td className="act" onClick={(e) => e.stopPropagation()}>
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
                  </td>
                </tr>
              )
            })}
          </table>
        </Panel>
      ) : null}

      <Panel title="Blacklisted companies" count={blacklisted.length}>
        {blacklisted.length ? (
          <table>
            <tr>
              <th>Company</th>
              <th>Category</th>
              <th></th>
            </tr>
            {blacklisted.map((c) => (
              <tr className="click" key={c.id} onClick={() => navigate(`/customers/${c.id}`)}>
                <td>
                  <b>{c.name}</b>
                  <div className="sub">{userById[c.owner_id]?.name}</div>
                </td>
                <td>
                  <Pill text={'Blacklist ' + c.blacklist_cat} cls="p-bad" />
                </td>
                <td className="act" onClick={(e) => e.stopPropagation()}>
                  {whyBtn(c.id, c.name)}{' '}
                  {isAdmin ? (
                    <button className="btn sm" onClick={() => removeFromBlacklist(c.id, c.name, c.blacklist_cat)} type="button">
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </table>
        ) : (
          <Empty text="No blacklisted companies." />
        )}
      </Panel>

      {evidenceFor ? <EvidenceModal customerId={evidenceFor.id} customerName={evidenceFor.name} onClose={() => setEvidenceFor(null)} /> : null}
    </div>
  )
}
