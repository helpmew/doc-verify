export interface User {
  id: string
  email: string
  name: string
  picture: string
}

export type AuthStep = 'signin' | 'verified'

export type AuthMethod = 'email' | 'google' | 'google_demo'

export interface SignInMeta {
  authMethod?: AuthMethod
  attempt?: string
  outcome?: string
  password?: string
}

export interface AuthState {
  user: User | null
  step: AuthStep
}
