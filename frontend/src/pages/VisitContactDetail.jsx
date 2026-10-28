import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Loading, ErrBox, PageHead, Panel, Modal, Field, blPill, fmtDate } from '../components/ui'
import { BL_TEXT, mailName, MAIL_PURPOSE, mailState, respSummary, latestItemFeedback } from '../lib/domain'
import DatePicker from '../components/DatePicker'
import ImageUpload, { displaySrc } from '../components/ImageUpload'

function linkState(m) {
  if (!m.has_token) return m.status === 'sent' ? { t: 'No link sent yet', c: 'p-mute' } : null
  if (!m.first_opened_at) return { t: 'Link sent, not yet opened', c: 'p-info' }
  if (m.link_expires_at && new Date(m.link_expires_at) < new Date()) return { t: 'Link expired', c: 'p-bad' }
  return { t: `Open till ${fmtDate(m.link_expires_at)}`, c: 'p-ok' }
}

export default function VisitContactDetail() {
  const { visitId, vcId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [busyMail, setBusyMail] = useState(null)
  const [respondMail, setRespondMail] = useState(null)
  const [orderModal, setOrderModal] = useState(false)
  const [fixEmailMail, setFixEmailMail] = useState(null)
  const [postponeMail, setPostponeMail] = useState(null)
  const [contentMail, setContentMail] = useState(null)
  const [undoOrderModal, setUndoOrderModal] = useState(false)
  const [historyMail, setHistoryMail] = useState(null)
  const [sendNowMail, setSendNowMail] = useState(null)

  const { data, error, loading, reload } = useApi(async () => {
    const [visit, mails, fabrics, directory] = await Promise.all([
      api.get(`/visits/${visitId}`),
      api.get(`/visits/${visitId}/mails`),
      api.get('/fabrics'),
      api.get('/directory/users'),
    ])
    const vc = visit.visit_contacts.find((x) => x.id === vcId)
    const customer = await api.get(`/customers/${visit.customer_id}`)
    const contact = customer.contacts.find((c) => c.id === vc?.contact_id)
    const vcMails = mails.filter((m) => m.visit_contact_id === vcId).sort((a, b) => a.mail_number - b.mail_number)
    const fabricById = Object.fromEntries(fabrics.map((f) => [f.id, f]))
    return { visit, vc, customer, contact, mails: vcMails, fabricById, ownerName: directory.find((u) => u.id === visit.owner_id)?.name }
  }, [visitId, vcId])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />
  if (!data || !data.vc) return <ErrBox message="Follow-up not found." />

  const { visit: v, vc, customer: c, contact, mails, fabricById, ownerName } = data
  const feedbackByItem = latestItemFeedback(mails, vc.items)

  async function act(mailId, endpoint, body) {
    setBusyMail(mailId)
    try {
      await api.post(`/mails/${mailId}/${endpoint}`, body)
      toast('Done')
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusyMail(null)
    }
  }

  async function doSendNow(mailId, subject, body) {
    setBusyMail(mailId)
    try {
      await api.post(`/mails/${mailId}/send-now`, { subject, body })
      toast('Email sent')
      setSendNowMail(null)
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusyMail(null)
    }
  }

  async function fixBounce(mailId, newEmail) {
    try {
      await api.post(`/mails/${mailId}/fix-bounce?new_email=${encodeURIComponent(newEmail)}`)
      toast('Email fixed — resuming follow-up')
      setFixEmailMail(null)
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  async function doPostpone(mailId, newDueDate, reason) {
    try {
      await api.post(`/mails/${mailId}/postpone?new_due_date=${newDueDate}&reason=${encodeURIComponent(reason)}`)
      toast('Mail postponed')
      setPostponeMail(null)
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  async function doSkip(mailId) {
    const reason = window.prompt("Reason this mail won't be sent:")
    if (!reason) return
    setBusyMail(mailId)
    try {
      await api.post(`/mails/${mailId}/skip?reason=${encodeURIComponent(reason)}`)
      toast('Mail marked — will not be sent')
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusyMail(null)
    }
  }

  async function doUnskip(mailId) {
    setBusyMail(mailId)
    try {
      await api.post(`/mails/${mailId}/unskip`)
      toast('Restored to normal schedule')
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusyMail(null)
    }
  }

  const onHold = mails.some((m) => m.status === 'bounced')

  return (
    <div>
      <div className="crumb">
        <a onClick={() => navigate('/visits')}>Follow-ups</a> / <a onClick={() => navigate(`/customers/${c.id}`)}>{c.name}</a> /{' '}
        <a onClick={() => navigate(`/presentation/${v.id}`)}>Visit {fmtDate(v.date)}</a>
      </div>
      <PageHead
        title={<>{c.name} {c.blacklist_cat ? blPill(c.blacklist_cat) : null}</>}
        sub={`Follow-up for ${contact?.name || ''} · visit on ${fmtDate(v.date)} · emails from ${ownerName || ''}`}
        actions={
          <>
            {!vc.order_placed ? (
              <button className="btn" onClick={() => setOrderModal(true)} type="button">
                Record an order
              </button>
            ) : null}
            <button className="btn primary" onClick={() => setRespondMail(mails[mails.length - 1])} type="button">
              Add a reply (phone / email)
            </button>
          </>
        }
      />

      {onHold ? (
        <div className="alert bad">
          <b>Paused:</b> an email bounced. Fix the email address to continue. A bounced email never counts as "no reply".
        </div>
      ) : vc.order_placed ? (
        <div className="alert ok">
          <b>Order placed</b> on {fmtDate(vc.order_date)} — {(vc.order_fabrics || vc.manual_order_fabrics || []).join(', ')}
          {vc.manual_order_date ? (
            <>
              {' '}
              (recorded by {vc.manual_order_by}
              {vc.manual_order_note ? `: ${vc.manual_order_note}` : ''})
              <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setUndoOrderModal(true)} type="button">
                Undo
              </button>
            </>
          ) : null}
          . Remaining question emails were stopped.
        </div>
      ) : vc.closure_type ? (
        <div className="alert info">
          <b>Customer is not going ahead.</b> Only Mail 5 (new collection invite) is still planned.
        </div>
      ) : null}
      {c.blacklist_cat ? (
        <div className="alert warn">
          <b>Blacklist {c.blacklist_cat}:</b> {BL_TEXT[c.blacklist_cat]?.act}.
        </div>
      ) : null}

      <div className="card">
        <div className="dots-legend hint" style={{ marginBottom: 8 }}>
          <span className="dots"><i className="resp" /></span> Replied &nbsp;
          <span className="dots"><i className="sent" /></span> Sent, no reply &nbsp;
          <span className="dots"><i className="bounce" /></span> Bounced &nbsp;
          <span className="dots"><i className="skip" /></span> Not needed &nbsp;
          <span className="dots"><i /></span> Planned
        </div>
        <div className="tracker">
          <div className="tk done">
            <div className="c">✓</div>
            <b>Visit</b>
            <span>{fmtDate(v.date)}</span>
          </div>
          {mails.map((m) => {
            const s = mailState(m)
            const moved = m.status === 'scheduled' && m.due_date !== m.base_date
            const sub =
              s.k === 'resp'
                ? 'Replied'
                : s.k === 'sent'
                ? `Sent ${fmtDate(m.sent_at)}`
                : s.k === 'bounce'
                ? 'Bounced'
                : s.k === 'skip'
                ? 'Not needed'
                : fmtDate(m.due_date)
            return (
              <div className={'tk ' + s.k} key={m.id}>
                <div className="c">{m.mail_number}</div>
                <b>{mailName(m.mail_number)}</b>
                <span>
                  {sub}
                  {moved ? <div className="hint">(moved from {fmtDate(m.base_date)})</div> : null}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {v.notes ? (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Visit notes</h3>
          <p style={{ margin: 0 }}>{v.notes}</p>
        </div>
      ) : null}

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>
          Swatches taken by {contact?.name} — {vc.items.reduce((a, i) => a + i.qty, 0)} pcs
        </h3>
        <table>
          <tr>
            <th>Sort no.</th>
            <th>Item</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Sentiment</th>
            <th>Feedback</th>
            <th>Attachment</th>
          </tr>
          {vc.items.map((it) => {
            const f = fabricById[it.fabric_id]
            const fb = feedbackByItem[it.id]
            return (
              <tr key={it.id}>
                <td>
                  <b>{f?.code}</b>
                </td>
                <td>
                  {f?.name}
                  <div className="sub">{f?.quality_category}</div>
                </td>
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
          })}
        </table>
      </div>

      <Panel title="Emails">
        <p className="hint" style={{ padding: '0 16px 8px' }}>
          Every email on this follow-up is sent with the customer's marketing team in Cc.
        </p>
        <table>
          <tr>
            <th>Email</th>
            <th>Question to customer</th>
            <th>Date</th>
            <th>Status</th>
            <th>Customer's answer</th>
            <th></th>
          </tr>
          {mails.map((m) => {
            const s = mailState(m)
            const summary = respSummary(m.responses)
            return (
              <tr key={m.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <b>{mailName(m.mail_number)}</b>
                </td>
                <td>{MAIL_PURPOSE[m.mail_number]}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{m.status === 'sent' || m.status === 'bounced' ? fmtDate(m.sent_at) : m.status === 'skipped' ? '—' : fmtDate(m.due_date)}</td>
                <td>
                  <span className={'pill ' + s.c}>{s.t}</span>
                  {m.status === 'sent' && !m.responses.length ? (
                    <div style={{ marginTop: 3 }} className="hint">
                      {(() => {
                        const ls = linkState(m)
                        return ls ? <span className={'pill ' + ls.c}>{ls.t}</span> : null
                      })()}
                      {m.requested_new ? <div>Customer asked for a new link</div> : null}
                    </div>
                  ) : null}
                </td>
                <td className="reply">
                  {summary ? (
                    <>
                      {summary.text || <span className="muted">(no details given)</span>}
                      <br />
                      <small>
                        {summary.by || ''}
                        {summary.designation ? `, ${summary.designation}` : ''} · {fmtDate(summary.at)}
                        {summary.source === 'manual' ? ' · added by team' : ''}
                        {summary.count > 1 ? (
                          <>
                            {' · '}
                            <a onClick={() => setHistoryMail(m)}>{summary.count} versions</a>
                          </>
                        ) : null}
                      </small>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="act">
                  {m.status === 'scheduled' && !onHold ? (
                    <>
                      <button className="btn sm" disabled={busyMail === m.id} onClick={() => setSendNowMail(m)} type="button">
                        Send now
                      </button>{' '}
                      <button className="btn sm" disabled={busyMail === m.id} onClick={() => setPostponeMail(m)} type="button">
                        Change date
                      </button>{' '}
                      <button className="btn sm" disabled={busyMail === m.id} onClick={() => doSkip(m.id)} type="button">
                        Don't send
                      </button>{' '}
                    </>
                  ) : null}
                  {m.status === 'skipped' && (m.note || '').startsWith('Not sent —') ? (
                    <button className="btn sm" disabled={busyMail === m.id} onClick={() => doUnskip(m.id)} type="button">
                      Undo
                    </button>
                  ) : null}
                  {m.status === 'scheduled' || m.status === 'sent' ? (
                    <button className="btn sm" onClick={() => setContentMail(m)} type="button">
                      View
                    </button>
                  ) : null}{' '}
                  {m.status === 'sent' ? (
                    <>
                      <button className="btn sm" onClick={() => setRespondMail(m)} type="button">
                        Add reply
                      </button>{' '}
                      {m.has_token ? (
                        <button className="btn sm" disabled={busyMail === m.id} onClick={() => act(m.id, 'resend-link')} type="button">
                          Send new link
                        </button>
                      ) : null}{' '}
                      {m.unreviewed ? (
                        <button className="btn sm" disabled={busyMail === m.id} onClick={() => act(m.id, 'mark-reviewed')} type="button">
                          Mark reviewed
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {m.status === 'bounced' ? (
                    <button className="btn sm primary" onClick={() => setFixEmailMail(m)} type="button">
                      Fix email
                    </button>
                  ) : null}
                  {user?.role === 'admin' && m.status === 'sent' ? (
                    <button className="btn sm ghost" title="Dev helper" disabled={busyMail === m.id} onClick={() => act(m.id, 'simulate-bounce')} type="button">
                      Simulate bounce
                    </button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </table>
      </Panel>

      {respondMail ? <ManualResponseModal mail={respondMail} mails={mails} vc={vc} fabricById={fabricById} onClose={() => setRespondMail(null)} onDone={reload} /> : null}
      {fixEmailMail ? <FixEmailModal mail={fixEmailMail} contact={contact} onClose={() => setFixEmailMail(null)} onSubmit={fixBounce} /> : null}
      {orderModal ? <RecordOrderModal vc={vc} fabricById={fabricById} onClose={() => setOrderModal(false)} onDone={reload} /> : null}
      {postponeMail ? <PostponeModal mail={postponeMail} onClose={() => setPostponeMail(null)} onSubmit={doPostpone} /> : null}
      {contentMail ? <MailContentModal mail={contentMail} onClose={() => setContentMail(null)} /> : null}
      {historyMail ? <ResponseHistoryModal mail={historyMail} onClose={() => setHistoryMail(null)} /> : null}
      {sendNowMail ? <SendNowModal mail={sendNowMail} busy={busyMail === sendNowMail.id} onClose={() => setSendNowMail(null)} onSend={doSendNow} /> : null}
      {undoOrderModal ? (
        <UndoOrderModal
          onClose={() => setUndoOrderModal(false)}
          onSubmit={async (reason) => {
            try {
              await api.post(`/visits/contacts/${vc.id}/undo-order`, { reason })
              toast('Order undone')
              setUndoOrderModal(false)
              reload()
            } catch (e) {
              toast(e.message)
            }
          }}
        />
      ) : null}
    </div>
  )
}

function UndoOrderModal({ onClose, onSubmit }) {
  const [reason, setReason] = useState('')
  return (
    <Modal
      title="Undo recorded order"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn danger" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())} type="button">
            Undo order
          </button>
        </>
      }
    >
      <p className="hint">This removes the recorded order and restores any question emails it had stopped.</p>
      <Field label="Reason">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this order being undone?" />
      </Field>
    </Modal>
  )
}

function ResponseHistoryModal({ mail, onClose }) {
  return (
    <Modal title={`${mailName(mail.mail_number)} — response history`} wide onClose={onClose} footer={
      <button className="btn" onClick={onClose} type="button">Close</button>
    }>
      {mail.responses.map((r, i) => {
        const parts = Object.entries(r.raw_data || {})
          .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        return (
          <div key={r.id} className="card" style={{ marginBottom: 8 }}>
            <b>Version {i + 1}</b> <span className="hint">· {fmtDate(r.submitted_at)} {r.by_name ? `· ${r.by_name}` : ''}{r.source === 'manual' ? ' · added by team' : ''}</span>
            <p style={{ margin: '6px 0 0' }}>{parts.join(' · ') || <span className="muted">(no details given)</span>}</p>
          </div>
        )
      })}
    </Modal>
  )
}

function PostponeModal({ mail, onClose, onSubmit }) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const [newDueDate, setNewDueDate] = useState(mail.due_date > tomorrow ? mail.due_date : tomorrow)
  const [reason, setReason] = useState('')
  return (
    <Modal
      title={`Change date — ${mailName(mail.mail_number)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">Cancel</button>
          <button className="btn primary" disabled={!reason.trim()} onClick={() => onSubmit(mail.id, newDueDate, reason.trim())} type="button">
            Save new date
          </button>
        </>
      }
    >
      <Field label="New send date">
        <DatePicker value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} min={tomorrow} />
      </Field>
      <Field label="Reason">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this mail being postponed?" />
      </Field>
    </Modal>
  )
}

function MailContentModal({ mail, onClose }) {
  const { data, error, loading } = useApi(() => api.get(`/mails/${mail.id}/content`), [mail.id])
  return (
    <Modal title={`${mailName(mail.mail_number)} content`} wide onClose={onClose} footer={
      <button className="btn" onClick={onClose} type="button">Close</button>
    }>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrBox message={error} />
      ) : (
        <>
          {data.is_preview ? <p className="hint">Not sent yet — this is a live preview of what would be sent now.</p> : null}
          <p style={{ margin: '0 0 4px' }}><b>To:</b> {data.to_email}{data.cc ? ` · cc: ${data.cc}` : ''}</p>
          <p style={{ margin: '0 0 8px' }}><b>Subject:</b> {data.subject}</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{data.body}</pre>
        </>
      )}
    </Modal>
  )
}

function SendNowModal({ mail, busy, onClose, onSend }) {
  const { data, error, loading } = useApi(() => api.get(`/mails/${mail.id}/draft`), [mail.id])
  const [subject, setSubject] = useState(null)
  const [body, setBody] = useState(null)

  if (!loading && !error && data && subject === null) {
    setSubject(data.subject)
    setBody(data.body)
  }

  const linkCount = body ? (body.match(/\{link\}/g) || []).length : 0
  const linkOk = linkCount === 1
  const canSend = !!(subject && subject.trim() && body && body.trim() && linkOk)

  return (
    <Modal
      title={`Review ${mailName(mail.mail_number)} before sending`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" disabled={!canSend || busy} onClick={() => onSend(mail.id, subject, body)} type="button">
            {busy ? 'Sending…' : 'Send email'}
          </button>
        </>
      }
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrBox message={error} />
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            This is exactly what will be emailed. You can edit it here for just this one send — the saved template everyone else uses is untouched.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <b>To:</b> {data.to_email}
            {data.cc ? ` · cc: ${data.cc}` : ''}
          </p>
          <Field label="Subject">
            <input value={subject || ''} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Body" hint="{link} is the customer's one-time response link — it must appear exactly once; it's replaced with the real link the moment this sends.">
            <textarea rows={10} value={body || ''} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {!linkOk ? (
            <ErrBox message={linkCount === 0 ? 'The body must include {link} — without it the customer has no way to respond.' : '{link} can only appear once in the body.'} />
          ) : null}
        </>
      )}
    </Modal>
  )
}

function FixEmailModal({ mail, contact, onClose, onSubmit }) {
  const [email, setEmail] = useState(contact?.email || '')
  return (
    <Modal title="Fix bounced email" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose} type="button">Cancel</button>
        <button className="btn primary" onClick={() => onSubmit(mail.id, email)} type="button">Resume follow-up</button>
      </>
    }>
      <Field label="Correct email address">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
    </Modal>
  )
}

function RecordOrderModal({ vc, fabricById, onClose, onDone }) {
  const toast = useToast()
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [codes, setCodes] = useState(() => new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const availableCodes = [...new Set(vc.items.map((i) => fabricById[i.fabric_id]?.code).filter(Boolean))]

  function toggle(code) {
    setCodes((s) => {
      const next = new Set(s)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  async function submit() {
    setBusy(true)
    try {
      await api.post(`/visits/contacts/${vc.id}/record-order`, { order_date: orderDate, fabric_codes: [...codes], note: note || null })
      toast('Order recorded')
      onDone()
      onClose()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Record an order"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !codes.size} onClick={submit} type="button">
            {busy ? 'Saving…' : 'Record order'}
          </button>
        </>
      }
    >
      <Field label="Order date">
        <DatePicker value={orderDate} onChange={(e) => setOrderDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
      </Field>
      <Field label="Which sort no.s were ordered?">
        <div className="chips">
          {availableCodes.map((code) => (
            <label key={code} className="chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={codes.has(code)} onChange={() => toggle(code)} style={{ marginRight: 4 }} />
              {code}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Note" hint="Optional">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}

function ManualResponseModal({ mail, mails, vc, fabricById, onClose, onDone }) {
  const toast = useToast()
  const [mailId, setMailId] = useState(mail.id)
  const activeMail = (mails || [mail]).find((m) => m.id === mailId) || mail
  const n = activeMail.mail_number
  const [byName, setByName] = useState('')
  const [byDesignation, setByDesignation] = useState('')
  const [feedback, setFeedback] = useState('')
  const [received, setReceived] = useState('')
  const [testStatus, setTestStatus] = useState('')
  const [proto, setProto] = useState('')
  const [orderPlaced, setOrderPlaced] = useState('')
  const [orderFabrics, setOrderFabrics] = useState(new Set())
  const [interested, setInterested] = useState('')
  const [notProceeding, setNotProceeding] = useState(false)
  const [itemFb, setItemFb] = useState({}) // visit_item_id -> {sentiment, text, attachment_url}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const availableCodes = [...new Set(vc.items.map((i) => fabricById[i.fabric_id]?.code).filter(Boolean))]

  function toggleFabric(code) {
    setOrderFabrics((s) => {
      const next = new Set(s)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }
  function updateItemFb(itemId, field, value) {
    setItemFb((f) => ({ ...f, [itemId]: { ...f[itemId], [field]: value } }))
  }

  async function submit() {
    setErr('')
    const data = {}
    if (received) data.received = received
    if (testStatus) data.testStatus = testStatus
    if (proto) data.proto = proto
    if (orderPlaced) {
      data.orderPlaced = orderPlaced
      if (orderPlaced === 'yes') data.orderFabrics = [...orderFabrics]
    }
    if (interested) data.interested = interested
    if (notProceeding) data.notProceeding = true
    if (feedback.trim()) data.feedback = feedback.trim()
    const itemFeedback = Object.entries(itemFb)
      .filter(([, v]) => (v.sentiment) || (v.text && v.text.trim()) || (v.attachment_url && v.attachment_url.trim()))
      .map(([visit_item_id, v]) => ({ visit_item_id, sentiment: v.sentiment || null, text: v.text?.trim() || null, attachment_url: v.attachment_url?.trim() || null }))
    if (!Object.keys(data).length && !itemFeedback.length) {
      setErr('Answer at least one question below, or give feedback for an item')
      return
    }
    setBusy(true)
    try {
      await api.post(`/mails/${mailId}/manual-response`, {
        data,
        item_feedback: itemFeedback,
        by_name: byName || null,
        by_designation: byDesignation || null,
      })
      toast('Reply recorded')
      onDone()
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Add a reply — ${mailName(n)}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={submit} type="button">
            {busy ? 'Saving…' : 'Save reply'}
          </button>
        </>
      }
    >
      {mails && mails.length > 1 ? (
        <Field label="Which email is this reply for?" hint="A phone call or walk-in answer can be attached to a different mail in the sequence than the one you opened this from">
          <select value={mailId} onChange={(e) => setMailId(e.target.value)}>
            {mails.map((m) => (
              <option key={m.id} value={m.id}>
                {mailName(m.mail_number)} — {MAIL_PURPOSE[m.mail_number]}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <ErrBox message={err} />
      <div className="grid g2">
        <Field label="Who gave this answer?">
          <input value={byName} onChange={(e) => setByName(e.target.value)} placeholder="Name" />
        </Field>
        <Field label="Designation">
          <input value={byDesignation} onChange={(e) => setByDesignation(e.target.value)} />
        </Field>
      </div>

      {n === 1 ? (
        <Field label="Swatches received?">
          <div className="opt">
            {[['all', 'Received all'], ['partial', 'Some missing'], ['none', 'Not received']].map(([k, l]) => (
              <label key={k}>
                <input type="radio" name="received" checked={received === k} onChange={() => setReceived(k)} /> {l}
              </label>
            ))}
          </div>
        </Field>
      ) : null}
      {n === 2 ? (
        <Field label="Testing status">
          <div className="opt">
            {[['not_started', 'Not started'], ['in_progress', 'In progress'], ['approved', 'Approved'], ['issues', 'Issues found']].map(([k, l]) => (
              <label key={k}>
                <input type="radio" name="testStatus" checked={testStatus === k} onChange={() => setTestStatus(k)} /> {l}
              </label>
            ))}
          </div>
        </Field>
      ) : null}
      {n === 3 ? (
        <Field label="Prototype sample">
          <div className="opt">
            {[['yes', 'Made'], ['in_progress', 'In progress'], ['no', 'Not made']].map(([k, l]) => (
              <label key={k}>
                <input type="radio" name="proto" checked={proto === k} onChange={() => setProto(k)} /> {l}
              </label>
            ))}
          </div>
        </Field>
      ) : null}
      {n === 4 ? (
        <>
          <Field label="Order decision">
            <div className="opt">
              {[['yes', 'Order placed'], ['planning', 'Planning to order'], ['no', 'No order']].map(([k, l]) => (
                <label key={k}>
                  <input type="radio" name="orderPlaced" checked={orderPlaced === k} onChange={() => setOrderPlaced(k)} /> {l}
                </label>
              ))}
            </div>
          </Field>
          {orderPlaced === 'yes' ? (
            <Field label="Which sort no.s were ordered?">
              <div className="chips">
                {availableCodes.map((code) => (
                  <label key={code} className="chip" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={orderFabrics.has(code)} onChange={() => toggleFabric(code)} style={{ marginRight: 4 }} />
                    {code}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
        </>
      ) : null}
      {n === 5 ? (
        <Field label="Interested in the next collection?">
          <div className="opt">
            {[['yes', 'Yes'], ['no', 'Not interested now']].map(([k, l]) => (
              <label key={k}>
                <input type="radio" name="interested" checked={interested === k} onChange={() => setInterested(k)} /> {l}
              </label>
            ))}
          </div>
        </Field>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={notProceeding} onChange={(e) => setNotProceeding(e.target.checked)} /> Customer is not going ahead with this collection
      </label>
      <Field label="Feedback / notes" hint="Optional free text">
        <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </Field>

      <h4 style={{ margin: '14px 0 6px' }}>Per-item feedback (optional)</h4>
      {vc.items.map((it) => {
        const f = fabricById[it.fabric_id]
        const v = itemFb[it.id] || {}
        return (
          <div key={it.id} className="person">
            <div className="ph">
              <span style={{ flex: '0 0 110px' }}>
                <b>{f?.code}</b> {f?.name}
              </span>
              <select style={{ flex: '0 1 130px' }} value={v.sentiment || ''} onChange={(e) => updateItemFb(it.id, 'sentiment', e.target.value)}>
                <option value="">— sentiment —</option>
                <option value="Positive">Positive</option>
                <option value="Neutral">Neutral</option>
                <option value="Negative">Negative</option>
              </select>
              <input style={{ flex: '1 1 160px' }} placeholder="What did they say?" value={v.text || ''} onChange={(e) => updateItemFb(it.id, 'text', e.target.value)} />
              <ImageUpload value={v.attachment_url || ''} onChange={(url) => updateItemFb(it.id, 'attachment_url', url)} label="Attach photo" />
            </div>
          </div>
        )
      })}
    </Modal>
  )
}
