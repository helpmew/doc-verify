import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext } from './AuthContext'
import type { AuthStep, SignInMeta, User } from '../types'

const STORAGE_KEY = 'docverify_auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [step, setStep] = useState<AuthStep>('signin')

  // Always start fresh on load/refresh — never resume verified redirect.
  useEffect(() => {
    sessionStorage.removeItem(STORAGE_KEY)
  }, [])

  const signIn = useCallback((nextUser: User, meta?: SignInMeta) => {
    void meta
    setUser(nextUser)
    setStep('verified')
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
