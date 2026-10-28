import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { ErrBox, Loading } from './ui'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

const LABELS = {
  '1-none': 'Mail 1 — Feedback after the visit',
  '2-none': 'Mail 2 — Testing update',
  '3-none': 'Mail 3 — Proto sample & fabric quality',
  '4-none': 'Mail 4 — Order status',
  '5-ordered': 'Mail 5 — Order placed (execution status)',
  '5-notordered': 'Mail 5 — Not ordered yet (new collection preview)',
}

// Sample data for the client-side "preview" — purely illustrative, the real mail always
// substitutes the actual visit/customer/contact data at send time.
const SAMPLE = {
  contact_name: 'Priya Sharma',
  customer_name: 'Aditya Birla Fashion',
  visit_date: '27/10/2026',
  items: '  • FAB001 — Cotton Twill — 2 Swatch\n  • FAB014 — Linen Blend — 1 Hanger',
  link: 'https://follow-up.example.com/r/a1b2c3…',
  link_validity_hours: '48',
}

function renderPreview(text) {
  return (text || '').replace(/\{([a-zA-Z0-9_]*)\}/g, (m, key) => (key in SAMPLE ? SAMPLE[key] : m))
}

function TemplateCard({ tpl, placeholders, canEdit, onSaved }) {
  const toast = useToast()
  const key = `${tpl.mail_number}-${tpl.variant || 'none'}`
  const [subject, setSubject] = useState(tpl.subject)
  const [body, setBody] = useState(tpl.body)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const dirty = subject !== tpl.subject || body !== tpl.body

  async function save() {
    setBusy(true)
    setErr('')
    try {
      const updated = await api.patch(`/mail-templates/${tpl.mail_number}/${tpl.variant || 'none'}`, { subject, body })
      onSaved(updated)
      toast('Template saved')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!confirm('Reset this template to its original default wording?')) return
    setBusy(true)
    setErr('')
    try {
      const updated = await api.post(`/mail-templates/${tpl.mail_number}/${tpl.variant || 'none'}/reset`)
      setSubject(updated.subject)
      setBody(updated.body)
      onSaved(updated)
      toast('Template reset to default')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div>
          <b>{LABELS[key] || key}</b>
          {tpl.updated_at ? <div className="hint">Last edited {new Date(tpl.updated_at).toLocaleString()}</div> : <div className="hint">Default wording — never edited</div>}
        </div>
        <button type="button" className="btn ghost sm">
          {open ? 'Collapse' : 'Edit'}
        </button>
      </div>

      {open ? (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="field">
            <label>Body</label>
            <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} />
          </div>

          <div className="alert info" style={{ fontSize: 12.5 }}>
            <b>Available placeholders</b> — filled in automatically from the real visit/customer when the mail is sent:
            <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
              {placeholders.map((p) => (
                <code key={p.key} title={p.label} style={{ background: 'var(--line-2)', borderRadius: 6, padding: '2px 6px' }}>
                  {`{${p.key}}`}
                </code>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>{'{link}'} is required and must appear exactly once in the body — it's the customer's response link.</div>
          </div>

          {err ? <ErrBox message={err} /> : null}

          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <button type="button" className="btn ghost sm" onClick={() => setPreview((p) => !p)}>
              {preview ? 'Hide preview' : 'Preview with sample data'}
            </button>
            {canEdit ? (
              <div className="row">
                <button type="button" className="btn ghost sm" disabled={busy} onClick={reset}>
                  Reset to default
                </button>
                <button type="button" className="btn primary sm" disabled={busy || !dirty} onClick={save}>
                  {busy ? 'Saving…' : 'Save template'}
                </button>
              </div>
            ) : (
              <span className="hint">Only managers and above can edit templates</span>
            )}
          </div>

          {preview ? (
            <div className="card" style={{ marginTop: 10, background: 'var(--line-2)' }}>
              <div>
                <b>Subject:</b> {renderPreview(subject)}
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginTop: 6 }}>{renderPreview(body)}</pre>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="hint" style={{ marginTop: 6 }}>{subject}</div>
      )}
    </div>
  )
}

export default function EmailTemplatesPanel() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: templates, error, loading, reload } = useApi(() => api.get('/mail-templates'), [])
  const { data: placeholders } = useApi(() => api.get('/mail-templates/placeholders'), [])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        The exact subject and wording of each of the 5 follow-up emails. Changes apply to every mail sent from now on — nothing already sent is affected.
      </p>
      {(templates || []).map((t) => (
        <TemplateCard key={`${t.mail_number}-${t.variant}`} tpl={t} placeholders={placeholders || []} canEdit={canEdit} onSaved={reload} />
      ))}
    </div>
  )
}
