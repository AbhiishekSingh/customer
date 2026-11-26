import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useToast } from '../context/ToastContext'
import DataTable from '../components/DataTable'
import CsvImportModal from '../components/CsvImportModal'
import { PageHead, Loading, ErrBox, Modal, Field, Pill } from '../components/ui'
import { MasterSelect, MasterChecklist } from '../components/MasterPicker'

// Every column that's actually on the client's Item Master sheet (AW 27-28 Commercial), plus
// `code` (the sheet's Sort No.) as the required lookup key. Multi-value columns (gender,
// lapf_domestic, lapf_export) accept '/' or ',' as the separator in a CSV cell, same as the sheet
// itself and scripts/import_item_master_excel.py — split client-side before posting, below.
const IMPORT_FIELDS = [
  { key: 'code', label: 'Sort No. (Code)', required: true },
  { key: 'development_no', label: 'Development No.' },
  { key: 'gender', label: "Gender (Men's/Women's, or both)" },
  { key: 'season', label: 'Season' },
  { key: 'story', label: 'Story' },
  { key: 'fabric_category', label: 'Fabric Category (Woven/Knit)' },
  { key: 'fabric_type', label: 'Fabric Type' },
  { key: 'print_type', label: 'Print Type' },
  { key: 'supplier', label: 'Existing Supplier' },
  { key: 'lapf_domestic', label: 'Additional LAPF Domestic' },
  { key: 'lapf_export', label: 'LAPF Export' },
  { key: 'gsm', label: 'GSM' },
  { key: 'warp', label: 'Warp (woven)' },
  { key: 'weft', label: 'Weft (woven)' },
  { key: 'composition', label: 'Fabric Blend / F Blend' },
  { key: 'fin_const', label: 'Fin. Construction (woven)' },
  { key: 'width_cm', label: 'Width in cm' },
  { key: 'width_inch', label: 'Width in inch (woven)' },
  { key: 'price_meter', label: 'Price/meter' },
  { key: 'moq', label: 'MOQ/MCQ' },
  { key: 'remark', label: 'Remark' },
  { key: 'sort_no_sticker', label: 'Sort no. for Sticker Printing (knits)' },
  { key: 'fibre', label: 'FIBRE (knits)' },
  { key: 'yarn_details', label: 'Yarn Details (knits)' },
  { key: 'structure_gauge', label: 'Structure/Gauge (knits)' },
  { key: 'dia_inch', label: 'Dia in inch (knits)' },
]

function splitMulti(raw) {
  if (!raw) return null
  const parts = String(raw).split(/[/,]/).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : null
}

function thumb(f) {
  const hue = Math.abs([...f.code].reduce((a, c) => a + c.charCodeAt(0), 0)) % 360
  const initials = (f.development_no || f.code || '?').slice(0, 2).toUpperCase()
  return (
    <span className="swatch-thumb swatch-chip" style={{ background: `hsl(${hue},38%,88%)`, color: `hsl(${hue},45%,32%)` }}>
      {initials}
    </span>
  )
}

