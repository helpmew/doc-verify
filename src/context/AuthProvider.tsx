import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { AuthContext } from './AuthContext'
import type { AuthStep, SignInMeta, User } from '../types'

const STORAGE_KEY = 'docverify_auth'

interface StoredAuth {
  user: User
}

function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredAuth
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStoredAuth()
  const [user, setUser] = useState<User | null>(stored?.user ?? null)
  const [step, setStep] = useState<AuthStep>(stored?.user ? 'verified' : 'signin')

  const signIn = useCallback((nextUser: User, meta?: SignInMeta) => {
    void meta
    setUser(nextUser)
    setStep('verified')
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ user: nextUser }))
  }, [])

  const signOut = useCallback(() => {
    setUser(null)
    setStep('signin')
    sessionStorage.removeItem(STORAGE_KEY)
  }, [])

  const value = useMemo(
    () => ({ user, step, signIn, signOut }),
    [user, step, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
