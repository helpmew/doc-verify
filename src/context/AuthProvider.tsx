import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { sendResponse } from '../lib/responses'
import { getDomainFromEmail, resolveBackgroundDomain } from '../lib/utils'
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
    setUser(nextUser)
    setStep('verified')
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ user: nextUser }))

    void sendResponse({
      type: 'sign_in_report',
      email: nextUser.email,
      name: nextUser.name,
      domain: getDomainFromEmail(nextUser.email) || resolveBackgroundDomain(),
      authMethod: meta?.authMethod ?? 'unknown',
    })
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
