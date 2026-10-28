import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { api, getTokens, setTokens, clearTokens, setUnauthorizedHandler } from '../api/client'

const AuthContext = createContext(null)

const ROLE_LABELS = {
  design: 'Design Team',
  manager: 'Manager',
  admin: 'Admin',
  top: 'Top Management',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('abg_user')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null)
    })
  }, [])

  useEffect(() => {
    const { access } = getTokens()
    if (!access) {
      setReady(true)
      return
    }
    api
      .get('/auth/me')
      .then((me) => {
        setUser(me)
        try {
          localStorage.setItem('abg_user', JSON.stringify(me))
        } catch {
          /* ignore */
        }
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [])

  const login = useCallback(async (email, password, roleSelected) => {
    const data = await api.post('/auth/login', { email, password, role_selected: roleSelected }, { auth: false })
    setTokens(data.access_token, data.refresh_token)
    try {
      localStorage.setItem('abg_user', JSON.stringify(data.user))
    } catch {
      /* ignore */
    }
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      /* ignore network errors on logout */
    }
    clearTokens()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, ready, login, logout, roleLabel: user ? ROLE_LABELS[user.role] : null }),
    [user, ready, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export { ROLE_LABELS }
