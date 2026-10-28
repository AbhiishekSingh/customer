import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useToast } from '../context/ToastContext'
import { Loading, ErrBox, PageHead, Panel, Empty, blPill, fmtDate } from '../components/ui'
import { dotsFor, visitStageText, visitStageCls, latestItemFeedback } from '../lib/domain'
import { displaySrc } from '../components/ImageUpload'

function pieces(items, type) {
  return items.filter((i) => (type ? i.swatch_type === type : true)).reduce((a, i) => a + i.qty, 0)
}

export default function Presentation() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState('overview')
  const [itemsPopupVc, setItemsPopupVc] = useState(null)

  const { data, error, loading } = useApi(async () => {
    const [visit, mails, fabrics, directory] = await Promise.all([
      api.get(`/visits/${id}`),
      api.get(`/visits/${id}/mails`),
      api.get('/fabrics'),
      api.get('/directory/users'),
    ])
    const customer = await api.get(`/customers/${visit.customer_id}`)
    let exceptions = []
    try {
      exceptions = await api.get(`/customers/${visit.customer_id}/exceptions`)
    } catch {
      /* non-managers can't see this — fine, just no banner */
    }
    const fabricById = Object.fromEntries(fabrics.map((f) => [f.id, f]))
    const contactById = Object.fromEntries(customer.contacts.map((c) => [c.id, c]))
    const mailsByVc = {}
    mails.forEach((m) => {
      ;(mailsByVc[m.visit_contact_id] = mailsByVc[m.visit_contact_id] || []).push(m)
    })
    return { visit, customer, fabricById, contactById, mailsByVc, directory, exceptions }
  }, [id])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />
  if (!data) return null

  const { visit: v, customer: c, fabricById, contactById, mailsByVc, directory, exceptions } = data
  const allItems = v.visit_contacts.flatMap((vc) => vc.items)
  const ownerName = directory.find((u) => u.id === v.owner_id)?.name || '—'
  const presenterNames = (v.presented_by || []).map((uid) => directory.find((u) => u.id === uid)?.name).filter(Boolean)
  const usedException = exceptions.find((ex) => ex.used_on_visit_id === v.id)
  const feedbackByItem = latestItemFeedback(Object.values(mailsByVc).flat(), allItems)

  return (
    <div>
      <div className="crumb">
        <a onClick={() => navigate('/entry')}>Customer Visit Entry</a> / <a onClick={() => navigate(`/customers/${c.id}`)}>{c.name}</a>
      </div>
      <PageHead title={<>{c.name} {c.blacklist_cat ? blPill(c.blacklist_cat) : null}</>} sub={`${v.collections || ''} · follow-up emails from ${ownerName}`} />

      {usedException ? (
        <div className="alert warn">
          This visit used an approved Blacklist exception — <i>{usedException.reason}</i>.
        </div>
      ) : null}

      <div className="facts">
        <div>
          <span>People who took swatches</span>
          <b>{v.visit_contacts.length}</b>
        </div>
        <div>
          <span>Hangers</span>
          <b>{pieces(allItems, 'Hanger')}</b>
        </div>
        <div>
          <span>Swatches</span>
          <b>{pieces(allItems, 'Swatch')}</b>
        </div>
        <div>
          <span>Yardage</span>
          <b>{pieces(allItems, 'Yardage')}</b>
        </div>
      </div>

      <div className="tabs">
        {[
          ['overview', 'Overview'],
          ['items', 'Items given'],
          ['followup', 'Follow-up'],
        ].map(([k, l]) => (
          <a key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {l}
          </a>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="card">
          <h4>Visit date</h4>
          <p style={{ margin: '4px 0 10px' }}>{fmtDate(v.date)}</p>
          <h4>Visit purpose</h4>
          <p style={{ margin: '4px 0 10px' }}>{v.collections || '—'}</p>
          <div className="grid g2">
            <div>
              <h4>Logged by</h4>
              <p style={{ margin: '4px 0 10px' }}>{ownerName}</p>
              <h4>Presented by</h4>
              <p style={{ margin: '4px 0 10px' }}>{presenterNames.length ? presenterNames.join(', ') : '—'}</p>
              <h4>Attended</h4>
              <p style={{ margin: '4px 0 0' }}>
                {v.visit_contacts.length
                  ? v.visit_contacts.map((vc) => {
                      const contact = contactById[vc.contact_id]
                      return (
                        <span key={vc.id}>
                          {contact?.name} <span className="muted">({[contact?.designation].filter(Boolean).join(', ') || '—'})</span>
                          <br />
                        </span>
                      )
                    })
                  : '—'}
              </p>
            </div>
            <div>
              <h4>Way forward</h4>
              <p style={{ margin: '4px 0 10px' }}>{v.way_forward || '—'}</p>
              <h4>Notes</h4>
              <p style={{ margin: '4px 0 10px' }}>{v.notes || '—'}</p>
              <h4>Pre-visit attachments</h4>
              {v.attachments && v.attachments.length ? (
                <ul style={{ margin: '4px 0 0' }}>
                  {v.attachments.map((a, i) => (
                    <li key={i}>
                      <a href={a} target="_blank" rel="noreferrer">
                        {a}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: '4px 0 0' }}>—</p>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'items' && (
        <Panel title="Items given at this visit" count={allItems.length}>
          {allItems.length ? (
            <table>
              <tr>
                <th>Person</th>
                <th>Sort no.</th>
                <th>Item</th>
                <th>Colour</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Sentiment</th>
                <th>Feedback</th>
                <th>Attachment</th>
              </tr>
              {v.visit_contacts.map((vc) =>
                vc.items.map((it) => {
                  const fabric = fabricById[it.fabric_id]
                  const contact = contactById[vc.contact_id]
                  const fb = feedbackByItem[it.id]
                  return (
                    <tr key={it.id}>
                      <td>{contact?.name}</td>
                      <td>
                        <b>{fabric?.code}</b>
                      </td>
                      <td>
                        {fabric?.name}
                        <div className="sub">{fabric?.quality_category}</div>
                      </td>
                      <td>{fabric?.colour_variants || '—'}</td>
                      <td>{it.swatch_type}</td>
                      <td>{it.qty}</td>
                      <td>{fb?.sentiment ? <span className="pill p-info">{fb.sentiment}</span> : '—'}</td>
                      <td>
                        {fb?.text || '—'}
                        {fb?.source === 'visit_entry' ? <div className="sub">logged at visit entry{fb.loggedBy ? ` by ${fb.loggedBy}` : ''}</div> : null}
                      </td>
                      <td>
                        {fb?.attachment_url ? (
                          <a href={displaySrc(fb.attachment_url)} target="_blank" rel="noreferrer">
                            View
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </table>
          ) : (
            <Empty text="No items on this visit." />
          )}
        </Panel>
      )}

      {tab === 'followup' && (
        <Panel title="Follow-up tracker" count={v.visit_contacts.length}>
          <div className="dots-legend hint" style={{ padding: '0 16px 10px' }}>
            <span className="dots"><i className="resp" /></span> Replied &nbsp;
            <span className="dots"><i className="sent" /></span> Sent, no reply &nbsp;
            <span className="dots"><i className="bounce" /></span> Bounced &nbsp;
            <span className="dots"><i className="skip" /></span> Not needed &nbsp;
            <span className="dots"><i /></span> Planned
          </div>
          <table>
            <tr>
              <th>Person</th>
              <th>Items given</th>
              <th>Mail 1 → 5</th>
              <th>Next email</th>
              <th>Status</th>
              <th></th>
            </tr>
            {v.visit_contacts.length ? (
              v.visit_contacts.map((vc) => {
                const contact = contactById[vc.contact_id]
                const mails = (mailsByVc[vc.id] || []).slice().sort((a, b) => a.mail_number - b.mail_number)
                const dots = dotsFor(mails)
                const stage = visitStageText(vc, mails)
                const next = mails.find((m) => m.status === 'scheduled')
                return (
                  <tr key={vc.id}>
                    <td className="click" onClick={() => navigate(`/visit/${v.id}/${vc.id}`)}>
                      {contact?.name}
                    </td>
                    <td>
                      <a onClick={(e) => { e.stopPropagation(); setItemsPopupVc(vc.id === itemsPopupVc ? null : vc.id) }}>
                        {vc.items.length} item(s)
                      </a>
                      {itemsPopupVc === vc.id ? (
                        <div className="card" style={{ marginTop: 6, maxWidth: 280 }}>
                          {vc.items.map((it) => (
                            <div key={it.id} className="sub">
                              <b>{fabricById[it.fabric_id]?.code}</b> {fabricById[it.fabric_id]?.name} — {it.swatch_type} ×{it.qty}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="dots">
                        {mails.map((m, i) => (
                          <i
                            key={i}
                            className={(dots[i] === 'resp' ? 'resp' : dots[i] === 'sent' ? 'sent' : dots[i] === 'bounce' ? 'bounce' : dots[i] === 'skip' ? 'skip' : '') + ' click'}
                            title={`Mail ${m.mail_number}`}
                            onClick={() => navigate(`/visit/${v.id}/${vc.id}`)}
                          />
                        ))}
                      </span>
                    </td>
                    <td>{next ? `Mail ${next.mail_number} — ${fmtDate(next.due_date)}` : '—'}</td>
                    <td>
                      <span className={'pill ' + visitStageCls(stage)}>{stage}</span>
                    </td>
                    <td className="act">
                      <a onClick={() => navigate(`/visit/${v.id}/${vc.id}`)}>Open</a>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={6}>
                  <Empty text="No follow-ups on record for this visit." />
                </td>
              </tr>
            )}
          </table>
        </Panel>
      )}
    </div>
  )
}
