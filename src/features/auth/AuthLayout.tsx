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
    <div className="grid min-h-dvh lg:grid-cols-[55%_45%]">

      {/* ── Brand panel ── */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-12 text-white lg:flex">

        {/* Ambient glow orbs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full"
               style={{ background: 'radial-gradient(circle, rgba(20,102,255,0.28), transparent 65%)' }} />
          <div className="absolute -bottom-24 right-0 h-[380px] w-[380px] rounded-full"
               style={{ background: 'radial-gradient(circle, rgba(0,194,168,0.2), transparent 65%)' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[300px] w-[300px] rounded-full"
               style={{ background: 'radial-gradient(circle, rgba(20,102,255,0.06), transparent 70%)' }} />
          {/* Dot grid */}
          <div className="absolute inset-0"
               style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        </div>

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-black text-white"
               style={{ background: 'linear-gradient(135deg, #1466ff, #0b4fd9)', boxShadow: '0 0 28px rgba(20,102,255,0.5)' }}>
            Li
          </div>
          <div>
            <p className="text-lg font-bold leading-none tracking-tight">LeadIntel</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">Signal Intelligence Platform</p>
          </div>
        </div>

        {/* Body copy */}
        <div className="relative space-y-7">
          {/* Live pulse badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    style={{ backgroundColor: '#00c2a8' }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: '#00c2a8' }} />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#00c2a8' }}>
              Live Enrichment Active
            </span>
          </div>

          <h2 className="text-[30px] font-bold leading-[1.25] tracking-tight">
            Verified owner-level B2B leads<br />
            <span style={{ color: '#1466ff' }}>for local-service trades.</span>
          </h2>

          <p className="max-w-[380px] text-[14.5px] leading-relaxed text-[var(--color-text-muted)]">
            Discover, enrich, and deliver leads with per-field confidence scoring and full source provenance. Launch a run, watch it enrich live, and export in minutes.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {['Per-field confidence', 'Live enrichment', 'Source provenance', 'CSV & JSON export'].map((f) => (
              <span key={f} className="rounded-full px-3 py-1 text-[11px] font-semibold"
                    style={{ background: 'rgba(20,102,255,0.12)', color: '#6ba3ff', border: '1px solid rgba(20,102,255,0.2)' }}>
                {f}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <ShieldCheck className="h-4 w-4 flex-shrink-0" style={{ color: '#00c2a8' }} />
            SOC2-aligned · multi-tenant · audit-logged
          </div>
        </div>

        {/* Footer */}
        <p className="relative text-[12px] text-[var(--color-text-secondary)]">Lead Intelligence Platform v1.0</p>
      </div>

      {/* ── Form panel ── */}
      <div className="flex items-center justify-center px-6 py-12" style={{ background: 'var(--color-bg)' }}>
        <div className="w-full max-w-sm">

          {/* Mobile brand */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black text-white"
                 style={{ background: 'linear-gradient(135deg, #1466ff, #0b4fd9)' }}>Li</div>
            <div>
              <p className="font-bold text-[var(--color-text)]">LeadIntel</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">Signal Intelligence</p>
            </div>
          </div>

          <h1 className="text-[26px] font-bold tracking-tight text-[var(--color-text)]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">{subtitle}</p>}
          <div className="mt-7">{children}</div>

          {/* TechxServe branding */}
          <div className="mt-10 flex flex-col items-center gap-3 border-t border-[var(--color-border)] pt-7 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
              A TechxServe Product
            </p>
            <div className="flex items-center gap-3 text-sm font-semibold">
              <a href="https://techxserve.com" target="_blank" rel="noopener noreferrer"
                 className="hover:underline" style={{ color: 'var(--color-primary)' }}>
                techxserve.com
              </a>
              <span style={{ color: 'var(--color-text-muted)' }}>·</span>
              <a href="mailto:info@techxserve.com"
                 className="hover:underline" style={{ color: 'var(--color-primary)' }}>
                info@techxserve.com
              </a>
            </div>
          </div>

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
