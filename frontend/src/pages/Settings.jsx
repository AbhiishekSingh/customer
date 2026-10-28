import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useToast } from '../context/ToastContext'
import { PageHead, Field, Loading, ErrBox } from '../components/ui'
import DatePicker from '../components/DatePicker'
import EmailTemplatesPanel from '../components/EmailTemplatesPanel'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Settings() {
  const toast = useToast()
  const { data, error, loading, reload } = useApi(() => api.get('/settings'), [])
  const [tab, setTab] = useState('schedule')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [holidayDate, setHolidayDate] = useState('')
  const [holidayName, setHolidayName] = useState('')

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />
  if (!form && data) setForm({ ...data })
  if (!form) return null

  function setIntervals(i, v) {
    const next = [...form.intervals]
    next[i] = parseInt(v, 10) || 1
    setForm({ ...form, intervals: next })
  }

  async function save(patch) {
    setBusy(true)
    try {
      const updated = await api.patch('/settings', patch ?? form)
      setForm(updated)
      toast('Settings saved — planned emails recalculated')
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  function toggleWeekendDay(d) {
    const next = form.weekend_days.includes(d) ? form.weekend_days.filter((x) => x !== d) : [...form.weekend_days, d]
    const patched = { ...form, weekend_days: next }
    setForm(patched)
    save({ weekend_days: next })
  }

  async function addHoliday() {
    if (!holidayDate || !holidayName.trim()) return
    const next = [...form.holidays, { date: holidayDate, name: holidayName.trim() }]
    setForm({ ...form, holidays: next })
    setHolidayDate('')
    setHolidayName('')
    await save({ holidays: next })
  }
  async function removeHoliday(date) {
    const next = form.holidays.filter((h) => h.date !== date)
    setForm({ ...form, holidays: next })
    await save({ holidays: next })
  }

  const tabs = [
    ['schedule', 'Email schedule'],
    ['templates', 'Email templates'],
    ['rules', 'Link & blacklist'],
    ['people', 'Recipients & reports'],
    ['holidays', 'Holidays'],
  ]

  return (
    <div>
      <PageHead
        title="Settings"
        sub="Planned emails are recalculated when you save."
        actions={
          !['holidays', 'templates'].includes(tab) ? (
            <button className="btn primary" disabled={busy} onClick={() => save()} type="button">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          ) : null
        }
      />
      <div className="tabs">
        {tabs.map(([k, l]) => (
          <a key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {l}
          </a>
        ))}
      </div>

      {tab === 'schedule' && (
        <div className="card">
          <div className="alert info">Mail 1 goes a set number of days after the visit; Mails 2–4 follow at their own interval after the previous one. A Sunday or holiday moves only that one email to the next working day.</div>
          <div className="grid g3">
            <Field label="Mail 1 — days after the visit">
              <input type="number" min="1" value={form.intervals[0]} onChange={(e) => setIntervals(0, e.target.value)} />
            </Field>
            <Field label="Mail 2 — days after Mail 1">
              <input type="number" min="1" value={form.intervals[1]} onChange={(e) => setIntervals(1, e.target.value)} />
            </Field>
            <Field label="Mail 3 — days after Mail 2">
              <input type="number" min="1" value={form.intervals[2]} onChange={(e) => setIntervals(2, e.target.value)} />
            </Field>
            <Field label="Mail 4 — days after Mail 3">
              <input type="number" min="1" value={form.intervals[3]} onChange={(e) => setIntervals(3, e.target.value)} />
            </Field>
            <Field label="Mail 5 — days after Mail 4" hint="Used only if no order has been placed yet by then.">
              <input type="number" min="1" value={form.intervals[4]} onChange={(e) => setIntervals(4, e.target.value)} />
            </Field>
          </div>
          <div className="alert info" style={{ marginTop: 12 }}>
            Once an order is placed, Mail 5 switches purpose — it becomes an order-status check-in and is rescheduled from the <b>order date</b>, not from Mail 4.
          </div>
          <div className="grid g3">
            <Field label="Mail 5 (order status) — days after an order is placed">
              <input
                type="number"
                min="1"
                value={form.mail5_after_order_days}
                onChange={(e) => setForm({ ...form, mail5_after_order_days: parseInt(e.target.value, 10) || 1 })}
              />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.auto_send} onChange={(e) => setForm({ ...form, auto_send: e.target.checked })} />
            <span>
              Send emails automatically <span className="hint">(untick to approve each email before it goes)</span>
            </span>
          </label>
        </div>
      )}

      {tab === 'templates' && <EmailTemplatesPanel />}

      {tab === 'rules' && (
        <div className="card">
          <div className="grid g2">
            <Field label="Customer link stays open for (days) after first opening" hint="A link never opened never expires.">
              <input type="number" min="1" max="365" value={form.link_validity_days} onChange={(e) => setForm({ ...form, link_validity_days: parseInt(e.target.value, 10) || 1 })} style={{ maxWidth: 140 }} />
            </Field>
            <Field label="Blacklist B — days to wait after Mail 5">
              <input type="number" min="1" max="365" value={form.b_grace_days} onChange={(e) => setForm({ ...form, b_grace_days: parseInt(e.target.value, 10) || 1 })} style={{ maxWidth: 140 }} />
            </Field>
          </div>
          <p className="hint">Blacklisting and exceptions need approval from every Top Management user. An exception allows one visit within 30 days.</p>
          <p className="hint">Seasons: SS = Jan–Jun, AW = Jul–Dec.</p>
        </div>
      )}

      {tab === 'people' && (
        <div className="card">
          <div className="grid g2">
            <Field label="Senior management email" hint="Receives Blacklist A notices">
              <input value={form.senior_mgmt_email || ''} onChange={(e) => setForm({ ...form, senior_mgmt_email: e.target.value })} />
            </Field>
            <Field label="Marketing Head email">
              <input value={form.marketing_head_email || ''} onChange={(e) => setForm({ ...form, marketing_head_email: e.target.value })} />
            </Field>
            <Field label="Marketing team email (CC)">
              <input value={form.marketing_cc || ''} onChange={(e) => setForm({ ...form, marketing_cc: e.target.value })} />
            </Field>
            <Field label="Management report frequency">
              <select value={form.report_frequency} onChange={(e) => setForm({ ...form, report_frequency: e.target.value })}>
                <option value="weekly">Every Monday</option>
                <option value="monthly">1st of each month</option>
                <option value="off">Off</option>
              </select>
            </Field>
            <Field label="Send the report to">
              <input value={form.report_recipients || ''} onChange={(e) => setForm({ ...form, report_recipients: e.target.value })} />
            </Field>
          </div>
        </div>
      )}

      {tab === 'holidays' && (
        <div className="card">
          <p className="hint" style={{ marginTop: 0 }}>
            Emails due on these days go out on the next working day.
          </p>
          <div className="row" style={{ margin: '10px 0' }}>
            <b>Weekly off:</b>
            {DOW.map((d, i) => (
              <label key={i} className="check" style={{ margin: '0 10px 0 0' }}>
                <input type="checkbox" checked={form.weekend_days.includes(i)} onChange={() => toggleWeekendDay(i)} /> {d}
              </label>
            ))}
          </div>
          <table>
            <tr>
              <th>Date</th>
              <th>Holiday</th>
              <th></th>
            </tr>
            {form.holidays
              .slice()
              .sort((a, b) => (a.date < b.date ? -1 : 1))
              .map((h) => (
                <tr key={h.date}>
                  <td>{h.date}</td>
                  <td>{h.name}</td>
                  <td className="act">
                    <button className="btn sm danger" onClick={() => removeHoliday(h.date)} type="button">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <DatePicker style={{ width: 180 }} value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
            <input placeholder="Holiday name" style={{ width: 240 }} value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
            <button className="btn" onClick={addHoliday} type="button">
              Add holiday
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
