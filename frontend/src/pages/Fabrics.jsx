import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import DataTable from '../components/DataTable'
import CsvImportModal from '../components/CsvImportModal'
import { PageHead, Loading, ErrBox, Modal, Field, Pill } from '../components/ui'
import ImageUpload, { displaySrc } from '../components/ImageUpload'

const IMPORT_FIELDS = [
  { key: 'code', label: 'Code', required: true },
  { key: 'name', label: 'Name', required: true },
  { key: 'quality_category', label: 'Category', required: true },
  { key: 'composition', label: 'Composition' },
  { key: 'gsm', label: 'GSM' },
]

function thumb(f) {
  if (f.photo_url) return <img src={displaySrc(f.photo_url)} className="swatch-thumb" alt="" />
  const hue = Math.abs([...f.code].reduce((a, c) => a + c.charCodeAt(0), 0)) % 360
  return (
    <span className="swatch-thumb swatch-chip" style={{ background: `hsl(${hue},38%,88%)`, color: `hsl(${hue},45%,32%)` }}>
      {(f.quality_category || f.code || '?').slice(0, 2).toUpperCase()}
    </span>
  )
}

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function Fabrics() {
  const { user } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState(null) // fabric object, or {} for new
  const { data: fabrics, error, loading, reload } = useApi(() => api.get('/fabrics'), [])
  const { data: categories } = useApi(() => api.get('/categories/fabric'), [])
  const [importing, setImporting] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const columns = [
    { key: 'thumb', label: '', sortable: false, get: () => '', render: thumb },
    { key: 'code', label: 'Code', get: (f) => f.code, render: (f) => <b>{f.code}</b> },
    { key: 'name', label: 'Name', get: (f) => f.name, render: (f) => (
      <>
        {f.name}
        {f.description ? <div className="hint">{f.description}</div> : null}
      </>
    ) },
    { key: 'quality_category', label: 'Category', get: (f) => f.quality_category },
    { key: 'composition', label: 'Composition', get: (f) => f.composition || '' },
    { key: 'gsm', label: 'GSM', type: 'number', get: (f) => f.gsm || '' },
    { key: 'colour_variants', label: 'Colors', get: (f) => f.colour_variants || '' },
    { key: 'supplier', label: 'Supplier', get: (f) => f.supplier || '' },
    { key: 'used_count', label: 'Used', type: 'number', get: (f) => f.used_count || 0, render: (f) => f.used_count || 0 },
    { key: 'status', label: 'Status', get: (f) => f.status, render: (f) => <Pill text={f.status === 'active' ? 'Active' : 'Inactive'} cls={f.status === 'active' ? 'p-ok' : 'p-bad'} /> },
  ]

  const visibleFabrics = showInactive ? fabrics : fabrics.filter((f) => f.status === 'active')

  return (
    <div>
      <PageHead
        title="Items (fabrics)"
        sub="Swatch master. Pick from this list when logging a visit — inactive items cannot be distributed."
        actions={
          isMgr(user?.role) ? (
            <>
              <button className="btn" onClick={() => setImporting(true)} type="button">
                Import CSV
              </button>{' '}
              <button className="btn primary" onClick={() => setEditing({})} type="button">
                ＋ Add item
              </button>
            </>
          ) : null
        }
      />
      <label className="chip" style={{ cursor: 'pointer', marginBottom: 10, display: 'inline-flex' }}>
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} style={{ marginRight: 4 }} />
        Show inactive items too ({fabrics.filter((f) => f.status !== 'active').length})
      </label>
      <DataTable
        id="fabrics"
        rows={visibleFabrics}
        columns={columns}
        exportName="items"
        searchHint="Search by code, name, category…"
        emptyText="No items yet."
        rowClass={(f) => (f.status !== 'active' ? 'row-dim' : '')}
        actions={isMgr(user?.role) ? (f) => (
          <button className="btn sm" onClick={() => setEditing(f)} type="button">
            Edit
          </button>
        ) : undefined}
      />
      {editing ? <FabricModal fabric={editing} categories={categories || []} onClose={() => setEditing(null)} onDone={reload} /> : null}
      {importing ? (
        <CsvImportModal
          title="Import items from CSV"
          fields={IMPORT_FIELDS}
          onClose={() => setImporting(false)}
          onImport={async (rows) => {
            const res = await api.post('/fabrics/import', rows.map((r) => ({ ...r, gsm: r.gsm ? parseFloat(r.gsm) : null })))
            reload()
            return res
          }}
        />
      ) : null}
    </div>
  )
}

function FabricModal({ fabric, categories, onClose, onDone }) {
  const toast = useToast()
  const isNew = !fabric.id
  const [form, setForm] = useState({
    code: fabric.code || '',
    name: fabric.name || '',
    quality_category: fabric.quality_category || (categories[0]?.name ?? ''),
    composition: fabric.composition || '',
    gsm: fabric.gsm || '',
    description: fabric.description || '',
    colour_variants: fabric.colour_variants || '',
    supplier: fabric.supplier || '',
    photo_url: fabric.photo_url || '',
    status: fabric.status || 'active',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setErr('')
    setBusy(true)
    try {
      const payload = { ...form, gsm: form.gsm ? parseFloat(form.gsm) : null }
      if (isNew) {
        delete payload.status
        await api.post('/fabrics', payload)
      } else {
        await api.patch(`/fabrics/${fabric.id}`, payload)
      }
      toast('Saved')
      onDone()
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? 'Add item' : `Edit ${fabric.code}`}
      wide
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
      <div className="grid g2">
        <Field label="Code">
          <input value={form.code} disabled={!isNew} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Category">
          <select value={form.quality_category} onChange={(e) => setForm({ ...form, quality_category: e.target.value })}>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Composition">
          <input value={form.composition} onChange={(e) => setForm({ ...form, composition: e.target.value })} />
        </Field>
        <Field label="GSM">
          <input type="number" value={form.gsm} onChange={(e) => setForm({ ...form, gsm: e.target.value })} />
        </Field>
        <Field label="Colour variants">
          <input value={form.colour_variants} onChange={(e) => setForm({ ...form, colour_variants: e.target.value })} />
        </Field>
        <Field label="Supplier">
          <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
        </Field>
        <Field label="Photo">
          <ImageUpload value={form.photo_url} onChange={(url) => setForm({ ...form, photo_url: url })} label="Upload swatch photo" />
        </Field>
        {!isNew ? (
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        ) : null}
      </div>
      <Field label="Description">
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
    </Modal>
  )
}
