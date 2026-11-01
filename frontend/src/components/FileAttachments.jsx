import { useRef, useState } from 'react'
import { api } from '../api/client'
import { displaySrc } from './ImageUpload'
import Icon from './Icon'

/** Real "choose a file from my device" upload for reference material that isn't just a photo —
 *  PDF, Word, Excel, or an image — replacing a plain "paste a link" text box. Multiple files can
 *  be attached; each becomes { url, name } (url is what's saved/sent to the backend, name is
 *  only for display). Used by Customer Visit Entry's "Pre-visit attachments".
 *
 *  `value`: array of { url, name }. `onChange`: receives the updated array. */
export default function FileAttachments({ value, onChange, label = '+ Add file' }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const files = value || []

  async function handleFiles(e) {
    const picked = Array.from(e.target.files || [])
    e.target.value = '' // allow picking the same file again later
    if (!picked.length) return
    setErr('')
    setBusy(true)
    try {
      const uploaded = []
      for (const file of picked) {
        const form = new FormData()
        form.append('file', file)
        const res = await api.post('/uploads/document', form, { isForm: true })
        uploaded.push({ url: res.url, name: res.name || file.name })
      }
      onChange([...files, ...uploaded])
    } catch (ex) {
      setErr(ex.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  function remove(i) {
    onChange(files.filter((_, idx) => idx !== i))
  }

  return (
    <div className="file-attachments">
      {files.length ? (
        <ul className="file-attachments-list">
          {files.map((f, i) => (
            <li key={i}>
              <Icon name="file" size={14} />
              <a href={displaySrc(f.url)} target="_blank" rel="noreferrer" title={f.name}>
                {f.name}
              </a>
              <button type="button" className="btn ghost sm icon-btn" onClick={() => remove(i)} title="Remove">
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      <button type="button" className="btn sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : <><Icon name="paperclip" size={13} /> {label}</>}
      </button>
      <p className="hint" style={{ margin: '4px 0 0' }}>PDF, Word, Excel, or a photo</p>
      {err ? <div className="err-box">{err}</div> : null}
    </div>
  )
}
