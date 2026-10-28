import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { fmtDateTime } from './ui'

const NAV_HOME = ['/dashboard', 'Home', '⌂']
const NAV = [
  {
    id: 'masters',
    label: 'Masters',
    items: [
      ['/customers', 'Customers', '◎'],
      ['/fabrics', 'Items', '▦'],
      ['/categories', 'Categories', '≡'],
      ['/users', 'Users & roles', '☺', 'admin'],
    ],
  },
  {
    id: 'ops',
    label: 'Operations',
    items: [
      ['/entry', 'Customer Visit Entry', '＋'],
      ['/visits', 'Follow-ups', '✉'],
      ['/register', 'Swatch Register', '▥'],
    ],
  },
  { id: 'gov', label: 'Governance', items: [['/blacklist', 'Blacklist', '⚑', 'mgr'], ['/outbox', 'Sent Emails', '☰']] },
  { id: 'insights', label: 'Insights', role: 'mgr', items: [['/reports', 'Reports', '▤'], ['/activity', 'Activity log', '✎']] },
  { id: 'admin', label: 'Admin', role: 'admin', items: [['/settings', 'Settings', '⚙']] },
]

function isMgr(role) {
  return role === 'manager' || role === 'admin' || role === 'top'
}
function isAdmin(role) {
  return role === 'admin' || role === 'top'
}

function NotificationBell() {
  const navigate = useNavigate()
  const [notifs, setNotifs] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  function load() {
    api.get('/notifications').then(setNotifs).catch(() => {})
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const unread = notifs.filter((n) => !n.read).length

  async function openNotif(n) {
    if (!n.read) {
      api.post(`/notifications/${n.id}/read`).catch(() => {})
      setNotifs((ns) => ns.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all')
      setNotifs((ns) => ns.map((n) => ({ ...n, read: true })))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="bell-wrap" ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn sm ghost"
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        style={{ position: 'relative' }}
      >
        🔔
        {unread ? <span className="badge hot">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="bell-panel card" style={{ position: 'absolute', right: 0, top: '110%', width: 340, zIndex: 50, maxHeight: 420, overflowY: 'auto' }}>
          <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border, #eee)' }}>
            <b>Notifications</b>
            <span className="spacer" />
            {unread ? (
              <button className="btn sm ghost" type="button" onClick={markAllRead}>
                Mark all read
              </button>
            ) : null}
          </div>
          {notifs.length ? (
            notifs.map((n) => (
              <div
                key={n.id}
                className="click"
                onClick={() => openNotif(n)}
                style={{ padding: '8px 12px', borderBottom: '1px solid var(--border, #f2f2f2)', opacity: n.read ? 0.6 : 1, cursor: 'pointer' }}
              >
                <div>{n.text}</div>
                <div className="hint" style={{ fontSize: 11 }}>{fmtDateTime(n.created_at)}</div>
              </div>
            ))
          ) : (
            <div className="hint" style={{ padding: 12 }}>
              No notifications yet.
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default function Shell({ children }) {
  const { user, roleLabel, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState({ masters: true, ops: true, gov: true, insights: true, admin: true })
  const [search, setSearch] = useState('')
  const [homeBadge, setHomeBadge] = useState(0)
  const [blBadge, setBlBadge] = useState(0)

  useEffect(() => {
    api.get('/notifications').then((ns) => setHomeBadge(ns.filter((n) => !n.read).length)).catch(() => {})
    if (isMgr(user?.role)) {
      api.get('/blacklist/pending').then((p) => setBlBadge((p.blacklist_events?.length || 0) + (p.exceptions?.length || 0))).catch(() => {})
    }
  }, [user?.role])

  function toggle(id) {
    setOpen((o) => ({ ...o, [id]: !o[id] }))
  }

  function onSearchKey(e) {
    if (e.key === 'Enter' && search.trim()) {
      navigate('/customers?q=' + encodeURIComponent(search.trim()))
    }
  }

  const groups = NAV.filter((g) => !g.role || (g.role === 'mgr' ? isMgr(user?.role) : isAdmin(user?.role)))

  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">
          <b>Customer Follow-Up</b>
          <span>{roleLabel}</span>
        </div>
        <nav className="nav">
          <NavLink to={NAV_HOME[0]} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="ic">{NAV_HOME[2]}</span>
            {NAV_HOME[1]}
            {homeBadge ? <span className="count">{homeBadge > 9 ? '9+' : homeBadge}</span> : null}
          </NavLink>
          {groups.map((g) => (
            <div key={g.id} className={'nav-group' + (open[g.id] ? ' open' : '')}>
              <button className="gh" type="button" onClick={() => toggle(g.id)}>
                {g.label}
                <span className="car">▸</span>
              </button>
              <div className="gi">
                {g.items
                  .filter((it) => !it[3] || (it[3] === 'admin' ? isAdmin(user?.role) : it[3] === 'mgr' ? isMgr(user?.role) : true))
                  .map((it) => (
                    <NavLink key={it[0]} to={it[0]} className={({ isActive }) => (isActive ? 'active' : '')}>
                      <span className="ic">{it[2]}</span>
                      {it[1]}
                      {it[0] === '/blacklist' && blBadge ? <span className="count hot">{blBadge > 9 ? '9+' : blBadge}</span> : null}
                    </NavLink>
                  ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="main">
        <div className="top">
          <input
            className="gsearch"
            placeholder="Search customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <div className="grow"></div>
          <NotificationBell />
          <label className="who">
            {user?.name} · {roleLabel}
            <button className="btn sm ghost" type="button" onClick={logout}>
              Sign out
            </button>
          </label>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  )
}