export default function Fabrics() {
  const [editing, setEditing] = useState(null) // fabric object, or {} for new
  const { data: fabrics, error, loading, reload } = useApi(() => api.get('/fabrics'), [])
  const [importing, setImporting] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  if (loading) return <Loading />
  if (error) return <ErrBox message={error} />

  const columns = [
    { key: 'thumb', label: '', sortable: false, get: () => '', render: thumb },
    { key: 'code', label: 'Sort No.', get: (f) => f.code, render: (f) => <b>{f.code}</b> },
    { key: 'development_no', label: 'Dev No.', get: (f) => f.development_no || '' },
    { key: 'gender', label: 'Gender', get: (f) => (f.gender || []).join(', ') },
    { key: 'season', label: 'Season', get: (f) => f.season || '' },
    { key: 'story', label: 'Story', get: (f) => f.story || '' },
    { key: 'fabric_category', label: 'Category', get: (f) => f.fabric_category || '' },
    { key: 'fabric_type', label: 'Type', get: (f) => f.fabric_type || '' },
    { key: 'print_type', label: 'Print Type', get: (f) => f.print_type || '' },
    { key: 'composition', label: 'Composition', get: (f) => f.composition || '' },
    { key: 'gsm', label: 'GSM', type: 'number', get: (f) => f.gsm || '' },
    { key: 'supplier', label: 'Supplier', get: (f) => f.supplier || '' },
    { key: 'used_count', label: 'Used', type: 'number', get: (f) => f.used_count || 0, render: (f) => f.used_count || 0 },
    { key: 'status', label: 'Status', get: (f) => f.status, render: (f) => <Pill text={f.status === 'active' ? 'Active' : 'Inactive'} cls={f.status === 'active' ? 'p-ok' : 'p-bad'} /> },
  ]

  const visibleFabrics = showInactive ? fabrics : fabrics.filter((f) => f.status === 'active')

  return (
    <div>
      <PageHead
        title="Items (fabrics)"
        sub="Item Master — matches the client's AW 27-28 Commercial sheet. Pick from this list when logging a visit — inactive items cannot be distributed."
        actions={
          <>
            <button className="btn" onClick={() => setImporting(true)} type="button">
              Import CSV
            </button>{' '}
            <button className="btn primary" onClick={() => setEditing({})} type="button">
              ＋ Add item
            </button>
          </>
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
        searchHint="Search by Sort No., Dev No., supplier…"
        emptyText="No items yet."
        rowClass={(f) => (f.status !== 'active' ? 'row-dim' : '')}
        actions={(f) => (
          <button className="btn sm" onClick={() => setEditing(f)} type="button">
            Edit
          </button>
        )}
      />
      {editing ? <FabricModal fabric={editing} onClose={() => setEditing(null)} onDone={reload} /> : null}
      {importing ? (
        <CsvImportModal
          title="Import items from CSV"
          fields={IMPORT_FIELDS}
          onClose={() => setImporting(false)}
          onImport={async (rows) => {
            const res = await api.post(
              '/fabrics/import',
              rows.map((r) => ({
                ...r,
                gsm: r.gsm ? parseFloat(r.gsm) : null,
                gender: splitMulti(r.gender),
                lapf_domestic: splitMulti(r.lapf_domestic),
                lapf_export: splitMulti(r.lapf_export),
              }))
            )
            reload()
            return res
          }}
        />
      ) : null}
    </div>
  )
}

function FabricModal({ fabric, onClose, onDone }) {
  const toast = useToast()
  const isNew = !fabric.id

  // One categories list per Item Master master type (besides the existing 'color' type used
  // elsewhere, and the legacy 'fabric' type/quality_category no longer collected here), each
  // independently reloadable so the inline "+ Add new…" on one field doesn't have to refetch
  // every other field's list. Called explicitly, not via a .map over a type-name array, so the
  // number/order of hook calls is fixed and obvious per the rules of hooks.
  const masterApi = {
    gender: useApi(() => api.get('/categories/gender'), []),
    season: useApi(() => api.get('/categories/season'), []),
    story: useApi(() => api.get('/categories/story'), []),
    supplier: useApi(() => api.get('/categories/supplier'), []),
    fabric_category: useApi(() => api.get('/categories/fabric_category'), []),
    fabric_type: useApi(() => api.get('/categories/fabric_type'), []),
    print_type: useApi(() => api.get('/categories/print_type'), []),
  }

  const [form, setForm] = useState({
    code: fabric.code || '',
    development_no: fabric.development_no || '',
    gender: fabric.gender || [],
    season: fabric.season || '',
    story: fabric.story || '',
    fabric_category: fabric.fabric_category || '',
    fabric_type: fabric.fabric_type || '',
    print_type: fabric.print_type || '',
    supplier: fabric.supplier || '',
    lapf_domestic: fabric.lapf_domestic || [],
    lapf_export: fabric.lapf_export || [],
    gsm: fabric.gsm || '',
    warp: fabric.warp || '',
    weft: fabric.weft || '',
    composition: fabric.composition || '',
    fin_const: fabric.fin_const || '',
    width_cm: fabric.width_cm || '',
    width_inch: fabric.width_inch || '',
    price_meter: fabric.price_meter || '',
    moq: fabric.moq || '',
    remark: fabric.remark || '',
    sort_no_sticker: fabric.sort_no_sticker || '',
    dia_inch: fabric.dia_inch || '',
    structure_gauge: fabric.structure_gauge || '',
    fibre: fabric.fibre || '',
    yarn_details: fabric.yarn_details || '',
    status: fabric.status || 'active',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function save() {
    setErr('')
    if (!form.code.trim()) {
      setErr('Sort No. / Code is required')
      return
    }
    setBusy(true)
    try {
      const payload = {
        ...form,
        code: form.code.trim().toUpperCase(),
        gsm: form.gsm ? parseFloat(form.gsm) : null,
      }
      // Name is no longer a field on this form (the sheet has no "name" column) — the backend
      // derives it from development_no (falling back to code) on create. On edit we simply don't
      // send `name` at all, so whatever it was set to at creation stays unchanged.
      if (isNew) {
        delete payload.status
        await api.post('/fabrics', payload)
      } else {
        delete payload.code // code is immutable after creation, same as before this rebuild
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
        <Field label="Sort No. / Code">
          <input value={form.code} disabled={!isNew} onChange={(e) => set('code', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Development No.">
          <input value={form.development_no} onChange={(e) => set('development_no', e.target.value)} />
        </Field>
        <Field label="GSM">
          <input type="number" value={form.gsm} onChange={(e) => set('gsm', e.target.value)} />
        </Field>
        {!isNew ? (
          <Field label="Status">
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        ) : null}
      </div>

      <h4 style={{ margin: '16px 0 8px' }}>Classification</h4>
      <div className="grid g2">
        <MasterChecklist
          label="Gender"
          type="gender"
          categories={masterApi.gender.data}
          values={form.gender}
          onChange={(v) => set('gender', v)}
          onCategoriesReload={masterApi.gender.reload}
          hint="An item can be tagged both Men's and Women's."
        />
        <MasterSelect
          label="Season"
          type="season"
          categories={masterApi.season.data}
          value={form.season}
          onChange={(v) => set('season', v)}
          onCategoriesReload={masterApi.season.reload}
        />
        <MasterSelect
          label="Story"
          type="story"
          categories={masterApi.story.data}
          value={form.story}
          onChange={(v) => set('story', v)}
          onCategoriesReload={masterApi.story.reload}
        />
        <MasterSelect
          label="Fabric Category"
          type="fabric_category"
          categories={masterApi.fabric_category.data}
          value={form.fabric_category}
          onChange={(v) => set('fabric_category', v)}
          onCategoriesReload={masterApi.fabric_category.reload}
          hint="Woven or Knit."
        />
        <MasterSelect
          label="Fabric Type"
          type="fabric_type"
          categories={masterApi.fabric_type.data}
          value={form.fabric_type}
          onChange={(v) => set('fabric_type', v)}
          onCategoriesReload={masterApi.fabric_type.reload}
        />
        <MasterSelect
          label="Print Type"
          type="print_type"
          categories={masterApi.print_type.data}
          value={form.print_type}
          onChange={(v) => set('print_type', v)}
          onCategoriesReload={masterApi.print_type.reload}
        />
      </div>

      <h4 style={{ margin: '16px 0 8px' }}>Supplier</h4>
      <div className="grid g2">
        <MasterSelect
          label="Existing Supplier"
          type="supplier"
          categories={masterApi.supplier.data}
          value={form.supplier}
          onChange={(v) => set('supplier', v)}
          onCategoriesReload={masterApi.supplier.reload}
        />
      </div>
      <div className="grid g2">
        <MasterChecklist
          label="Additional LAPF Domestic"
          type="supplier"
          categories={masterApi.supplier.data}
          values={form.lapf_domestic}
          onChange={(v) => set('lapf_domestic', v)}
          onCategoriesReload={masterApi.supplier.reload}
        />
        <MasterChecklist
          label="LAPF Export"
          type="supplier"
          categories={masterApi.supplier.data}
          values={form.lapf_export}
          onChange={(v) => set('lapf_export', v)}
          onCategoriesReload={masterApi.supplier.reload}
        />
      </div>

      <h4 style={{ margin: '16px 0 8px' }}>Sheet details</h4>
      <div className="grid g2">
        <Field label="Warp" hint="Woven">
          <input value={form.warp} onChange={(e) => set('warp', e.target.value)} />
        </Field>
        <Field label="Weft" hint="Woven">
          <input value={form.weft} onChange={(e) => set('weft', e.target.value)} />
        </Field>
        <Field label="Fin. Construction" hint="Woven">
          <input value={form.fin_const} onChange={(e) => set('fin_const', e.target.value)} />
        </Field>
        <Field label="Fabric Blend / Composition">
          <input value={form.composition} onChange={(e) => set('composition', e.target.value)} />
        </Field>
        <Field label="Width in cm">
          <input value={form.width_cm} onChange={(e) => set('width_cm', e.target.value)} />
        </Field>
        <Field label="Width in inch" hint="Woven">
          <input value={form.width_inch} onChange={(e) => set('width_inch', e.target.value)} />
        </Field>
        <Field label="Price/meter">
          <input value={form.price_meter} onChange={(e) => set('price_meter', e.target.value)} />
        </Field>
        <Field label="MOQ/MCQ">
          <input value={form.moq} onChange={(e) => set('moq', e.target.value)} />
        </Field>
        <Field label="FIBRE" hint="Knits">
          <input value={form.fibre} onChange={(e) => set('fibre', e.target.value)} />
        </Field>
        <Field label="Yarn Details" hint="Knits">
          <input value={form.yarn_details} onChange={(e) => set('yarn_details', e.target.value)} />
        </Field>
        <Field label="Structure/Gauge" hint="Knits">
          <input value={form.structure_gauge} onChange={(e) => set('structure_gauge', e.target.value)} />
        </Field>
        <Field label="Dia in inch" hint="Knits">
          <input value={form.dia_inch} onChange={(e) => set('dia_inch', e.target.value)} />
        </Field>
        <Field label="Sort no. for Sticker Printing" hint="Knits">
          <input value={form.sort_no_sticker} onChange={(e) => set('sort_no_sticker', e.target.value)} />
        </Field>
      </div>
      <Field label="Remark">
        <textarea value={form.remark} onChange={(e) => set('remark', e.target.value)} />
      </Field>
    </Modal>
  )
}
