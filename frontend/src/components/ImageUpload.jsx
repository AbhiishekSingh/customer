import { useRef, useState } from 'react'
import { api, API_BASE } from '../api/client'

/** Turn whatever the backend/DB has stored into something a browser can load.
 *  - our own uploads come back as "/uploads/xxx.jpg" → needs the /api proxy prefix
 *  - anything else (an old pasted link, a full http(s) URL) is shown as-is */
export function displaySrc(url) {
  if (!url) return ''
  if (url.startsWith('/uploads/')) return API_BASE + url
  return url
}

/** A real "choose a photo from my device" input — replaces the old plain-text
 *  "paste an image link" box everywhere an attachment/photo is captured.
 *  `uploadUrl`: where to POST the file ('/uploads' for staff, '/portal/{token}/upload' for the
 *  public portal). `auth`: false for the public portal (no login there). `value`/`onChange`:
 *  same contract as before — a URL string stored in attachment_url / photo_url. */
export default function ImageUpload({ value, onChange, uploadUrl = '/uploads', auth = true, label = 'Upload photo' }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return
    setErr('')
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post(uploadUrl, form, { isForm: true, auth })
      onChange(res.url)
    } catch (ex) {
      setErr(ex.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  if (value) {
    const src = displaySrc(value)
    const isImage = /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(value) || value.startsWith('/uploads/')
    return (
      <div className="img-upload">
        <div className="img-upload-preview">
          {isImage ? (
            <img src={src} alt="" />
          ) : (
            <a href={src} target="_blank" rel="noreferrer">
              View attachment
            </a>
          )}
        </div>
        <button type="button" className="btn ghost sm" onClick={() => onChange('')}>
          ✕ Remove
        </button>
      </div>
    )
  }

  return (
    <div className="img-upload">
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleFile} />
      <button type="button" className="btn sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : `📷 ${label}`}
      </button>
      {err ? <div className="err-box">{err}</div> : null}
    </div>
  )
}
