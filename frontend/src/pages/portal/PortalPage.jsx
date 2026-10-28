import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../../api/client'
import { fmtDate } from '../../components/ui'
import DatePicker from '../../components/DatePicker'
import ImageUpload, { displaySrc } from '../../components/ImageUpload'

export default function PortalPage() {
  const { token } = useParams()
  const [status, setStatus] = useState(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    // Read-only load — never starts the link's validity timer. The timer only starts once the
    // customer explicitly clicks through from the welcome screen (see WelcomeCard below).
    api
      .get(`/portal/${token}`, undefined, { auth: false })
      .then(setStatus)
      .catch((e) => setErr(e.message || 'Could not load this link.'))
  }, [token])

  function reload() {
    api.get(`/portal/${token}`, undefined, { auth: false }).then(setStatus).catch((e) => setErr(e.message))
  }

  async function startViewing() {
    setOpening(true)
    try {
      const s = await api.post(`/portal/${token}/open`, undefined, { auth: false })
      setStatus(s)
    } catch (e) {
      setErr(e.message)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="portal">
      <div className="portal-wrap">
        <div className="portal-brand">
          <div className="logo">AF</div>
          <b>Aditya Birla Group — Customer Follow-Up</b>
        </div>
        {err ? (
          <div className="card">
            <div className="err-box">{err}</div>
          </div>
        ) : !status ? (
          <div className="card">Loading…</div>
        ) : status.state === 'not_found' ? (
          <div className="card">
            <h2>Link not found</h2>
            <p>This link isn't valid. Please use the link from your most recent email.</p>
          </div>
        ) : status.state === 'superseded' ? (
          <div className="card">
            <h2>A newer link was sent</h2>
            <p>Please use the link from your latest email instead.</p>
          </div>
        ) : status.state === 'expired' ? (
          <ExpiredCard token={token} status={status} />
        ) : !status.opened ? (
          <WelcomeCard status={status} busy={opening} onStart={startViewing} />
        ) : editing || !status.latest_response ? (
          <ResponseForm token={token} status={status} onDone={(s) => { setStatus(s); setEditing(false) }} />
        ) : (
          <AlreadyAnswered status={status} onEdit={() => setEditing(true)} />
        )}
      </div>
    </div>
  )
}

function WelcomeCard({ status, busy, onStart }) {
  return (
    <div className="card">
      <h2>{status.customer_name}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {status.mail_purpose} — visit on {fmtDate(status.visit_date)} with {status.owner_name}
      </p>
      <p>
        This link stays open once you view it. After that, it remains active for {status.link_validity_hours} hours,
        and you can edit your response during that time.
      </p>
      <button className="btn primary" onClick={onStart} disabled={busy} type="button" style={{ width: '100%' }}>
        {busy ? 'Opening…' : 'View my selections & respond'}
      </button>
    </div>
  )
}

