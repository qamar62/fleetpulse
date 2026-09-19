'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, tokens } from './api'
import type { CurrentUser, Meta } from './types'

interface AuthState {
  user: CurrentUser | null
  meta: Meta | null
  status: 'loading' | 'authenticated' | 'anonymous'
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [status, setStatus] = useState<AuthState['status']>('loading')

  const loadSession = useCallback(async () => {
    if (!tokens.access()) {
      setStatus('anonymous')
      return
    }
    try {
      const [me, metaData] = await Promise.all([api.me(), api.meta()])
      setUser(me)
      setMeta(metaData)
      setStatus('authenticated')
    } catch {
      tokens.clear()
      setUser(null)
      setMeta(null)
      setStatus('anonymous')
    }
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  // api.ts fires this when a refresh attempt fails; drop straight to the login screen.
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null)
      setMeta(null)
      setStatus('anonymous')
    }
    window.addEventListener('fleetpulse:unauthorized', onUnauthorized)
    return () => window.removeEventListener('fleetpulse:unauthorized', onUnauthorized)
  }, [])

  const login = useCallback(
    async (username: string, password: string) => {
      const { access, refresh } = await api.login(username, password)
      tokens.set(access, refresh)
      const [me, metaData] = await Promise.all([api.me(), api.meta()])
      setUser(me)
      setMeta(metaData)
      setStatus('authenticated')
    },
    [],
  )

  const logout = useCallback(() => {
    tokens.clear()
    setUser(null)
    setMeta(null)
    setStatus('anonymous')
  }, [])

  const value = useMemo(
    () => ({ user, meta, status, login, logout }),
    [user, meta, status, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
