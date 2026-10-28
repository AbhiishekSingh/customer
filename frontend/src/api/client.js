// Thin fetch wrapper: base URL, JWT bearer header, silent-refresh-once-and-retry on 401,
// and a consistent error shape ({status, message, body}) that pages can show in an err-box.

const BASE = '/api'
export const API_BASE = BASE

function getTokens() {
  try {
    return {
      access: localStorage.getItem('abg_access'),
      refresh: localStorage.getItem('abg_refresh'),
    }
  } catch {
    return { access: null, refresh: null }
  }
}

function setTokens(access, refresh) {
  try {
    if (access) localStorage.setItem('abg_access', access)
    if (refresh) localStorage.setItem('abg_refresh', refresh)
  } catch {
    /* ignore (private window etc.) */
  }
}

function clearTokens() {
  try {
    localStorage.removeItem('abg_access')
    localStorage.removeItem('abg_refresh')
    localStorage.removeItem('abg_user')
  } catch {
    /* ignore */
  }
}

let onUnauthorized = null
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

let refreshPromise = null
async function doRefresh() {
  const { refresh } = getTokens()
  if (!refresh) throw new Error('no refresh token')
  const res = await fetch(BASE + '/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  })
  if (!res.ok) throw new Error('refresh failed')
  const data = await res.json()
  setTokens(data.access_token, data.refresh_token)
  try {
    localStorage.setItem('abg_user', JSON.stringify(data.user))
  } catch {
    /* ignore */
  }
  return data
}

async function request(method, path, { body, params, auth = true, isForm = false } = {}) {
  let url = BASE + path
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString()
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  }

  const headers = {}
  if (!isForm) headers['Content-Type'] = 'application/json'
  if (auth) {
    const { access } = getTokens()
    if (access) headers['Authorization'] = 'Bearer ' + access
  }

  let res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })

  if (res.status === 401 && auth) {
    try {
      if (!refreshPromise) refreshPromise = doRefresh().finally(() => (refreshPromise = null))
      await refreshPromise
      const { access } = getTokens()
      const headers2 = { ...headers }
      if (access) headers2['Authorization'] = 'Bearer ' + access
      res = await fetch(url, {
        method,
        headers: headers2,
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      })
    } catch {
      clearTokens()
      if (onUnauthorized) onUnauthorized()
      throw { status: 401, message: 'Your session expired — please sign in again.' }
    }
  }

  if (res.status === 401 && auth) {
    clearTokens()
    if (onUnauthorized) onUnauthorized()
  }

  if (!res.ok) {
    let payload = null
    try {
      payload = await res.json()
    } catch {
      /* no body */
    }
    // Backend's api_error() shape: {"detail": {"error": {"code", "message", "fields"?}}}
    const err = payload && payload.detail && payload.detail.error
    const message = (err && err.message) || (typeof payload?.detail === 'string' ? payload.detail : null) || `Request failed (${res.status})`
    throw {
      status: res.status,
      message,
      code: err?.code,
      fields: err?.fields,
      body: payload,
    }
  }

  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const api = {
  get: (path, params, opts) => request('GET', path, { params, ...opts }),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  del: (path, opts) => request('DELETE', path, { ...opts }),
}

export { getTokens, setTokens, clearTokens }