function ExpiredCard({ token, status }) {
  const [sent, setSent] = useState(status.requested_new_pending)
  const [err, setErr] = useState('')

  async function requestNew() {
    try {
      await api.post(`/portal/${token}/request-new-link`, undefined, { auth: false })
      setSent(true)
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <div className="card">
      <h2>This link has expired</h2>
      <p>Links stay open for {status.link_validity_hours} hours after you first open them.</p>
      {err ? <div className="err-box">{err}</div> : null}
      {sent ? (
        <p className="hint">A request for a new link has been sent to your representative — they'll send you a fresh one shortly.</p>
      ) : (
        <button className="btn primary" onClick={requestNew} type="button">
          Request a new link
        </button>
      )}
    </div>
  )
}

function AlreadyAnswered({ status, onEdit }) {
  return (
    <div className="card">
      <h2>Thanks — we have your reply</h2>
      <p className="hint">
        Submitted by {status.latest_response.by_name}
        {status.latest_response.by_designation ? `, ${status.latest_response.by_designation}` : ''} on{' '}
        {fmtDate(status.latest_response.submitted_at)}
      </p>
      <button className="btn" onClick={onEdit} type="button">
        Edit your reply
      </button>
    </div>
  )
}

function ResponseForm({ token, status, onDone }) {
  const n = status.mail_number
  const prev = status.latest_response?.data || {}
  const [byName, setByName] = useState(status.latest_response?.by_name || status.contact?.name || '')
  const [byDesignation, setByDesignation] = useState(status.latest_response?.by_designation || status.contact?.designation || '')
  const [byEmail, setByEmail] = useState(status.contact?.email || '')
  const [testStatus, setTestStatus] = useState(prev.testStatus || '')
  const [proto, setProto] = useState(prev.proto || '')
  const [orderPlaced, setOrderPlaced] = useState(prev.orderPlaced || '')
  const [orderFabrics, setOrderFabrics] = useState(prev.orderFabrics || [])
  const [execStatus, setExecStatus] = useState(prev.execStatus || '')
  const [storeDate, setStoreDate] = useState(prev.storeDate || '')
  const [whereToBuy, setWhereToBuy] = useState(prev.whereToBuy || '')
  const [interested, setInterested] = useState(prev.interested || '')
  const [preferredDate, setPreferredDate] = useState(prev.preferredDate || '')
  const [itemQuality, setItemQuality] = useState(prev.itemQuality || {})
  const [notProceeding, setNotProceeding] = useState(!!prev.notProceeding)
  const [feedback, setFeedback] = useState(prev.feedback || '')
  const [items, setItems] = useState(() =>
    Object.fromEntries(
      (status.items || []).map((it) => [
        it.visit_item_id,
        { sentiment: it.sentiment || '', text: it.feedback_text || '', attachment_url: it.attachment_url || '' },
      ])
    )
  )
  // Items that already have logged feedback start collapsed (read-only) — the customer has to
  // deliberately choose to change an answer rather than silently overwrite it by just retyping.
  const [editingItem, setEditingItem] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function updateItem(id, field, value) {
    setItems((s) => ({ ...s, [id]: { ...s[id], [field]: value } }))
  }
  function toggleOrderFabric(id) {
    setOrderFabrics((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const data = {}
    if (testStatus) data.testStatus = testStatus
    if (proto) data.proto = proto
    if (orderPlaced) data.orderPlaced = orderPlaced
    if (orderPlaced === 'yes' && orderFabrics.length) data.orderFabrics = orderFabrics
    if (execStatus) data.execStatus = execStatus
    if (storeDate) data.storeDate = storeDate
    if (whereToBuy.trim()) data.whereToBuy = whereToBuy.trim()
    if (interested) data.interested = interested
    if (interested === 'no' && preferredDate) data.preferredDate = preferredDate
    if (n === 3 && Object.keys(itemQuality).length) data.itemQuality = itemQuality
    if (n <= 4 && notProceeding) data.notProceeding = true
    if (feedback.trim()) data.feedback = feedback.trim()

    const item_feedback = Object.entries(items)
      // Only submit items the customer actually edited this round — an item left collapsed
      // (already_has_feedback and not opened for editing) is left untouched server-side.
      .filter(([id, v]) => {
        const it = (status.items || []).find((x) => x.visit_item_id === id)
        if (it?.already_has_feedback && !editingItem[id]) return false
        return v.sentiment || (v.text && v.text.trim()) || (v.attachment_url && v.attachment_url.trim())
      })
      .map(([id, v]) => ({
        visit_item_id: id,
        sentiment: v.sentiment || null,
        text: v.text || null,
        attachment_url: v.attachment_url?.trim() || null,
      }))

    setBusy(true)
    try {
      const result = await api.post(`/portal/${token}/respond`, { by_name: byName, by_designation: byDesignation, by_email: byEmail || null, data, item_feedback }, { auth: false })
      onDone(result)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{status.customer_name}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {status.mail_purpose} — visit on {fmtDate(status.visit_date)} with {status.owner_name}
      </p>

      {err ? <div className="err-box">{err}</div> : null}

      {status.items?.length ? (
        <>
          <h3 style={{ marginTop: 16 }}>Your feedback on each item</h3>
          {status.items.map((it) => {
            const already = it.already_has_feedback && !editingItem[it.visit_item_id]
            return (
              <div key={it.visit_item_id} className="fabric-rate">
                <div>
                  <b>{it.fabric_code}</b> — {it.fabric_name} ({it.qty} {it.swatch_type})
                </div>
                {already ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <p className="hint" style={{ margin: '4px 0' }}>
                      ✓ Already logged: {it.sentiment === 'Positive' ? '👍 Good' : it.sentiment === 'Negative' ? '👎 Issue' : it.sentiment === 'Neutral' ? '😐 Okay' : '—'}
                      {it.feedback_text ? ` — "${it.feedback_text}"` : ''}
                      {it.attachment_url ? (
                        <>
                          {' '}
                          ·{' '}
                          <a href={displaySrc(it.attachment_url)} target="_blank" rel="noreferrer">
                            attachment
                          </a>
                        </>
                      ) : null}
                    </p>
                    <button className="btn sm" type="button" onClick={() => setEditingItem((s) => ({ ...s, [it.visit_item_id]: true }))}>
                      Change my answer
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="row">
                      <select style={{ width: 'auto' }} value={items[it.visit_item_id]?.sentiment || ''} onChange={(e) => updateItem(it.visit_item_id, 'sentiment', e.target.value)}>
                        <option value="">— rate —</option>
                        <option value="Positive">👍 Good</option>
                        <option value="Neutral">😐 Okay</option>
                        <option value="Negative">👎 Issue</option>
                      </select>
                      {n === 3 ? (
                        <select
                          style={{ width: 'auto' }}
                          value={itemQuality[it.visit_item_id] || ''}
                          onChange={(e) => setItemQuality((s) => ({ ...s, [it.visit_item_id]: e.target.value }))}
                        >
                          <option value="">— fabric quality —</option>
                          <option value="excellent">Excellent</option>
                          <option value="good">Good</option>
                          <option value="average">Average</option>
                          <option value="poor">Poor</option>
                        </select>
                      ) : null}
                    </div>
                    <input
                      placeholder="Any note on this item…"
                      value={items[it.visit_item_id]?.text || ''}
                      onChange={(e) => updateItem(it.visit_item_id, 'text', e.target.value)}
                      style={{ gridColumn: '1 / -1' }}
                    />
                    <div style={{ gridColumn: '1 / -1' }}>
                      <ImageUpload
                        value={items[it.visit_item_id]?.attachment_url || ''}
                        onChange={(url) => updateItem(it.visit_item_id, 'attachment_url', url)}
                        uploadUrl={`/portal/${token}/upload`}
                        auth={false}
                        label="Attach a photo"
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </>
      ) : null}

      {n === 2 ? (
        <div className="field">
          <label>Testing status</label>
          <div className="opt">
            {[['not_started', 'Not started'], ['in_progress', 'In progress'], ['approved', 'Approved'], ['issues', 'Issues found']].map(([k, l]) => (
              <label key={k}>
                <input type="radio" name="testStatus" checked={testStatus === k} onChange={() => setTestStatus(k)} /> {l}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {n === 3 ? (
        <div className="field">
          <label>Prototype sample made?</label>
          <div className="opt">
            {[['yes', 'Yes'], ['in_progress', 'In progress'], ['no', 'Not yet']].map(([k, l]) => (
              <label key={k}>
                <input type="radio" name="proto" checked={proto === k} onChange={() => setProto(k)} /> {l}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {n === 4 ? (
        <div className="field">
          <label>Did you place an order?</label>
          <div className="opt">
            {[['yes', 'Order placed'], ['planning', 'Planning to order'], ['no', 'No order']].map(([k, l]) => (
              <label key={k}>
                <input type="radio" name="orderPlaced" checked={orderPlaced === k} onChange={() => setOrderPlaced(k)} /> {l}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {n === 4 && orderPlaced === 'yes' && status.items?.length ? (
        <div className="field">
          <label>Which fabrics did you order?</label>
          <div className="opt">
            {status.items.map((it) => (
              <label key={it.visit_item_id}>
                <input type="checkbox" checked={orderFabrics.includes(it.visit_item_id)} onChange={() => toggleOrderFabric(it.visit_item_id)} />{' '}
                {it.fabric_code} — {it.fabric_name}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {n === 5 && status.variant === 'ordered' ? (
        <>
          <div className="field">
            <label>Where is your order right now?</label>
            <div className="opt">
              {[['in_production', 'In production'], ['dispatched', 'Dispatched'], ['in_store', 'In stores now']].map(([k, l]) => (
                <label key={k}>
                  <input type="radio" name="execStatus" checked={execStatus === k} onChange={() => setExecStatus(k)} /> {l}
                </label>
              ))}
            </div>
          </div>
          <div className="grid g2">
            <div className="field">
              <label>Date it went / will go in-store</label>
              <DatePicker value={storeDate} onChange={(e) => setStoreDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Where can it be bought?</label>
              <input placeholder="Store / city / online" value={whereToBuy} onChange={(e) => setWhereToBuy(e.target.value)} />
            </div>
          </div>
        </>
      ) : null}
      {n === 5 && status.variant !== 'ordered' ? (
        <div className="field">
          <label>Would you like to see the new collection?</label>
          <div className="opt">
            {[['yes', 'Yes'], ['no', 'Not interested now']].map(([k, l]) => (
              <label key={k}>
                <input type="radio" name="interested" checked={interested === k} onChange={() => setInterested(k)} /> {l}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {n === 5 && status.variant !== 'ordered' && interested === 'no' ? (
        <div className="field">
          <label>Preferred date for a new presentation</label>
          <DatePicker value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />
        </div>
      ) : null}

      {n <= 4 ? (
        <label className="check">
          <input type="checkbox" checked={notProceeding} onChange={(e) => setNotProceeding(e.target.checked)} /> We are not going ahead with this
        </label>
      ) : null}

      <div className="field">
        <label>Anything else you'd like to add?</label>
        <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </div>

      <div className="grid g2">
        <div className="field">
          <label>Your name *</label>
          <input value={byName} onChange={(e) => setByName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Your designation *</label>
          <input value={byDesignation} onChange={(e) => setByDesignation(e.target.value)} required />
        </div>
      </div>
      <div className="field">
        <label>Your email</label>
        <input type="email" value={byEmail} onChange={(e) => setByEmail(e.target.value)} />
      </div>

      <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  )
}
