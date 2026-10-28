import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import DataTable from '../components/DataTable'
import { PageHead, Loading, ErrBox, fmtDate } from '../components/ui'
import { visitStageText, visitStageCls, dotsFor } from '../lib/domain'

const SWATCH_METERS = { Hanger: 1.5, Swatch: 0.3, Yardage: 1 }

export default function Register() {
  const navigate = useNavigate()
  const [view, setView] = useState('flat')

  const { data, error, loading } = useApi(async () => {
    const [visits, customers, fabrics] = await Promise.all([api.get('/visits'), api.get('/customers'), api.get('/fabrics')])
    const custById = Object.fromEntries(customers.map((c) => [c.id, c]))
    const fabricById = Object.fromEntries(fabrics.map((f) => [f.id, f]))
    const mailsByVisit = {}
    await Promise.all(
      visits.map(async (v) => {
        mailsByVisit[v.id] = await api.get(`/visits/${v.id}/mails`)
      })
    )
    const rows = []
    const personRows = []
    for (const v of visits) {
      const c = custById[v.customer_id]
      const vMails = mailsByVisit[v.id] || []
      for (const vc of v.visit_contacts) {
        const contact = c?.contacts.find((x) => x.id === vc.contact_id)
        const team = c?.teams.find((t) => t.id === contact?.team_id)?.name || '—'
        const vcMails = vMails.filter((m) => m.visit_contact_id === vc.id).sort((a, b) => a.mail_number - b.mail_number)
        const stage = visitStageText(vc, vcMails)
        for (const it of vc.items) {
          const f = fabricById[it.fabric_id]
          rows.push({
            v, vc, c, contact, team, it, fabric: f,
            m: (it.qty || 0) * (SWATCH_METERS[it.swatch_type] || 1),
            stage,
          })
        }
        personRows.push({
          v, vc, c, contact, team, stage,
          sortNos: [...new Set(vc.items.map((it) => fabricById[it.fabric_id]?.code).filter(Boolean))],
          totalQty: vc.items.reduce((a, it) => a + it.qty, 0),
          dots: dotsFor(vcMails),
        })
      }
    }

    // Company & team rollup: reply rate per team + last-taken date, across all their visits.
    const teamMap = new Map()
    for (const v of visits) {
      const c = custById[v.customer_id]
      const vMails = mailsByVisit[v.id] || []
      for (const vc of v.visit_contacts) {
        const contact = c?.contacts.find((x) => x.id === vc.contact_id)
        const teamName = c?.teams.find((t) => t.id === contact?.team_id)?.name || '—'
        const key = `${c?.id}::${teamName}`
        if (!teamMap.has(key)) {
          teamMap.set(key, { company: c, team: teamName, people: new Set(), items: 0, sent: 0, resp: 0, lastTaken: null })
        }
        const entry = teamMap.get(key)
        entry.people.add(vc.contact_id)
        entry.items += vc.items.reduce((a, it) => a + it.qty, 0)
        if (!entry.lastTaken || v.date > entry.lastTaken) entry.lastTaken = v.date
        const vcMails = vMails.filter((m) => m.visit_contact_id === vc.id)
        for (const m of vcMails) {
          if (m.status === 'sent' || m.status === 'bounced') entry.sent++
          if (m.responses && m.responses.length) entry.resp++
        }
      }
    }
    const teamRows = [...teamMap.values()].map((e) => ({
      ...e,
      peopleCount: e.people.size,
      replyRate: e.sent ? Math.round((e.resp / e.sent) * 100) : null,
    }))

    return { flat: rows, person: personRows, team: teamRows }
  }, [])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const flat = data.flat
  const totalHangers = flat.filter((r) => r.it.swatch_type === 'Hanger').reduce((a, r) => a + r.it.qty, 0)
  const totalSwatches = flat.filter((r) => r.it.swatch_type === 'Swatch').reduce((a, r) => a + r.it.qty, 0)
  const totalM = flat.reduce((a, r) => a + r.m, 0)
  const companies = new Set(flat.map((r) => r.c?.id)).size

  const flatColumns = [
    { key: 'date', label: 'Date', type: 'date', get: (r) => r.v.date, render: (r) => fmtDate(r.v.date) },
    { key: 'company', label: 'Company', get: (r) => r.c?.name || '' },
    { key: 'team', label: 'Team', get: (r) => r.team },
    { key: 'person', label: 'Person', get: (r) => r.contact?.name || '' },
    { key: 'code', label: 'Sort no.', get: (r) => r.fabric?.code || '', render: (r) => <b>{r.fabric?.code}</b> },
    { key: 'cat', label: 'Category', get: (r) => r.fabric?.quality_category || '' },
    { key: 'type', label: 'Type', get: (r) => r.it.swatch_type },
    { key: 'qty', label: 'Qty', type: 'number', get: (r) => r.it.qty },
    { key: 'm', label: '≈ m', type: 'number', get: (r) => Math.round(r.m * 10) / 10 },
    { key: 'status', label: 'Follow-up', get: (r) => r.stage, render: (r) => <span className={'pill ' + visitStageCls(r.stage)}>{r.stage}</span> },
  ]

  const personColumns = [
    { key: 'date', label: 'Visit', type: 'date', get: (r) => r.v.date, render: (r) => fmtDate(r.v.date) },
    { key: 'company', label: 'Company', get: (r) => r.c?.name || '' },
    { key: 'team', label: 'Team', get: (r) => r.team },
    { key: 'person', label: 'Person', get: (r) => r.contact?.name || '' },
    { key: 'sortnos', label: 'Sort no.s taken', sortable: false, get: (r) => r.sortNos.join(', ') },
    { key: 'qty', label: 'Total qty', type: 'number', get: (r) => r.totalQty },
    {
      key: 'mails', label: 'Mail 1 → 5', sortable: false, get: () => '',
      render: (r) => (
        <span className="dots">
          {r.dots.map((k, i) => (
            <i key={i} className={k === 'resp' ? 'resp' : k === 'sent' ? 'sent' : k === 'bounce' ? 'bounce' : k === 'skip' ? 'skip' : ''} />
          ))}
        </span>
      ),
    },
    { key: 'status', label: 'Status', get: (r) => r.stage, render: (r) => <span className={'pill ' + visitStageCls(r.stage)}>{r.stage}</span> },
  ]

  const teamColumns = [
    { key: 'company', label: 'Company', get: (r) => r.company?.name || '' },
    { key: 'team', label: 'Team', get: (r) => r.team },
    { key: 'people', label: 'People', type: 'number', get: (r) => r.peopleCount },
    { key: 'items', label: 'Items taken', type: 'number', get: (r) => r.items },
    { key: 'rate', label: 'Reply rate', type: 'number', get: (r) => r.replyRate ?? '', render: (r) => (r.replyRate == null ? '—' : `${r.replyRate}%`) },
    { key: 'last', label: 'Last taken', type: 'date', get: (r) => r.lastTaken || '', render: (r) => (r.lastTaken ? fmtDate(r.lastTaken) : '—') },
  ]

  const views = [
    ['flat', 'Every sort no.'],
    ['person', 'By person'],
    ['team', 'By company & team'],
  ]

  return (
    <div>
      <PageHead title="Swatch Register" sub="Which company, team and person took which sort numbers, and how much." />
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="v">{companies}</div>
          <div className="l">Companies</div>
        </div>
        <div className="kpi">
          <div className="v">{data.person.length}</div>
          <div className="l">People / follow-ups</div>
        </div>
        <div className="kpi">
          <div className="v">{totalHangers}</div>
          <div className="l">Hangers</div>
        </div>
        <div className="kpi">
          <div className="v">{totalSwatches}</div>
          <div className="l">Swatches</div>
        </div>
        <div className="kpi">
          <div className="v">{Math.round(totalM * 10) / 10} m</div>
          <div className="l">Approx. fabric given</div>
        </div>
      </div>
      <div className="tabs">
        {views.map(([k, l]) => (
          <a key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            {l}
          </a>
        ))}
      </div>
      {view === 'flat' ? (
        <DataTable
          id="register-flat"
          rows={flat}
          columns={flatColumns}
          exportName="swatch_register"
          searchHint="Search by sort no., person, company…"
          emptyText="Nothing matches."
          onRowClick={(r) => navigate(`/visit/${r.v.id}/${r.vc.id}`)}
        />
      ) : view === 'person' ? (
        <DataTable
          id="register-person"
          rows={data.person}
          columns={personColumns}
          exportName="swatch_register_by_person"
          searchHint="Search by person, company…"
          emptyText="Nothing matches."
          onRowClick={(r) => navigate(`/visit/${r.v.id}/${r.vc.id}`)}
        />
      ) : (
        <DataTable
          id="register-team"
          rows={data.team}
          columns={teamColumns}
          exportName="swatch_register_by_team"
          searchHint="Search by company, team…"
          emptyText="Nothing matches."
          onRowClick={(r) => navigate(`/customers/${r.company?.id}`)}
        />
      )}
    </div>
  )
}
