import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { PageHead, ErrBox, Field, Loading, onlyDigits, cleanPhone } from '../components/ui'
import Icon from '../components/Icon'

const BLANK_CONTACT = () => ({ team_name: '', name: '', designation: '', email: '', phone: '', primary: false, senior: false })

export default function NewCustomer() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const { data: categories } = useApi(() => api.get('/categories/customer'), [])
  const { data: countries } = useApi(() => api.get('/categories/countries/all'), [])
  const { data: directory } = useApi(() => api.get('/directory/users'), [])

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [country, setCountry] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [pincode, setPincode] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [companyEmail, setCompanyEmail] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')
  const [ownerId, setOwnerId] = useState(user?.id || '')
  const [contacts, setContacts] = useState([BLANK_CONTACT()])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const statesForCountry = countries?.find((c) => c.name === country)?.states?.filter((s) => s.status === 'active') || []

  function updateContact(i, field, value) {
    setContacts((cs) =>
      cs.map((c, idx) => {
        if (idx === i) return { ...c, [field]: value }
        if (field === 'primary' && value) return { ...c, primary: false }
        return c
      })
    )
  }
  function addContact() {
    setContacts((cs) => [...cs, BLANK_CONTACT()])
  }
  function removeContact(i) {
    setContacts((cs) => cs.filter((_, idx) => idx !== i))
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const named = contacts.filter((c) => c.name.trim())
    if (!named.length) {
      setErr('Add at least one contact')
      return
    }
    if (!named.some((c) => c.email && c.email.trim())) {
      setErr('Add at least one contact with an email — the follow-up emails have nowhere to go otherwise.')
      return
    }
    if (named.filter((c) => c.primary).length > 1) {
      setErr('Only one contact can be marked primary')
      return
    }
    setBusy(true)
    try {
      const payload = {
        name,
        category: category || null,
        city: city || null,
        state: state || null,
        country: country || null,
        address_line1: addressLine1 || null,
        address_line2: addressLine2 || null,
        pincode: pincode || null,
        company_address: companyAddress || null,
        company_email: companyEmail || null,
        company_phone: companyPhone || null,
        owner_id: ownerId,
        contacts: named.map((c) => ({ ...c, email: c.email || null, phone: c.phone || null, designation: c.designation || null })),
      }
      const created = await api.post('/customers', payload)
      toast('Customer created')
      navigate(`/customers/${created.id}`)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  if (!categories || !countries || !directory) return <Loading />

  return (
    <div>
      <PageHead title="New customer" sub="A customer needs at least one contact with an email." />
      <form className="card" onSubmit={submit} style={{ maxWidth: 760 }}>
        <ErrBox message={err} />
        <div className="grid g2">
          <Field label="Company name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">— none —</option>
              {categories.filter((c) => c.status === 'active').map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Company email">
            <input type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} />
          </Field>
          <Field label="Company phone">
            <input inputMode="tel" value={companyPhone} onChange={(e) => setCompanyPhone(cleanPhone(e.target.value))} />
          </Field>
        </div>

        <h3 style={{ margin: '16px 0 8px' }}>Address</h3>
        <div className="grid g2">
          <Field label="Address line 1">
            <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
          </Field>
          <Field label="Address line 2">
            <input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
          </Field>
          <Field label="City">
            <input value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Country">
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value)
                setState('')
              }}
            >
              <option value="">— none —</option>
              {countries.filter((c) => c.status === 'active').map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {statesForCountry.length ? (
            <Field label="State">
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">— none —</option>
                {statesForCountry.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Pincode">
            <input inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(onlyDigits(e.target.value, 6))} />
          </Field>
        </div>
        <Field label="Company address (free text)" hint="Only if the structured fields above aren't enough">
          <textarea value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
        </Field>

        <h3 style={{ margin: '16px 0 8px' }}>Contacts</h3>
        <Field label="Assigned to">
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required>
            <option value="">— select —</option>
            {directory.filter((u) => u.role === 'design' && u.is_active).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        {contacts.map((c, i) => (
          <div key={i} className="person">
            <div className="ph">
              <input style={{ flex: '1 1 160px' }} placeholder="Team (e.g. Design)" value={c.team_name} onChange={(e) => updateContact(i, 'team_name', e.target.value)} />
              <input style={{ flex: '1 1 160px' }} placeholder="Name" value={c.name} onChange={(e) => updateContact(i, 'name', e.target.value)} />
              <input style={{ flex: '1 1 160px' }} placeholder="Designation" value={c.designation} onChange={(e) => updateContact(i, 'designation', e.target.value)} />
              <input style={{ flex: '1 1 200px' }} placeholder="Email" type="email" value={c.email} onChange={(e) => updateContact(i, 'email', e.target.value)} />
              <input style={{ flex: '1 1 140px' }} placeholder="Phone" inputMode="tel" value={c.phone} onChange={(e) => updateContact(i, 'phone', cleanPhone(e.target.value))} />
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={c.primary} onChange={(e) => updateContact(i, 'primary', e.target.checked)} /> Primary
              </label>
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={c.senior} onChange={(e) => updateContact(i, 'senior', e.target.checked)} /> Senior
              </label>
              {contacts.length > 1 ? (
                <button type="button" className="btn ghost sm icon-btn" onClick={() => removeContact(i)} title="Remove contact">
                  <Icon name="x" size={13} />
                </button>
              ) : null}
            </div>
          </div>
        ))}
        <button type="button" className="btn sm" onClick={addContact}>
          ＋ Add contact
        </button>

        <div className="row end" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => navigate('/customers')}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create customer'}
          </button>
        </div>
      </form>
    </div>
  )
}
