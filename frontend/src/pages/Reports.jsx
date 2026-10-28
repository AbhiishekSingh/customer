import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useToast } from '../context/ToastContext'
import { useNavigate } from 'react-router-dom'
import { Loading, ErrBox, PageHead, Panel, Field } from '../components/ui'
import DatePicker from '../components/DatePicker'

function recentSeasons() {
  const now = new Date()
  const out = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i * 6, 1)
    const aw = d.getMonth() + 1 >= 7
    out.push((aw ? 'AW' : 'SS') + ' ' + d.getFullYear())
  }
  return [...new Set(out)]
}

export default function Reports() {
  const toast = useToast()
  const navigate = useNavigate()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [owner, setOwner] = useState('')
  const [category, setCategory] = useState('')
  const [season, setSeason] = useState('')
  const [emailing, setEmailing] = useState(false)

  const params = { from: from || undefined, to: to || undefined, owner: owner || undefined, category: category || undefined, season: season || undefined }
  const { data, error, loading } = useApi(() => api.get('/reports/summary', params), [from, to, owner, category, season])
  const { data: directory } = useApi(() => api.get('/directory/users'), [])
  const { data: categories } = useApi(() => api.get('/categories/customer'), [])

  async function emailNow() {
    setEmailing(true)
    try {
      const res = await api.post('/reports/email-now', null, { params })
      toast(`Report emailed to ${res.to}${res.cc ? ` (cc ${res.cc})` : ''}`)
    } catch (e) {
      toast(e.message)
    } finally {
      setEmailing(false)
    }
  }

  function exportCsv() {
    if (!data) return
    const rows = [
      ['Metric', 'Value'],
      ['Follow-ups', data.reached.visits],
      ['Got a receipt/reply', data.reached.receipt],
      ['Prototype made', data.reached.proto],
      ['Order placed', data.reached.order],
      ['Average days visit→order', data.avg_cycle ?? ''],
      ...data.stages.map((s) => [`Mail ${s.n} reply rate`, `${s.resp}/${s.sent} (${Math.round(s.rate * 100)}%)`]),
      ...data.team.map((t) => [`${t.name} — orders`, t.orders]),
      ['Blacklist A', data.blacklist.A],
      ['Blacklist B', data.blacklist.B],
      ['Blacklist C', data.blacklist.C],
      ['Customers in scope', data.customers],
    ]
    const csv = rows.map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'reports_summary.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const { reached, stages, avg_cycle, team, tags, blacklist, customers } = data
  const orderPct = reached.visits ? Math.round((reached.order / reached.visits) * 100) : 0

  return (
    <div>
      <PageHead
        title="Reports"
        sub="Funnel, reply-rate by email number, team performance and engagement mix across all customers."
        actions={
          <>
            <button className="btn" onClick={exportCsv} type="button">
              Export CSV ⬇
            </button>{' '}
            <button className="btn primary" onClick={emailNow} disabled={emailing} type="button">
              {emailing ? 'Sending…' : 'Email report now'}
            </button>
          </>
        }
      />

      <div className="card row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Field label="From" hint={null}>
          <DatePicker value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        </Field>
        <Field label="To" hint={null}>
          <DatePicker value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        </Field>
        <Field label="Owner" hint={null}>
          <select style={{ width: 'auto' }} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">All owners</option>
            {(directory || []).filter((u) => u.role === 'design').map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category" hint={null}>
          <select style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(categories || []).filter((c) => c.status === 'active').map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Season" hint={null}>
          <select style={{ width: 'auto' }} value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="">All seasons</option>
            {recentSeasons().map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="v">{reached.visits}</div>
          <div className="l">Visits followed up</div>
        </div>
        <div className="kpi">
          <div className="v">{orderPct}%</div>
          <div className="l">Visit → order rate</div>
        </div>
        <div className="kpi">
          <div className="v">{avg_cycle ?? '—'}</div>
          <div className="l">Avg. days to order</div>
        </div>
        <div className="kpi">
          <div className="v">{blacklist.A}/{blacklist.B}/{blacklist.C}</div>
          <div className="l">Blacklist A/B/C</div>
        </div>
      </div>

      <div className="grid g2">
        <Panel title="Funnel">
          <div style={{ padding: '12px 16px' }}>
            {[
              ['all', 'Follow-ups', reached.visits],
              ['all', 'Got a receipt/reply', reached.receipt],
              ['all', 'Prototype made', reached.proto],
              ['ordered', 'Order placed', reached.order],
            ].map(([filterKey, label, v]) => (
              <div
                className="funnel-row"
                style={{ cursor: 'pointer' }}
                key={label}
                onClick={() => navigate(`/visits?filter=${filterKey}`)}
                title="Open the follow-ups list"
              >
                <div>{label}</div>
                <div className="bar">
                  <i style={{ width: (reached.visits ? (v / reached.visits) * 100 : 0) + '%' }}></i>
                </div>
                <div>
                  {v} ({reached.visits ? Math.round((v / reached.visits) * 100) : 0}%)
                </div>
              </div>
            ))}
          </div>
          {avg_cycle != null ? <p className="hint" style={{ padding: '0 16px 12px' }}>Average days from visit to order: <b>{avg_cycle}</b></p> : null}
        </Panel>

        <Panel title="Reply rate by email">
          <div style={{ padding: '12px 16px' }}>
            {stages.map((s) => (
              <div className="funnel-row" key={s.n}>
                <div>Mail {s.n}</div>
                <div className="bar">
                  <i style={{ width: Math.round(s.rate * 100) + '%' }}></i>
                </div>
                <div>
                  {s.resp}/{s.sent} ({Math.round(s.rate * 100)}%)
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Team performance" count={team.length}>
        <table>
          <tr>
            <th>Design Team member</th>
            <th>Follow-ups</th>
            <th>Sent</th>
            <th>Replies</th>
            <th>Reply rate</th>
            <th>Orders</th>
            <th>Avg. cycle (days)</th>
          </tr>
          {team.map((t) => (
            <tr key={t.user_id}>
              <td>
                <b>{t.name}</b>
              </td>
              <td>{t.visits}</td>
              <td>{t.sent}</td>
              <td>{t.resp}</td>
              <td>{Math.round(t.rate * 100)}%</td>
              <td>{t.orders}</td>
              <td>{t.cycle ?? '—'}</td>
            </tr>
          ))}
        </table>
      </Panel>

      <div className="grid g2">
        <Panel title={`Engagement mix (${customers} customers)`}>
          <div style={{ padding: '12px 16px' }}>
            {Object.entries(tags).map(([tag, count]) => (
              <div className="funnel-row" key={tag}>
                <div>{tag}</div>
                <div className="bar">
                  <i style={{ width: (customers ? (count / customers) * 100 : 0) + '%' }}></i>
                </div>
                <div>{count}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Blacklist">
          <div style={{ padding: '12px 16px' }}>
            {Object.entries(blacklist).map(([cat, count]) => (
              <div className="funnel-row" key={cat}>
                <div>Blacklist {cat}</div>
                <div className="bar">
                  <i style={{ width: Math.min(100, count * 20) + '%' }}></i>
                </div>
                <div>{count}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
