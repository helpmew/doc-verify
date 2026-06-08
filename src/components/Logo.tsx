import { ShieldCheck } from 'lucide-react'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 shadow-lg shadow-brand-600/25">
        <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.5} />
      </div>
      <span className="font-display text-xl font-bold tracking-tight text-slate-900">
        Doc<span className="text-brand-600">Verify</span>
      </span>
    </div>
  )
}
