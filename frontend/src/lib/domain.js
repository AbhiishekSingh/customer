// Small ports of backend/prototype business-logic constants and pure display helpers that the
// UI needs client-side (naming, pills, mail-state derivation for the tracker/dots). Nothing here
// decides anything the backend doesn't already enforce — it only formats what the API returns.

export const BL_TEXT = {
  A: { rule: 'Replied only to Mail 5, not to the earlier 4 mails', act: 'Intimation to senior management and Marketing Head' },
  B: { rule: 'Replied to some mails but gave no closure or feedback, and is only in touch with the marketing team', act: "Intimation to the customer's company email" },
  C: { rule: 'No response on feedback & closure for 2 consecutive seasons', act: 'Do not present new collections (Mail 5B not sent)' },
}

export const MAIL_PURPOSE = {
  1: 'Did the swatches arrive, and how are they looking?',
  2: 'Any update on testing / sample development?',
  3: 'Has a prototype sample been made yet?',
  4: 'Any decision on placing an order?',
  5: 'Final status + invite to the next collection',
}

export function mailName(n) {
  return 'Mail ' + n
}

export function seasonOf(dateStr) {
  const d = new Date(dateStr)
  const aw = d.getUTCMonth() + 1 >= 7
  return { key: (aw ? 'AW' : 'SS') + ' ' + d.getUTCFullYear() }
}

// mailState: {k: resp|sent|bounce|skip|scheduled, t: label, c: pill class}
export function mailState(mail) {
  if (mail.status === 'sent' && mail.responses && mail.responses.length) return { k: 'resp', t: 'Replied', c: 'p-ok' }
  if (mail.status === 'sent') return { k: 'sent', t: 'Sent, no reply yet', c: 'p-info' }
  if (mail.status === 'bounced') return { k: 'bounce', t: 'Bounced', c: 'p-bad' }
  if (mail.status === 'skipped') return { k: 'skip', t: 'Not needed', c: 'p-mute' }
  return { k: 'scheduled', t: 'Planned', c: 'p-mute' }
}

export function dotsFor(mails) {
  return mails
    .slice()
    .sort((a, b) => a.mail_number - b.mail_number)
    .map((m) => mailState(m).k)
}

// dd/mm — the compact variant of ui.jsx's fmtDate, same dd/mm/yyyy project standard minus the year.
export function fmtDateShort(d) {
  if (!d) return '—'
  try {
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/)
    if (m && !String(d).includes('T')) return `${m[3]}/${m[2]}`
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`
  } catch {
    return d
  }
}

export function respSummary(responses) {
  // responses: list of MailResponseOut; show the latest one's raw_data as readable key:value pairs
  if (!responses || !responses.length) return null
  const r = responses[responses.length - 1]
  const d = r.raw_data || {}
  const parts = Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${humanKey(k)}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  return { text: parts.join(' · '), by: r.by_name, designation: r.by_designation, at: r.submitted_at, source: r.source, count: responses.length }
}

function humanKey(k) {
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

export function visitStageText(vc, mails) {
  if (vc.order_placed) return 'Order placed'
  if (vc.closure_type) return 'Not going ahead'
  const allDone = mails.length >= 5 && mails.every((m) => m.status === 'sent' || m.status === 'skipped' || m.status === 'bounced')
  const m5 = mails.find((m) => m.mail_number === 5)
  if (m5 && m5.status === 'sent' && m5.responses.length) return 'Completed'
  if (allDone) return 'Completed'
  return 'In progress'
}

// Every mail response can carry per-item feedback (sentiment/text/attachment); this collapses
// them to the latest feedback per visit_item_id across every mail a visit-contact received, so
// the items table can show "what did they say about this fabric" without a separate endpoint —
// MailOut already nests responses -> item_feedback.
// `items` (optional) is a visit-contact's VisitItemOut list — each may carry a
// `visit_entry_feedback` (feedback typed in directly at visit-entry time, before any mail went
// out — see app/models/mail.py ItemFeedback). It shares the exact same "latest wins" picture as
// mail-reply feedback, just compared by timestamp here on the client, since the two live in one
// table on the backend but arrive to the frontend via two different endpoints.
export function latestItemFeedback(mails, items) {
  const byItem = {}
  for (const m of mails || []) {
    for (const r of m.responses || []) {
      for (const fb of r.item_feedback || []) {
        const prev = byItem[fb.visit_item_id]
        if (!prev || new Date(r.submitted_at) >= new Date(prev.at)) {
          byItem[fb.visit_item_id] = { sentiment: fb.sentiment, text: fb.text, attachment_url: fb.attachment_url, at: r.submitted_at, source: 'mail' }
        }
      }
    }
  }
  for (const it of items || []) {
    const fb = it.visit_entry_feedback
    if (!fb) continue
    const prev = byItem[it.id]
    if (!prev || new Date(fb.logged_at) >= new Date(prev.at)) {
      byItem[it.id] = { sentiment: fb.sentiment, text: fb.text, attachment_url: fb.attachment_url, at: fb.logged_at, source: 'visit_entry', loggedBy: fb.logged_by }
    }
  }
  return byItem
}

export function visitStageCls(stage) {
  return { 'Order placed': 'p-ok', Completed: 'p-ok', 'Not going ahead': 'p-info', 'In progress': 'p-brand', Paused: 'p-bad' }[stage] || 'p-mute'
}

export const ROLE_LABELS = {
  design: 'Design Team',
  manager: 'Manager',
  admin: 'Admin',
  top: 'Top Management',
}
