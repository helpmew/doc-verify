import { createContext, useContext } from 'react'
import type { AuthState, SignInMeta, User } from '../types'

interface AuthContextValue extends AuthState {
  signIn: (user: User, meta?: SignInMeta) => void
  signOut: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
