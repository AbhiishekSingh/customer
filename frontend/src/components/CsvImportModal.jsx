import { useState } from 'react'
import { Modal, Field, ErrBox } from './ui'

// Minimal CSV parser: handles quoted fields with embedded commas/newlines/escaped quotes ("").
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

// Generic CSV-import modal: paste or upload CSV text, map it against `fields` (each
// {key, label, required}), preview the parsed rows, then hand the mapped row objects to
// `onImport(rows)` — the caller does the actual API call and reports back a result summary.
export default function CsvImportModal({ title, fields, sampleHeader, onClose, onImport }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [rowErrors, setRowErrors] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const parsed = text.trim() ? parseCsv(text.trim()) : []
  const header = parsed[0] || []
  const dataRows = parsed.slice(1)
  const headerLower = header.map((h) => h.trim().toLowerCase())

  const mappedRows = dataRows.map((r) =>
    Object.fromEntries(
      fields.map((f) => {
        const idx = headerLower.indexOf(f.key.toLowerCase())
        const v = idx >= 0 ? (r[idx] || '').trim() : ''
        return [f.key, v]
      })
    )
  )

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result || ''))
    reader.readAsText(file)
  }

  async function doImport() {
    setErr('')
    if (!mappedRows.length) {
      setErr('Paste or upload some CSV rows first.')
      return
    }
    const missing = fields.filter((f) => f.required).filter((f) => !headerLower.includes(f.key.toLowerCase()))
    if (missing.length) {
      setErr(`Missing required column(s): ${missing.map((f) => f.label).join(', ')}`)
      return
    }
    setRowErrors([])
    setBusy(true)
    try {
      const res = await onImport(mappedRows)
      setResult(res)
    } catch (e) {
      // The backend's bulk importers validate every row up front and reject the whole file with
      // one row per problem (err.fields.rows) rather than a single generic message — surface
      // those so a failed import says exactly which rows to fix, not just "something went wrong".
      setErr(e.message)
      setRowErrors(Array.isArray(e.fields?.rows) ? e.fields.rows : [])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      wide
      onClose={onClose}
      footer={
        result ? (
          <button className="btn primary" onClick={onClose} type="button">
            Done
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !mappedRows.length} onClick={doImport} type="button">
              {busy ? 'Importing…' : `Import ${mappedRows.length || ''} row${mappedRows.length === 1 ? '' : 's'}`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="alert ok">
          Imported — <b>{result.created}</b> created, <b>{result.updated}</b> updated.
        </div>
      ) : (
        <>
          <ErrBox message={err} />
          {rowErrors.length ? (
            <ul className="hint" style={{ margin: '0 0 12px', paddingLeft: 18 }}>
              {rowErrors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          ) : null}
          <Field label="Required columns" hint={fields.map((f) => f.label + (f.required ? '' : ' (optional)')).join(', ')}>
            <input disabled value={sampleHeader || fields.map((f) => f.key).join(',')} />
          </Field>
          <Field label="Upload a .csv file" hint="Or paste CSV text below instead">
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
          </Field>
          <Field label="Or paste CSV here">
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={sampleHeader || fields.map((f) => f.key).join(',')} />
          </Field>
          {dataRows.length ? (
            <Field label={`Preview — ${dataRows.length} row(s)`}>
              <div style={{ overflowX: 'auto' }}>
                <table className="ie-table">
                  <tr>
                    {fields.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                  {mappedRows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      {fields.map((f) => (
                        <td key={f.key}>{r[f.key]}</td>
                      ))}
                    </tr>
                  ))}
                </table>
              </div>
              {mappedRows.length > 20 ? <small className="hint">…and {mappedRows.length - 20} more</small> : null}
            </Field>
          ) : null}
        </>
      )}
    </Modal>
  )
}
