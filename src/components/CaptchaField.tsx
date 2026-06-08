import { useRef } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'
import { ShieldCheck } from 'lucide-react'

interface CaptchaFieldProps {
  onVerify: (token: string | null) => void
  onExpire?: () => void
}

function getSiteKey(): string {
  return (import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? '').trim()
}

function hasSiteKey(): boolean {
  const key = getSiteKey()
  return key.length > 20 && !key.startsWith('your-')
}

function DemoCaptcha({ onVerify }: CaptchaFieldProps) {
  return (
    <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
        <ShieldCheck className="h-5 w-5" />
        reCAPTCHA site key not loaded
      </div>
      <p className="mt-2 text-xs text-amber-800">
        Add <code className="rounded bg-amber-100 px-1">VITE_RECAPTCHA_SITE_KEY</code> to{' '}
        <code className="rounded bg-amber-100 px-1">docverify/.env</code>, then stop and restart{' '}
        <code className="rounded bg-amber-100 px-1">npm run dev</code> from the docverify folder.
      </p>
      <button
        type="button"
        onClick={() => onVerify('demo-captcha-verified')}
        className="mt-3 w-full rounded-lg border border-amber-300 bg-white py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
      >
        Continue with demo captcha (dev only)
      </button>
    </div>
  )
}

export function CaptchaField({ onVerify, onExpire }: CaptchaFieldProps) {
  const recaptchaRef = useRef<ReCAPTCHA>(null)
  const siteKey = getSiteKey()

  if (!hasSiteKey()) {
    return <DemoCaptcha onVerify={onVerify} onExpire={onExpire} />
  }

  return (
    <div className="flex w-full justify-center overflow-hidden rounded-xl border border-slate-200 bg-white py-2">
      <ReCAPTCHA
        ref={recaptchaRef}
        sitekey={siteKey}
        onChange={(token) => onVerify(token)}
        onExpired={() => {
          onVerify(null)
          onExpire?.()
        }}
        onErrored={() => {
          onVerify(null)
          onExpire?.()
        }}
        theme="light"
        size="normal"
      />
    </div>
  )
}

export function resetCaptcha(ref: ReCAPTCHA | null): void {
  ref?.reset()
}
