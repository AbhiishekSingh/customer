import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ErrBox } from '../components/ui'

const ROLES = [
  { key: 'design', label: 'Design', ic: '✎' },
  { key: 'manager', label: 'Manager', ic: '◉' },
  { key: 'admin', label: 'Admin', ic: '⚙' },
  { key: 'top', label: 'Top Mgmt', ic: '★' },
]

export default function Login() {
  const [role, setRole] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    if (!role) {
      setErr('Please select your role above.')
      return
    }
    setErr('')
    setBusy(true)
    try {
      await login(email.trim(), password, role)
      navigate('/dashboard')
    } catch (e2) {
      setErr(e2.message || 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">AF</div>
        <h1 className="center-title">Sign in</h1>
        <p className="center-sub">Customer Follow-Up · Aditya Birla Group</p>

        <form className="card" style={{ marginTop: 22 }} onSubmit={submit}>
          <ErrBox message={err} />

          <label className="role-label">Sign in as</label>
          <div className="role-row">
            {ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={'role-chip' + (role === r.key ? ' active' : '')}
                onClick={() => setRole(r.key)}
              >
                <span className="ic">{r.ic}</span>
                {r.label}
              </button>
            ))}
          </div>

          <div className="field">
            <label>Email</label>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="hint" style={{ textAlign: 'center', marginTop: 14 }}>
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
