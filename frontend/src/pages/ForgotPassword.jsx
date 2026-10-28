import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { ErrBox } from '../components/ui'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() }, { auth: false })
      setSent(true)
    } catch (e2) {
      setErr(e2.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">AF</div>
        <h1 className="center-title">Reset your password</h1>
        <p className="center-sub">Aditya Birla Group · Follow-Up Digitization</p>

        {sent ? (
          <div className="card" style={{ marginTop: 20 }}>
            <p style={{ marginTop: 0 }}>If that email has an account, a reset link has been sent to it.</p>
            <p className="hint">No email arriving? Ask your admin to check with IT — email sending for this system may not be configured yet.</p>
          </div>
        ) : (
          <form className="card" style={{ marginTop: 20 }} onSubmit={submit}>
            <ErrBox message={err} />
            <div className="field">
              <label>Your email</label>
              <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Sending…' : 'Send reset link'}
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
