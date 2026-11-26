import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Modal, Field } from './ui'
import { MasterSelect, MasterChecklist } from './MasterPicker'

/** Full Item Master detail popup for one visit line — shows every column from the client's Excel
 * sheet (see lib/itemDetails.js ITEM_DETAIL_FIELDS) for the chosen Sort No.
 *
 * Two modes:
 *  - editable (New Visit Entry, before the visit is saved): every field is an input, pre-filled
 *    from the Fabric's current Item Master data but edited here ONLY — Save calls onSave(details)
 *    which updates this one visit line's local state. It never calls PATCH /fabrics, so nothing
 *    typed here ever reaches the real Item Master record.
 *  - read-only (Items given on a saved visit): plain text display of the snapshot exactly as it
 *    was recorded at visit-entry time (VisitItem.item_details) — this is what the customer was
 *    actually told, even if the Item Master record has since changed. */
export default function ItemDetailsModal({ fabric, details, editable, onSave, onClose }) {
  const [form, setForm] = useState(() => ({ ...details }))
  const masterApi = {
    gender: useApi(() => api.get('/categories/gender'), []),
    season: useApi(() => api.get('/categories/season'), []),
    story: useApi(() => api.get('/categories/story'), []),
    supplier: useApi(() => api.get('/categories/supplier'), []),
    fabric_category: useApi(() => api.get('/categories/fabric_category'), []),
    fabric_type: useApi(() => api.get('/categories/fabric_type'), []),
    print_type: useApi(() => api.get('/categories/print_type'), []),
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function display(v) {
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
    return v || v === 0 ? v : '—'
  }

  const title = `Item details — ${fabric?.code || ''}`

  return (
    <Modal
      title={title}
      wide
      onClose={onClose}
      footer={
        editable ? (
          <>
            <button className="btn" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                onSave(form)
                onClose()
              }}
            >
              Save
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose} type="button">
            Close
          </button>
        )
      }
    >
      {!editable ? (
        <p className="hint" style={{ marginTop: 0 }}>
          As recorded when this visit was logged — may differ from the item's current Item Master record.
        </p>
      ) : null}
      <div className="grid g2">
        <Field label="Sort No.">
          <div>{fabric?.code || '—'}</div>
        </Field>
        <Field label="Development No.">
          {editable ? (
            <input value={form.development_no || ''} onChange={(e) => set('development_no', e.target.value)} />
          ) : (
            <div>{display(details.development_no)}</div>
          )}
        </Field>
        <Field label="GSM">
          {editable ? (
            <input type="number" value={form.gsm || ''} onChange={(e) => set('gsm', e.target.value)} />
          ) : (
            <div>{display(details.gsm)}</div>
          )}
        </Field>
      </div>

      <h4 style={{ margin: '16px 0 8px' }}>Classification</h4>
      {editable ? (
        <div className="grid g2">
          <MasterChecklist
            label="Gender"
            type="gender"
            categories={masterApi.gender.data}
            values={form.gender}
            onChange={(v) => set('gender', v)}
            onCategoriesReload={masterApi.gender.reload}
          />
          <MasterSelect label="Season" type="season" categories={masterApi.season.data} value={form.season} onChange={(v) => set('season', v)} onCategoriesReload={masterApi.season.reload} />
          <MasterSelect label="Story" type="story" categories={masterApi.story.data} value={form.story} onChange={(v) => set('story', v)} onCategoriesReload={masterApi.story.reload} />
          <MasterSelect
            label="Fabric Category"
            type="fabric_category"
            categories={masterApi.fabric_category.data}
            value={form.fabric_category}
            onChange={(v) => set('fabric_category', v)}
            onCategoriesReload={masterApi.fabric_category.reload}
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
      ) : (
        <div className="grid g2">
          <Field label="Gender"><div>{display(details.gender)}</div></Field>
          <Field label="Season"><div>{display(details.season)}</div></Field>
          <Field label="Story"><div>{display(details.story)}</div></Field>
          <Field label="Fabric Category"><div>{display(details.fabric_category)}</div></Field>
          <Field label="Fabric Type"><div>{display(details.fabric_type)}</div></Field>
          <Field label="Print Type"><div>{display(details.print_type)}</div></Field>
        </div>
      )}

      <h4 style={{ margin: '16px 0 8px' }}>Supplier</h4>
      {editable ? (
        <>
          <div className="grid g2">
            <MasterSelect label="Existing Supplier" type="supplier" categories={masterApi.supplier.data} value={form.supplier} onChange={(v) => set('supplier', v)} onCategoriesReload={masterApi.supplier.reload} />
          </div>
          <div className="grid g2">
            <MasterChecklist label="Additional LAPF Domestic" type="supplier" categories={masterApi.supplier.data} values={form.lapf_domestic} onChange={(v) => set('lapf_domestic', v)} onCategoriesReload={masterApi.supplier.reload} />
            <MasterChecklist label="LAPF Export" type="supplier" categories={masterApi.supplier.data} values={form.lapf_export} onChange={(v) => set('lapf_export', v)} onCategoriesReload={masterApi.supplier.reload} />
          </div>
        </>
      ) : (
        <div className="grid g2">
          <Field label="Existing Supplier"><div>{display(details.supplier)}</div></Field>
          <Field label="Additional LAPF Domestic"><div>{display(details.lapf_domestic)}</div></Field>
          <Field label="LAPF Export"><div>{display(details.lapf_export)}</div></Field>
        </div>
      )}

      <h4 style={{ margin: '16px 0 8px' }}>Sheet details</h4>
      <div className="grid g2">
        {[
          ['warp', 'Warp'], ['weft', 'Weft'], ['fin_const', 'Fin. Construction'], ['composition', 'Fabric Blend / Composition'],
          ['width_cm', 'Width in cm'], ['width_inch', 'Width in inch'], ['price_meter', 'Price/meter'], ['moq', 'MOQ/MCQ'],
          ['fibre', 'FIBRE'], ['yarn_details', 'Yarn Details'], ['structure_gauge', 'Structure/Gauge'], ['dia_inch', 'Dia in inch'],
          ['sort_no_sticker', 'Sort no. for Sticker Printing'],
        ].map(([field, label]) =>
          editable ? (
            <Field key={field} label={label}>
              <input value={form[field] || ''} onChange={(e) => set(field, e.target.value)} />
            </Field>
          ) : (
            <Field key={field} label={label}>
              <div>{display(details[field])}</div>
            </Field>
          )
        )}
      </div>
      <Field label="Remark">
        {editable ? <textarea value={form.remark || ''} onChange={(e) => set('remark', e.target.value)} /> : <div>{display(details.remark)}</div>}
      </Field>
    </Modal>
  )
}
