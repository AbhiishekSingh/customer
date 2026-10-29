import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useToast } from '../context/ToastContext'
import { PageHead, Panel, Pill, Modal, Field, ErrBox, Loading } from '../components/ui'

const ROLE_LABEL = { design: 'Design Team', manager: 'Manager', admin: 'Admin', top: 'Top Management' }

export default function Users() {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [inviteLink, setInviteLink] = useState(null)
  const [roleBusy, setRoleBusy] = useState(null)
  const { data: users, error, loading, reload } = useApi(() => api.get('/users'), [])
  const { data: customers } = useApi(() => api.get('/customers'), [])

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const ownedCounts = {}
  for (const c of customers || []) {
    ownedCounts[c.owner_id] = (ownedCounts[c.owner_id] || 0) + 1
  }

  async function deactivate(u) {
    if (!window.confirm(`Deactivate ${u.name}? They will no longer be able to sign in.`)) return
    try {
      await api.post(`/users/${u.id}/deactivate`)
      toast('User deactivated')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  async function changeRole(u, role) {
    if (role === u.role) return
    setRoleBusy(u.id)
    try {
      await api.patch(`/users/${u.id}`, { role })
      toast(`${u.name} is now ${ROLE_LABEL[role]}`)
      reload()
    } catch (e) {
      toast(e.message)
    } finally {
      setRoleBusy(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Users & roles"
        sub="Admin manages accounts and roles. New users get an invite link to set their own password."
        actions={
          <button className="btn primary" onClick={() => setAdding(true)} type="button">
            ＋ Add user
          </button>
        }
      />
      <Panel title="Users" count={users.length}>
        <table>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Title</th>
            <th>Customers owned</th>
            <th>Status</th>
            <th></th>
          </tr>
          {users.map((u) => (
            <tr key={u.id} className={!u.is_active ? 'row-dim' : ''}>
              <td>
                <b>{u.name}</b>
              </td>
              <td>{u.email}</td>
              <td>
                <select
                  style={{ width: 'auto' }}
                  value={u.role}
                  disabled={roleBusy === u.id || !u.is_active}
                  onChange={(e) => changeRole(u, e.target.value)}
                >
                  <option value="design">Design Team</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                  <option value="top">Top Management</option>
                </select>
              </td>
              <td>{u.title || '—'}</td>
              <td>{ownedCounts[u.id] || 0}</td>
              <td>
                <Pill text={u.is_active ? 'Active' : 'Inactive'} cls={u.is_active ? 'p-ok' : 'p-bad'} />
              </td>
              <td className="act">
                <button className="btn sm" onClick={() => setEditing(u)} type="button">
                  Edit
                </button>{' '}
                {u.is_active ? (
                  <button className="btn sm danger" onClick={() => deactivate(u)} type="button">
                    Deactivate
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </table>
      </Panel>

      <Panel title="Who can do what">
        <table>
          <tr>
            <th>Role</th>
            <th>Can</th>
          </tr>
          <tr>
            <td><b>Design Team</b></td>
            <td>Log visits and swatches for their own customers; view and follow up only on customers they own.</td>
          </tr>
          <tr>
            <td><b>Manager</b></td>
            <td>Everything Design Team can, across all customers; import customers/items via CSV; reassign account owners; request blacklist exceptions; edit items (fabrics).</td>
          </tr>
          <tr>
            <td><b>Admin</b></td>
            <td>Everything Manager can, plus manage Users &amp; Roles, Categories, Countries/States, and Settings; remove a customer from the blacklist.</td>
          </tr>
          <tr>
            <td><b>Top Management</b></td>
            <td>Approve or reject blacklist proposals and exception requests (unanimous consent required); sees the same reports/activity as Manager/Admin.</td>
          </tr>
        </table>
      </Panel>
      {adding ? (
        <UserModal
          onClose={() => setAdding(false)}
          onDone={(created) => {
            reload()
            if (created?.invite_link) setInviteLink(created)
          }}
        />
      ) : null}
      {inviteLink ? <InviteLinkModal user={inviteLink} onClose={() => setInviteLink(null)} /> : null}
      {editing ? <UserModal user={editing} onClose={() => setEditing(null)} onDone={reload} /> : null}
    </div>
  )
}

function UserModal({ user, onClose, onDone }) {
  const toast = useToast()
  const isNew = !user
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [role, setRole] = useState(user?.role || 'design')
  const [title, setTitle] = useState(user?.title || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setErr('')
    setBusy(true)
    try {
      if (isNew) {
        const created = await api.post('/users', { name, email, role, title: title || null })
        toast('User created')
        onDone(created)
      } else {
        await api.patch(`/users/${user.id}`, { name, role, title: title || null })
        toast('Saved')
        onDone()
      }
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? 'Add user' : `Edit ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={save} type="button">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <ErrBox message={err} />
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email">
        <input type="email" value={email} disabled={!isNew} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="design">Design Team</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
          <option value="top">Top Management</option>
        </select>
      </Field>
      <Field label="Title" hint="Optional">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
    </Modal>
  )
}

function InviteLinkModal({ user, onClose }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(user.invite_link)
      setCopied(true)
    } catch {
      toast('Could not copy automatically — select and copy the link manually.')
    }
  }

  return (
    <Modal title={`Invite link for ${user.name}`} onClose={onClose} footer={
      <button className="btn primary" onClick={onClose} type="button">
        Done
      </button>
    }>
      {user.invite_emailed ? (
        <p className="hint" style={{ marginTop: 0 }}>
          An invite email was sent to <b>{user.email}</b> — it lets them set their own password and stays valid for a limited time. You can also copy the link below yourself if you'd rather send it another way (chat, etc.).
        </p>
      ) : (
        <p className="hint" style={{ marginTop: 0 }}>
          The invite email couldn't be sent (email sending may not be configured, or the send failed) — copy this link and send it to {user.name} yourself (chat, email, whatever works) instead. It lets them set their own password and stays valid for a limited time.
        </p>
      )}
      <div className="field">
        <label>One-time invite link</label>
        <input readOnly value={user.invite_link} onFocus={(e) => e.target.select()} />
      </div>
      <button className="btn" onClick={copy} type="button">
        {copied ? 'Copied ✓' : 'Copy link'}
      </button>
    </Modal>
  )
}
