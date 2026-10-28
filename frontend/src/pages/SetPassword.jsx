import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ErrBox } from '../components/ui'

export default function SetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (password.length < 10) {
      setErr('Password must be at least 10 characters.')
      return
    }
    if (/^\d+$/.test(password)) {
      setErr('Password cannot be purely numeric.')
      return
    }
    if (password !== confirm) {
      setErr("Passwords don't match.")
      return
    }
    setBusy(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: password }, { auth: false })
      setDone(true)
    } catch (e2) {
      setErr(e2.message || 'That link is invalid or has expired.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">AF</div>
        <h1 className="center-title">Set your password</h1>
        <p className="center-sub">Aditya Birla Group · Follow-Up Digitization</p>

        {!token ? (
          <div className="card" style={{ marginTop: 20 }}>
            <div className="err-box">This link is missing its token. Ask whoever sent it for a fresh invite or reset link.</div>
          </div>
        ) : done ? (
          <div className="card" style={{ marginTop: 20 }}>
            <p>Your password has been set. You can sign in now.</p>
            <Link className="btn primary" to="/login" style={{ display: 'block', textAlign: 'center', marginTop: 10 }}>
              Go to sign in
            </Link>
          </div>
        ) : (
          <form className="card" style={{ marginTop: 20 }} onSubmit={submit}>
            <ErrBox message={err} />
            <div className="field">
              <label>New password</label>
              <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required />
              <p className="hint" style={{ margin: '4px 0 0' }}>
                At least 10 characters, not purely numeric.
              </p>
            </div>
            <div className="field">
              <label>Confirm password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </form>
        )}

        <p className="hint" style={{ textAlign: 'center', marginTop: 16 }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
