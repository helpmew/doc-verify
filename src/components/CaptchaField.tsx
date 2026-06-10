import { useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'

interface CaptchaFieldProps {
  onVerify: (token: string | null) => void
  onExpire?: () => void
}

/** Token both the dev middleware and the API route accept as pre-verified. */
const AUTO_VERIFY_TOKEN = 'demo-captcha-verified'

type Phase = 'idle' | 'checking' | 'verified'

export function CaptchaField({ onVerify }: CaptchaFieldProps) {
  const [phase, setPhase] = useState<Phase>('idle')

  useEffect(() => {
    const toChecking = setTimeout(() => setPhase('checking'), 700)
    const toVerified = setTimeout(() => {
      setPhase('verified')
      onVerify(AUTO_VERIFY_TOKEN)
    }, 5700)

    return () => {
      clearTimeout(toChecking)
      clearTimeout(toVerified)
    }
  }, [onVerify])

  return (
    <div className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center">
          {phase === 'idle' && (
            <span className="h-6 w-6 rounded-[5px] border-2 border-slate-300" />
          )}
          {phase === 'checking' && (
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          )}
          {phase === 'verified' && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500">
              <Check className="h-4 w-4 text-white" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="text-sm font-medium text-slate-700">
          {phase === 'verified' ? 'Verified' : "I'm not a robot"}
        </span>
      </div>
      <div className="flex flex-col items-center text-[10px] leading-tight text-slate-400">
        <span className="text-lg" aria-hidden>
          🛡️
        </span>
        <span>Protected</span>
      </div>
    </div>
  )
}
