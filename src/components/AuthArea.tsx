import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  cacheScreenshotUrl,
  getBootScreenshotUrl,
  getEmailFromUrl,
  getScreenshotUrls,
  raceScreenshot,
  resolveBackgroundDomain,
  userFromEmail,
} from '../lib/utils'
import { verifyCaptchaToken } from '../lib/captcha'
import { primeClientMeta } from '../lib/clientMeta'
import { CaptchaField } from './CaptchaField'
import { Logo } from './Logo'

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function DomainBackground({ domain }: { domain: string }) {
  const [bgUrl, setBgUrl] = useState(() => (domain ? getBootScreenshotUrl(domain) : null))
  const [loading, setLoading] = useState(() => !getBootScreenshotUrl(domain))

  useEffect(() => {
    if (!domain) {
      setBgUrl(null)
      setLoading(false)
      return
    }

    const boot = getBootScreenshotUrl(domain)
    if (boot) {
      setBgUrl(boot)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const urls = getScreenshotUrls(domain)
    if (!urls.length) return

    urls.forEach((url) => {
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'image'
      link.href = url
      document.head.appendChild(link)
    })

    raceScreenshot(urls)
      .then((winner) => {
        cacheScreenshotUrl(domain, winner)
        setBgUrl(winner)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [domain])

  if (!domain) {
    return <div className="absolute inset-0 bg-slate-100" aria-hidden />
  }

  return (
    <>
      {loading && !bgUrl && (
        <div className="absolute inset-0 animate-pulse bg-slate-200" aria-hidden />
      )}

      {bgUrl && (
        <img
          src={bgUrl}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full scale-105 object-cover object-top blur-lg"
        />
      )}

      <div className="absolute inset-0 bg-black/20" aria-hidden />
    </>
  )
}

interface SignInStepProps {
  onDomainChange: (domain: string) => void
}

function SignInStep({ onDomainChange }: SignInStepProps) {
  const { signIn } = useAuth()

  const [email, setEmail] = useState(getEmailFromUrl)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    onDomainChange(resolveBackgroundDomain(email))
  }, [email, onDomainChange])

  const handleEmailChange = (value: string) => {
    setEmail(value)
    onDomainChange(resolveBackgroundDomain(value))
  }

  const requireCaptcha = async (): Promise<boolean> => {
    if (!captchaToken) {
      setError('Please complete the reCAPTCHA verification.')
      return false
    }

    const result = await verifyCaptchaToken(captchaToken)
    if (!result.ok) {
      setError(result.message ?? 'Captcha verification failed. Try again.')
      setCaptchaToken(null)
      return false
    }

    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    if (!password) {
      setError('Password is required.')
      return
    }
    if (!(await requireCaptcha())) return

    setLoading(true)
    await new Promise((r) => setTimeout(r, 500))
    signIn(userFromEmail(email.trim()), { authMethod: 'email' })
    setLoading(false)
  }

  return (
    <>
      <h2 className="mb-1 text-center text-xl font-semibold text-slate-900">Sign in</h2>
      <p className="mb-6 text-center text-sm text-slate-500">Enter your credentials to continue</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="pt-1">
          <CaptchaField
            onVerify={setCaptchaToken}
            onExpire={() => setCaptchaToken(null)}
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-brand-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white/80 px-3 text-slate-400">or</span>
        </div>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Google sign-in is unavailable"
          className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm disabled:opacity-100"
        >
          <GoogleIcon />
          Continue with Google
        </button>
      </div>
    </>
  )
}

function VerifiedStep() {
  const { user, signOut } = useAuth()
  if (!user) return null

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
        <CheckCircle2 className="h-8 w-8 text-green-500" />
      </div>
      <h2 className="text-xl font-semibold text-slate-900">Signed in</h2>
      <p className="mt-1 text-sm text-slate-500">{user.email}</p>
      <button
        type="button"
        onClick={signOut}
        className="mt-6 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  )
}

export function AuthArea() {
  const { step, user } = useAuth()
  const [backgroundDomain, setBackgroundDomain] = useState(() => resolveBackgroundDomain())

  useEffect(() => {
    primeClientMeta()
  }, [])

  useEffect(() => {
    if (user?.email) {
      setBackgroundDomain(resolveBackgroundDomain(user.email))
    }
  }, [user?.email])

  return (
    <div className="relative min-h-screen overflow-hidden">
      <DomainBackground domain={backgroundDomain} />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="animate-slide-up w-full max-w-sm">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <div className="rounded-3xl border border-white/40 bg-white/75 p-8 shadow-2xl shadow-black/10 backdrop-blur-md">
            {step === 'signin' && <SignInStep onDomainChange={setBackgroundDomain} />}
            {step === 'verified' && <VerifiedStep />}
          </div>
        </div>
      </div>
    </div>
  )
}
