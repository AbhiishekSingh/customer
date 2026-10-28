import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ErrBox } from '../components/ui'

const ROLES = [
  { key: 'design', label: 'Design Team', ic: '✎' },
  { key: 'manager', label: 'Manager', ic: '◉' },
  { key: 'admin', label: 'Admin', ic: '⚙' },
  { key: 'top', label: 'Top Management', ic: '★' },
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
        <h1 className="center-title">Customer Follow-Up</h1>
        <p className="center-sub">Aditya Birla Group · Follow-Up Digitization</p>

        {!role ? (
          <div className="tiles">
            {ROLES.map((r) => (
              <div key={r.key} className="tile" onClick={() => setRole(r.key)}>
                <div className="ic">{r.ic}</div>
                <b>{r.label}</b>
              </div>
            ))}
          </div>
        ) : (
          <form className="card" style={{ marginTop: 20 }} onSubmit={submit}>
            <p className="hint" style={{ marginTop: 0 }}>
              Signing in as <b>{ROLES.find((r) => r.key === role).label}</b> ·{' '}
              <button type="button" className="link-btn" onClick={() => setRole(null)}>
                change
              </button>
            </p>
            <ErrBox message={err} />
            <div className="field">
              <label>Email</label>
              <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="hint" style={{ textAlign: 'center', marginTop: 12 }}>
              <Link to="/forgot-password">Forgot password?</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
