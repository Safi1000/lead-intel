import { ShieldCheck } from 'lucide-react'

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-primary)] font-bold">Li</div>
          <span className="text-lg font-bold">LeadIntel</span>
        </div>
        <div>
          <h2 className="text-[28px] font-bold leading-tight">
            Verified owner-level B2B leads for local-service trades.
          </h2>
          <p className="mt-4 max-w-md text-slate-300">
            Discover, enrich, and deliver leads with per-field confidence scoring and full source
            provenance. Launch a run, watch it enrich live, and export in minutes.
          </p>
          <div className="mt-8 flex items-center gap-2 text-sm text-slate-400">
            <ShieldCheck className="h-4 w-4" /> SOC2-aligned · multi-tenant · audit-logged
          </div>
        </div>
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="TechxServe" className="h-7 w-auto brightness-0 invert opacity-70" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-slate-400">techxserve.com</span>
            <span className="text-[12px] text-slate-500">info@techxserve.com</span>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary)] text-sm font-bold text-white">Li</div>
            <span className="font-bold">LeadIntel</span>
          </div>
          <h1 className="text-[24px] font-bold text-[var(--color-text)]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Lightweight password strength (avoids a zxcvbn dependency). 0–4. */
export function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score]
  return { score, label }
}
