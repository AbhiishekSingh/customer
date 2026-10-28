import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { Loading, ErrBox, PageHead, Panel, Empty, Field, blPill, tagPill, fmtDate, onlyDigits, cleanPhone } from '../components/ui'
import { BL_TEXT } from '../lib/domain'
import EvidenceModal from '../components/EvidenceModal'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'
const isAdmin = (role) => role === 'admin' || role === 'top'

export default function CustomerDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(params.get('edit') === '1')
  const [showEvidence, setShowEvidence] = useState(false)

  const { data, error, loading, reload } = useApi(async () => {
    const [customer, engagement, visits, directory, swatchHistory] = await Promise.all([
      api.get(`/customers/${id}`),
      api.get(`/customers/${id}/engagement`),
      api.get('/visits'),
      api.get('/directory/users'),
      api.get(`/customers/${id}/swatch-history`),
    ])
    let events = []
    let exceptions = []
    if (isMgr(user?.role)) {
      try {
        ;[events, exceptions] = await Promise.all([
          api.get(`/customers/${id}/blacklist-events`),
          api.get(`/customers/${id}/exceptions`),
        ])
      } catch {
        /* ignore */
      }
    }
    const custVisits = visits.filter((v) => v.customer_id === id).sort((a, b) => (a.date < b.date ? 1 : -1))
    return { customer, engagement, custVisits, directory, events, exceptions, swatchHistory }
  }, [id, user?.role])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />
  if (!data) return null

  const { customer: c, engagement: e, custVisits, directory, events, exceptions, swatchHistory } = data
  const ownerName = directory.find((u) => u.id === c.owner_id)?.name || '—'
  const pendingEvent = events.find((ev) => ev.status === 'pending')
  const pendingException = exceptions.find((ex) => ex.status === 'pending')

  async function toggleMarketing(checked) {
    try {
      await api.patch(`/customers/${id}`, { marketing_only: checked })
      toast(checked ? 'Marked as marketing-only contact' : 'Marketing-only flag removed')
      reload()
    } catch (e2) {
      toast(e2.message)
    }
  }

  async function requestException() {
    const reason = window.prompt('Reason for requesting an exception (every Top Management member must approve):')
    if (!reason) return
    try {
      await api.post(`/customers/${id}/exceptions`, { reason })
      toast('Exception requested')
      reload()
    } catch (e2) {
      toast(e2.message)
    }
  }

  async function clearBlacklist() {
    const reason = window.prompt(`Reason for removing ${c.name} from Blacklist ${c.blacklist_cat}:`)
    if (!reason) return
    try {
      await api.post(`/customers/${id}/blacklist/clear`, { reason })
      toast('Removed from blacklist')
      reload()
    } catch (e2) {
      toast(e2.message)
    }
  }

  async function decideEvent(decision) {
    const note = decision ? null : window.prompt('Reason for rejecting (optional):')
    try {
      await api.post(`/blacklist-events/${pendingEvent.id}/decide`, { decision, note: note || null })
      toast(decision ? 'Approved' : 'Rejected')
      reload()
    } catch (e2) {
      toast(e2.message)
    }
  }

  async function decideException(decision) {
    const note = decision ? null : window.prompt('Reason for rejecting (optional):')
    try {
      await api.post(`/exceptions/${pendingException.id}/decide`, { decision, note: note || null })
      toast(decision ? 'Approved' : 'Rejected')
      reload()
    } catch (e2) {
      toast(e2.message)
    }
  }

  return (
    <div>
      <div className="crumb">
        <a onClick={() => navigate('/customers')}>Customers</a>
      </div>
      <PageHead
        title={<>{c.name} {c.blacklist_cat ? blPill(c.blacklist_cat) : null}</>}
        sub={`${c.category || ''} · ${c.city || ''}${c.city && c.country ? ', ' : ''}${c.country || ''} · owner ${ownerName}`}
        actions={
          user?.role !== 'top' ? (
            <button className="btn primary" onClick={() => navigate(`/entry/new?customer=${c.id}`)} type="button">
              ＋ New visit entry
            </button>
          ) : null
        }
      />

      {c.blacklist_cat ? (
        <div className="alert bad">
          <b>Blacklist {c.blacklist_cat}</b> — {BL_TEXT[c.blacklist_cat]?.act}.
          <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setShowEvidence(true)} type="button">
            Why?
          </button>
          {isAdmin(user?.role) ? (
            <button className="btn sm" style={{ marginLeft: 6 }} onClick={clearBlacklist} type="button">
              Remove from blacklist
            </button>
          ) : null}
          <br />
          No new swatches to any team of this company unless all Top Management approve an exception.
          {swatchHistory.length ? (
            <div style={{ marginTop: 6 }}>
              <b>What they took earlier:</b>{' '}
              {swatchHistory.slice(0, 6).map((h, i) => (
                <span key={i}>
                  {i > 0 ? ', ' : ''}
                  {h.fabric_code}
                  {h.ordered ? ' (ordered)' : ''} — {fmtDate(h.visit_date)}
                </span>
              ))}
              {swatchHistory.length > 6 ? <> and {swatchHistory.length - 6} more — see the Swatch history tab</> : null}
            </div>
          ) : null}
          {pendingException ? (
            <div style={{ marginTop: 6 }}>
              <b>Exception requested</b>: {pendingException.reason}
              {user?.role === 'top' ? (
                <div style={{ marginTop: 6 }}>
                  <button className="btn sm primary" onClick={() => decideException(true)} type="button">
                    Approve
                  </button>{' '}
                  <button className="btn sm danger" onClick={() => decideException(false)} type="button">
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            isMgr(user?.role) && (
              <div style={{ marginTop: 6 }}>
                <button className="btn sm" onClick={requestException} type="button">
                  Request an exception from Top Management
                </button>
              </div>
            )
          )}
        </div>
      ) : pendingEvent ? (
        <div className="alert warn">
          <b>Blacklist {pendingEvent.cat} suggested</b> — {pendingEvent.reason}. Not active until all Top Management approve.{' '}
          <button className="btn sm" onClick={() => setShowEvidence(true)} type="button">
            Why?
          </button>{' '}
          <a onClick={() => navigate('/blacklist')}>Review</a>
          {user?.role === 'top' ? (
            <div style={{ marginTop: 6 }}>
              <button className="btn sm primary" onClick={() => decideEvent(true)} type="button">
                Approve
              </button>{' '}
              <button className="btn sm danger" onClick={() => decideEvent(false)} type="button">
                Reject
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showEvidence ? <EvidenceModal customerId={id} customerName={c.name} onClose={() => setShowEvidence(false)} /> : null}

      <div className="facts">
        <div>
          <span>Engagement</span>
          {tagPill(e.tag)}
        </div>
        <div>
          <span>Reply rate</span>
          <b>{Math.round(e.rate * 100)}%</b> <small>{e.resp} of {e.sent} emails</small>
        </div>
        <div>
          <span>Orders</span>
          <b>{e.orders}</b> {e.repeat ? <small>repeat buyer</small> : null}
        </div>
        <div>
          <span>Visits</span>
          <b>{custVisits.length}</b> <small>{custVisits[0] ? `last ${fmtDate(custVisits[0].date)}` : ''}</small>
        </div>
      </div>

      <div className="tabs">
        {[
          ['overview', 'Overview'],
          ['contacts', `Contacts (${c.contacts.length})`],
          ['visits', `Visits (${custVisits.length})`],
          ['swatches', `Swatch history (${swatchHistory.length})`],
        ].map(([k, l]) => (
          <a key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {l}
          </a>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab customer={c} ownerName={ownerName} directory={directory} editing={editing} setEditing={setEditing} reload={reload} toggleMarketing={toggleMarketing} canEdit={isMgr(user?.role)} />
      )}
      {tab === 'contacts' && <ContactsTab customer={c} reload={reload} canEdit={isMgr(user?.role)} />}
      {tab === 'visits' && (
        <Panel title="Visits" count={custVisits.length}>
          {custVisits.length ? (
            <table>
              <tr>
                <th>Date</th>
                <th>Purpose</th>
                <th>People</th>
                <th></th>
              </tr>
              {custVisits.map((v) => (
                <tr className="click" key={v.id} onClick={() => navigate(`/presentation/${v.id}`)}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{fmtDate(v.date)}</b>
                  </td>
                  <td>{v.collections}</td>
                  <td>{v.visit_contacts.length} people</td>
                  <td className="act">
                    <a>Open visit</a>
                  </td>
                </tr>
              ))}
            </table>
          ) : (
            <Empty text="No visits yet." />
          )}
        </Panel>
      )}
      {tab === 'swatches' && <SwatchHistoryTab history={swatchHistory} />}
    </div>
  )
}

function SwatchHistoryTab({ history }) {
  return (
    <Panel title="Swatch history" count={history.length}>
      {history.length ? (
        <table>
          <tr>
            <th>Visit date</th>
            <th>Purpose</th>
            <th>Given to</th>
            <th>Team</th>
            <th>Fabric</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Ordered?</th>
          </tr>
          {history.map((h, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(h.visit_date)}</td>
              <td>{h.collections || '—'}</td>
              <td>{h.contact_name}</td>
              <td>{h.team_name || '—'}</td>
              <td>
                <b>{h.fabric_code}</b> {h.fabric_name}
              </td>
              <td>{h.swatch_type}</td>
              <td>{h.qty}</td>
              <td>{h.ordered ? <span className="pill p-ok">Ordered</span> : '—'}</td>
            </tr>
          ))}
        </table>
      ) : (
        <Empty text="No swatches given to this company yet." />
      )}
    </Panel>
  )
}

function OverviewTab({ customer: c, ownerName, directory, editing, setEditing, reload, toggleMarketing, canEdit }) {
  const toast = useToast()
  const [form, setForm] = useState(() => ({
    name: c.name,
    category: c.category || '',
    city: c.city || '',
    country: c.country || '',
    company_address: c.company_address || '',
    address_line1: c.address_line1 || '',
    address_line2: c.address_line2 || '',
    state: c.state || '',
    pincode: c.pincode || '',
    company_email: c.company_email || '',
    company_phone: c.company_phone || '',
    notes: c.notes || '',
    owner_id: c.owner_id || '',
  }))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await api.patch(`/customers/${c.id}`, form)
      toast('Saved')
      setEditing(false)
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="card">
        <div className="grid g3">
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Category">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="State">
            <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </Field>
          <Field label="Country">
            <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          </Field>
          <Field label="Pincode">
            <input inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => setForm({ ...form, pincode: onlyDigits(e.target.value, 6) })} />
          </Field>
          <Field label="Company email">
            <input type="email" value={form.company_email} onChange={(e) => setForm({ ...form, company_email: e.target.value })} />
          </Field>
          <Field label="Company phone">
            <input inputMode="tel" value={form.company_phone} onChange={(e) => setForm({ ...form, company_phone: cleanPhone(e.target.value) })} />
          </Field>
          <Field label="Assigned to" hint="Reassign the account owner (manager and above)">
            <select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
              {directory.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Address line 1">
          <input value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} />
        </Field>
        <Field label="Address line 2">
          <input value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} />
        </Field>
        <Field label="Company address (free text)">
          <textarea value={form.company_address} onChange={(e) => setForm({ ...form, company_address: e.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <div className="row end">
          <button className="btn" onClick={() => setEditing(false)} type="button">
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={save} type="button">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Panel
        title="Company information"
        extra={
          canEdit ? (
            <button className="btn sm" onClick={() => setEditing(true)} type="button">
              Edit
            </button>
          ) : null
        }
      >
        <div className="grid g3" style={{ padding: '14px 16px' }}>
          <Field label="Name">
            <div>{c.name}</div>
          </Field>
          <Field label="Category">
            <div>{c.category || '—'}</div>
          </Field>
          <Field label="Assigned to">
            <div>{ownerName}</div>
          </Field>
          <Field label="Company email">
            <div>{c.company_email || '—'}</div>
          </Field>
          <Field label="Company phone">
            <div>{c.company_phone || '—'}</div>
          </Field>
          <Field label="Address">
            <div>
              {[c.address_line1, c.address_line2, c.city, c.state, c.country, c.pincode].filter(Boolean).join(', ') || '—'}
            </div>
          </Field>
          <Field label="Company address (free text)">
            <div>{c.company_address || '—'}</div>
          </Field>
          <Field label="Notes">
            <div>{c.notes || '—'}</div>
          </Field>
        </div>
      </Panel>
      {canEdit ? (
        <div className="card">
          <label className="check" style={{ margin: 0 }}>
            <input type="checkbox" checked={c.marketing_only} onChange={(e) => toggleMarketing(e.target.checked)} />
            <span>
              <b>Customer is now only in touch with the marketing team</b>
              <br />
              <span className="hint">Needed for Blacklist B. Tick it when the customer stops dealing with the Design Team.</span>
            </span>
          </label>
        </div>
      ) : null}
    </>
  )
}

function ContactsTab({ customer: c, reload, canEdit }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState(() => c.contacts.map((x) => ({ ...x, team_name: c.teams.find((t) => t.id === x.team_id)?.name || '' })))
  const [busy, setBusy] = useState(false)

  function update(i, field, value) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        team_name: '', name: '', designation: '', email: '', phone: '', primary: false, senior: false, status: 'active',
        address_line1: '', address_line2: '', city: '', state: '', country: '', pincode: '',
      },
    ])
  }

  async function save() {
    setBusy(true)
    try {
      const payload = rows.map((r) => ({
        id: r.id,
        team_name: r.team_name,
        name: r.name,
        designation: r.designation || null,
        email: r.email || null,
        phone: r.phone || null,
        primary: !!r.primary,
        senior: !!r.senior,
        address_line1: r.address_line1 || null,
        address_line2: r.address_line2 || null,
        city: r.city || null,
        state: r.state || null,
        country: r.country || null,
        pincode: r.pincode || null,
      }))
      await api.put(`/customers/${c.id}/contacts`, payload)
      toast('Contacts saved')
      setEditing(false)
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(contactId) {
    if (!window.confirm('Mark this contact inactive? Their history stays intact.')) return
    try {
      await api.post(`/customers/${c.id}/contacts/${contactId}/deactivate`)
      toast('Contact deactivated')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  async function reactivate(contactId) {
    try {
      await api.post(`/customers/${c.id}/contacts/${contactId}/reactivate`)
      toast('Contact reactivated')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  if (editing) {
    return (
      <Panel title="Edit contacts">
        <div style={{ padding: 12 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="ie-table">
              <tr>
                <th>Name</th>
                <th>Team</th>
                <th>Designation</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Address line 1</th>
                <th>Address line 2</th>
                <th>City</th>
                <th>State</th>
                <th>Country</th>
                <th>Pincode</th>
                <th>Primary</th>
              </tr>
              {rows.map((r, i) => (
                <tr key={r.id || i}>
                  <td>
                    <input value={r.name} onChange={(e) => update(i, 'name', e.target.value)} />
                  </td>
                  <td>
                    <input value={r.team_name} onChange={(e) => update(i, 'team_name', e.target.value)} />
                  </td>
                  <td>
                    <input value={r.designation || ''} onChange={(e) => update(i, 'designation', e.target.value)} />
                  </td>
                  <td>
                    <input value={r.email || ''} onChange={(e) => update(i, 'email', e.target.value)} />
                  </td>
                  <td>
                    <input inputMode="tel" value={r.phone || ''} onChange={(e) => update(i, 'phone', cleanPhone(e.target.value))} />
                  </td>
                  <td>
                    <input value={r.address_line1 || ''} onChange={(e) => update(i, 'address_line1', e.target.value)} />
                  </td>
                  <td>
                    <input value={r.address_line2 || ''} onChange={(e) => update(i, 'address_line2', e.target.value)} />
                  </td>
                  <td>
                    <input value={r.city || ''} onChange={(e) => update(i, 'city', e.target.value)} />
                  </td>
                  <td>
                    <input value={r.state || ''} onChange={(e) => update(i, 'state', e.target.value)} />
                  </td>
                  <td>
                    <input value={r.country || ''} onChange={(e) => update(i, 'country', e.target.value)} />
                  </td>
                  <td>
                    <input inputMode="numeric" maxLength={6} value={r.pincode || ''} onChange={(e) => update(i, 'pincode', onlyDigits(e.target.value, 6))} />
                  </td>
                  <td>
                    <input type="checkbox" checked={!!r.primary} onChange={(e) => update(i, 'primary', e.target.checked)} />
                  </td>
                </tr>
              ))}
            </table>
          </div>
          <div className="row" style={{ padding: '10px 0' }}>
            <button className="btn sm" onClick={addRow} type="button">
              ＋ Add person
            </button>
          </div>
          <div className="row end">
            <button className="btn" onClick={() => setEditing(false)} type="button">
              Cancel
            </button>
            <button className="btn primary" disabled={busy} onClick={save} type="button">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </Panel>
    )
  }

  return (
    <Panel
      title="People (by team)"
      count={c.contacts.length}
      extra={
        canEdit ? (
          <button className="btn sm" onClick={() => setEditing(true)} type="button">
            Edit
          </button>
        ) : null
      }
    >
      {c.contacts.length ? (
        <table>
          <tr>
            <th>Name</th>
            <th>Team</th>
            <th>Designation</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Address</th>
            <th>Status</th>
            <th></th>
          </tr>
          {c.contacts.map((x) => (
            <tr key={x.id} className={x.status !== 'active' ? 'row-dim' : ''}>
              <td>
                <b>{x.name}</b>
              </td>
              <td>{c.teams.find((t) => t.id === x.team_id)?.name || '—'}</td>
              <td>{x.designation || '—'}</td>
              <td>{x.email || '—'}</td>
              <td>{x.phone || '—'}</td>
              <td>
                {[x.address_line1, x.address_line2, x.city, x.state, x.country, x.pincode].filter(Boolean).join(', ') || '—'}
              </td>
              <td>{x.status === 'active' ? <span className="pill p-ok">Active</span> : <span className="pill p-bad">Inactive</span>}</td>
              <td className="act">
                {canEdit ? (
                  x.status === 'active' ? (
                    <button className="btn sm" onClick={() => deactivate(x.id)} type="button">
                      Deactivate
                    </button>
                  ) : (
                    <button className="btn sm" onClick={() => reactivate(x.id)} type="button">
                      Reactivate
                    </button>
                  )
                ) : null}
              </td>
            </tr>
          ))}
        </table>
      ) : (
        <Empty text="No people added yet." />
      )}
    </Panel>
  )
}
