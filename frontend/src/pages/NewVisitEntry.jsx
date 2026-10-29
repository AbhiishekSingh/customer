import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { PageHead, ErrBox, Field, Loading, fmtDate, cleanPhone } from '../components/ui'
import { BL_TEXT } from '../lib/domain'
import Icon from '../components/Icon'
import EvidenceModal from '../components/EvidenceModal'
import DatePicker from '../components/DatePicker'
import ImageUpload from '../components/ImageUpload'

const SWATCH_TYPES = ['Hanger', 'Swatch', 'Yardage']
const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function NewVisitEntry() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const preselected = params.get('customer') || ''

  const { data: customers, error: custErr, loading: custLoading, reload: reloadCustomers } = useApi(() => api.get('/customers'), [])
  const { data: fabrics, loading: fabLoading } = useApi(() => api.get('/fabrics', { active_only: true }), [])
  const { data: directory } = useApi(() => api.get('/directory/users'), [])

  const [customerId, setCustomerId] = useState(preselected)
  const [showEvidence, setShowEvidence] = useState(false)
  const [custExceptions, setCustExceptions] = useState([])
  const [reqBusy, setReqBusy] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [collections, setCollections] = useState('')
  const [wayForward, setWayForward] = useState('')
  const [presentedBy, setPresentedBy] = useState([])
  const [attachments, setAttachments] = useState([''])
  const [attendeeIds, setAttendeeIds] = useState([])
  const [lines, setLines] = useState([{ representative_contact_id: '', fabric_code: '', swatch_type: 'Hanger', qty: 1 }])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [itemFeedback, setItemFeedback] = useState({}) // { [lineIndex]: {sentiment, text, attachment_url} }
  const [swatchHistory, setSwatchHistory] = useState([])
  const [newAttendee, setNewAttendee] = useState(null) // {team_name, name, designation, email, phone} or null when closed
  const [addingAttendee, setAddingAttendee] = useState(false)

  const customer = useMemo(() => customers?.find((c) => c.id === customerId), [customers, customerId])
  const activeContacts = useMemo(() => (customer ? customer.contacts.filter((c) => c.status === 'active') : []), [customer])

  useEffect(() => {
    if (!customer?.blacklist_cat) {
      setCustExceptions([])
      return
    }
    api.get(`/customers/${customer.id}/exceptions`).then(setCustExceptions).catch(() => setCustExceptions([]))
  }, [customer?.id, customer?.blacklist_cat])

  useEffect(() => {
    if (!customer) {
      setSwatchHistory([])
      return
    }
    api.get(`/customers/${customer.id}/swatch-history`).then(setSwatchHistory).catch(() => setSwatchHistory([]))
  }, [customer?.id])

  function togglePresenter(id) {
    setPresentedBy((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }
  function updateAttachment(i, value) {
    setAttachments((a) => a.map((x, idx) => (idx === i ? value : x)))
  }
  function addAttachment() {
    setAttachments((a) => [...a, ''])
  }
  function removeAttachment(i) {
    setAttachments((a) => a.filter((_, idx) => idx !== i))
  }

  async function saveNewAttendee() {
    if (!newAttendee.name.trim()) {
      toast('Name is required')
      return
    }
    setAddingAttendee(true)
    try {
      const existing = customer.contacts.map((x) => ({
        id: x.id, team_name: customer.teams.find((t) => t.id === x.team_id)?.name || '', name: x.name,
        designation: x.designation, email: x.email, phone: x.phone, primary: x.primary, senior: x.senior,
      }))
      const updated = await api.put(`/customers/${customer.id}/contacts`, [...existing, { ...newAttendee }])
      toast('Person added')
      setNewAttendee(null)
      reloadCustomers()
      const addedContact = updated.contacts.find((x) => x.name === newAttendee.name && !existing.some((e) => e.id === x.id))
      if (addedContact) setAttendeeIds((ids) => [...ids, addedContact.id])
    } catch (e2) {
      toast(e2.message)
    } finally {
      setAddingAttendee(false)
    }
  }

  const pendingExc = custExceptions.find((e) => e.status === 'pending')
  const approvedExc = custExceptions.find((e) => e.status === 'approved')
  const blocked = Boolean(customer?.blacklist_cat) && !approvedExc

  async function requestExceptionHere() {
    const reason = window.prompt('Reason for requesting an exception (every Top Management member must approve):')
    if (!reason) return
    setReqBusy(true)
    try {
      await api.post(`/customers/${customer.id}/exceptions`, { reason })
      toast('Exception requested')
      const list = await api.get(`/customers/${customer.id}/exceptions`)
      setCustExceptions(list)
    } catch (e2) {
      toast(e2.message)
    } finally {
      setReqBusy(false)
    }
  }

  function toggleAttendee(id) {
    setAttendeeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
    setLines((ls) => ls.map((l) => (l.representative_contact_id === id ? l : l)))
  }
  function updateLine(i, field, value) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, { representative_contact_id: '', fabric_code: '', swatch_type: 'Hanger', qty: 1 }])
  }
  function removeLine(i) {
    setLines((ls) => ls.filter((_, idx) => idx !== i))
  }

  const validLines = lines.filter((l) => l.representative_contact_id && l.fabric_code)

  function goToReview(e) {
    e.preventDefault()
    setErr('')
    if (!customerId) return setErr('Select the company')
    if (blocked) return setErr(`${customer.name} is blacklisted — an approved exception from all Top Management is needed before swatches can be given`)
    if (!attendeeIds.length) return setErr('Add at least one attendee')
    if (!validLines.length) return setErr('Add at least one swatch line')
    setReviewing(true)
  }

  function updateItemFeedback(i, field, value) {
    setItemFeedback((s) => ({ ...s, [i]: { ...s[i], [field]: value } }))
  }

  async function doSave() {
    setBusy(true)
    try {
      const visit = await api.post('/visits', {
        customer_id: customerId,
        date,
        collections,
        way_forward: wayForward || null,
        presented_by: presentedBy,
        attachments: attachments.map((a) => a.trim()).filter(Boolean),
        attendee_contact_ids: attendeeIds,
        lines: validLines.map((l, i) => ({
          ...l,
          qty: parseInt(l.qty, 10) || 1,
          sentiment: itemFeedback[i]?.sentiment || null,
          feedback_text: itemFeedback[i]?.text?.trim() || null,
          attachment_url: itemFeedback[i]?.attachment_url?.trim() || null,
        })),
      })
      toast('Visit recorded')
      navigate(`/presentation/${visit.id}`)
    } catch (e2) {
      setErr(e2.message)
      setReviewing(false)
    } finally {
      setBusy(false)
    }
  }

  if (custLoading || fabLoading) return <Loading />
  if (custErr) return <ErrBox message={custErr} />

  return (
    <div>
      <div className="crumb">
        <a onClick={() => navigate('/entry')}>Customer Visit Entry</a>
      </div>
      <PageHead title="New visit entry" sub="Record who attended and what each person took. Every attendee with items gets their own 5-mail follow-up schedule." />

      {reviewing ? (
        <ReviewStep
          customer={customer}
          date={date}
          collections={collections}
          wayForward={wayForward}
          presenterNames={presentedBy.map((id) => directory?.find((u) => u.id === id)?.name).filter(Boolean)}
          attachments={attachments.filter((a) => a.trim())}
          attendees={activeContacts.filter((p) => attendeeIds.includes(p.id))}
          lines={validLines}
          fabrics={fabrics}
          itemFeedback={itemFeedback}
          onFeedbackChange={updateItemFeedback}
          busy={busy}
          err={err}
          onBack={() => setReviewing(false)}
          onConfirm={doSave}
        />
      ) : (
      <form onSubmit={goToReview}>
        <ErrBox message={err} />
        <div className="card">
          <div className="grid g3">
            <Field label="Company">
              <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAttendeeIds([]) }} required>
                <option value="">— select —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visit date">
              <DatePicker value={date} onChange={(e) => setDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} required />
            </Field>
            <Field label="Collection / purpose">
              <input value={collections} onChange={(e) => setCollections(e.target.value)} placeholder="e.g. SS26 preview" required />
            </Field>
          </div>
          <Field label="Way forward / notes" hint="Optional">
            <textarea value={wayForward} onChange={(e) => setWayForward(e.target.value)} />
          </Field>
          <Field label="Presented by" hint="Who from your side presented, if different from who's logging this">
            <div className="chips">
              {(directory || []).filter((u) => u.is_active).map((u) => (
                <label key={u.id} className="chip" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={presentedBy.includes(u.id)} onChange={() => togglePresenter(u.id)} style={{ marginRight: 4 }} />
                  {u.name}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Pre-visit attachments" hint="Paste links to reference material (deck, catalogue, etc.)">
            {attachments.map((a, i) => (
              <div key={i} className="row" style={{ marginBottom: 4 }}>
                <input value={a} onChange={(e) => updateAttachment(i, e.target.value)} placeholder="https://…" />
                {attachments.length > 1 ? (
                  <button type="button" className="btn ghost sm icon-btn" onClick={() => removeAttachment(i)} title="Remove">
                    <Icon name="x" size={13} />
                  </button>
                ) : null}
              </div>
            ))}
            <button type="button" className="btn sm" onClick={addAttachment}>
              ＋ Add link
            </button>
          </Field>
        </div>

        {customer && swatchHistory.length ? (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Earlier swatches to this company</h3>
            <table>
              <tr>
                <th>Visit date</th>
                <th>Given to</th>
                <th>Fabric</th>
                <th>Ordered?</th>
              </tr>
              {swatchHistory.slice(0, 8).map((h, i) => (
                <tr key={i}>
                  <td>{fmtDate(h.visit_date)}</td>
                  <td>{h.contact_name}</td>
                  <td>
                    <b>{h.fabric_code}</b> {h.fabric_name}
                  </td>
                  <td>{h.ordered ? 'Yes' : '—'}</td>
                </tr>
              ))}
            </table>
            {swatchHistory.length > 8 ? <p className="hint">…and {swatchHistory.length - 8} more — see the Customer page's Swatch history tab.</p> : null}
          </div>
        ) : null}

        {customer?.blacklist_cat ? (
          <div className="alert bad">
            <b>Blacklist {customer.blacklist_cat}</b> — {BL_TEXT[customer.blacklist_cat]?.act}.{' '}
            <button className="btn sm" onClick={() => setShowEvidence(true)} type="button">
              Why?
            </button>
            <br />
            No new swatches to any team of this company unless all Top Management approve an exception.
            {approvedExc ? (
              <div style={{ marginTop: 6 }}>An exception has been approved — you may proceed.</div>
            ) : pendingExc ? (
              <div style={{ marginTop: 6 }}>
                <b>Exception requested</b>: {pendingExc.reason} — waiting for Top Management.
              </div>
            ) : (
              isMgr(user?.role) && (
                <div style={{ marginTop: 6 }}>
                  <button className="btn sm" onClick={requestExceptionHere} disabled={reqBusy} type="button">
                    Request an exception from Top Management
                  </button>
                </div>
              )
            )}
          </div>
        ) : null}

        {customer && !blocked ? (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Attendees</h3>
            {activeContacts.length ? (
              <div className="chips">
                {activeContacts.map((p) => (
                  <label key={p.id} className="chip" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={attendeeIds.includes(p.id)} onChange={() => toggleAttendee(p.id)} style={{ marginRight: 4 }} />
                    {p.name}
                    {p.designation ? <span className="muted"> · {p.designation}</span> : null}
                  </label>
                ))}
              </div>
            ) : (
              <p className="hint">This company has no active contacts yet — add one below.</p>
            )}

            {newAttendee ? (
              <div className="person" style={{ marginTop: 10 }}>
                <div className="ph">
                  <input style={{ flex: '1 1 140px' }} placeholder="Team" value={newAttendee.team_name} onChange={(e) => setNewAttendee({ ...newAttendee, team_name: e.target.value })} />
                  <input style={{ flex: '1 1 140px' }} placeholder="Name" value={newAttendee.name} onChange={(e) => setNewAttendee({ ...newAttendee, name: e.target.value })} />
                  <input style={{ flex: '1 1 140px' }} placeholder="Designation" value={newAttendee.designation} onChange={(e) => setNewAttendee({ ...newAttendee, designation: e.target.value })} />
                  <input style={{ flex: '1 1 180px' }} placeholder="Email" type="email" value={newAttendee.email} onChange={(e) => setNewAttendee({ ...newAttendee, email: e.target.value })} />
                  <input style={{ flex: '1 1 140px' }} placeholder="Phone" inputMode="tel" value={newAttendee.phone} onChange={(e) => setNewAttendee({ ...newAttendee, phone: cleanPhone(e.target.value) })} />
                  <button type="button" className="btn ghost sm icon-btn" onClick={() => setNewAttendee(null)} title="Cancel">
                    <Icon name="x" size={13} />
                  </button>
                  <button type="button" className="btn sm primary" disabled={addingAttendee} onClick={saveNewAttendee}>
                    {addingAttendee ? 'Saving…' : 'Add'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn sm"
                style={{ marginTop: 10 }}
                onClick={() => setNewAttendee({ team_name: '', name: '', designation: '', email: '', phone: '', primary: false, senior: false })}
              >
                ＋ New person (not in contacts yet)
              </button>
            )}
          </div>
        ) : null}

        {attendeeIds.length && !blocked ? (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Swatches / hangers given</h3>
            {lines.map((l, i) => (
              <div className="person" key={i}>
                <div className="ph">
                  <select style={{ flex: '1 1 160px' }} value={l.representative_contact_id} onChange={(e) => updateLine(i, 'representative_contact_id', e.target.value)}>
                    <option value="">— attendee —</option>
                    {activeContacts.filter((p) => attendeeIds.includes(p.id)).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    style={{ flex: '1 1 160px' }}
                    placeholder="Sort no. (fabric code)"
                    value={l.fabric_code}
                    onChange={(e) => updateLine(i, 'fabric_code', e.target.value.toUpperCase())}
                    list="fabric-codes"
                  />
                  <select style={{ flex: '0 1 130px' }} value={l.swatch_type} onChange={(e) => updateLine(i, 'swatch_type', e.target.value)}>
                    {SWATCH_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input className="qty" type="number" min="1" value={l.qty} onChange={(e) => updateLine(i, 'qty', e.target.value)} />
                  {lines.length > 1 ? (
                    <button type="button" className="btn ghost sm icon-btn" onClick={() => removeLine(i)} title="Remove">
                      <Icon name="x" size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            <datalist id="fabric-codes">
              {fabrics.map((f) => (
                <option key={f.id} value={f.code}>
                  {f.name}
                </option>
              ))}
            </datalist>
            <button type="button" className="btn sm" onClick={addLine}>
              ＋ Add line
            </button>
          </div>
        ) : null}

        <div className="row end">
          <button type="button" className="btn" onClick={() => navigate('/entry')}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || blocked}>
            Review &amp; save
          </button>
        </div>
      </form>
      )}

      {showEvidence && customer ? (
        <EvidenceModal customerId={customer.id} customerName={customer.name} onClose={() => setShowEvidence(false)} />
      ) : null}
    </div>
  )
}

function ReviewStep({ customer, date, collections, wayForward, presenterNames, attachments, attendees, lines, fabrics, itemFeedback, onFeedbackChange, busy, err, onBack, onConfirm }) {
  const fabricByCode = Object.fromEntries((fabrics || []).map((f) => [f.code, f]))
  return (
    <div className="card">
      <ErrBox message={err} />
      <h3 style={{ marginBottom: 8 }}>Review before saving</h3>
      <p className="hint">Check the details below — saving creates the 5-mail follow-up schedule for every attendee listed with items.</p>
      <div className="grid g3" style={{ margin: '10px 0' }}>
        <Field label="Company">
          <div>{customer?.name}</div>
        </Field>
        <Field label="Visit date">
          <div>{fmtDate(date)}</div>
        </Field>
        <Field label="Collection / purpose">
          <div>{collections}</div>
        </Field>
      </div>
      {wayForward ? (
        <Field label="Way forward / notes">
          <div>{wayForward}</div>
        </Field>
      ) : null}
      <Field label="Presented by">
        <div>{presenterNames.length ? presenterNames.join(', ') : '—'}</div>
      </Field>
      {attachments.length ? (
        <Field label="Attachments">
          <ul>
            {attachments.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Field>
      ) : null}
      <h4 style={{ margin: '14px 0 6px' }}>Attendees ({attendees.length})</h4>
      <div className="chips">
        {attendees.map((p) => (
          <span key={p.id} className="chip">
            {p.name}
            {p.designation ? <span className="muted"> · {p.designation}</span> : null}
          </span>
        ))}
      </div>
      <h4 style={{ margin: '14px 0 6px' }}>Items given</h4>
      <p className="hint" style={{ marginTop: 0 }}>
        If the customer already reacted to a swatch on the spot, you can log it here — otherwise leave it blank and it'll come in through the follow-up emails.
      </p>
      <table>
        <tr>
          <th>Attendee</th>
          <th>Fabric</th>
          <th>Type</th>
          <th>Qty</th>
          <th>Sentiment</th>
          <th>Note</th>
          <th>Photo</th>
        </tr>
        {lines.map((l, i) => {
          const p = attendees.find((a) => a.id === l.representative_contact_id)
          const f = fabricByCode[l.fabric_code]
          const fb = itemFeedback[i] || {}
          return (
            <tr key={i}>
              <td>{p?.name || '—'}</td>
              <td>
                <b>{l.fabric_code}</b> {f?.name || ''}
              </td>
              <td>{l.swatch_type}</td>
              <td>{l.qty}</td>
              <td>
                <select style={{ width: 'auto' }} value={fb.sentiment || ''} onChange={(e) => onFeedbackChange(i, 'sentiment', e.target.value)}>
                  <option value="">— rate —</option>
                  <option value="Positive">Good</option>
                  <option value="Neutral">Okay</option>
                  <option value="Negative">Issue</option>
                </select>
              </td>
              <td>
                <input placeholder="Any note on this item…" value={fb.text || ''} onChange={(e) => onFeedbackChange(i, 'text', e.target.value)} />
              </td>
              <td>
                <ImageUpload value={fb.attachment_url || ''} onChange={(url) => onFeedbackChange(i, 'attachment_url', url)} label="Photo" />
              </td>
            </tr>
          )
        })}
      </table>
      <div className="row end" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={onBack} disabled={busy}>
          ← Back to edit
        </button>
        <button type="button" className="btn primary" onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : 'Confirm & save visit'}
        </button>
      </div>
    </div>
  )
}
