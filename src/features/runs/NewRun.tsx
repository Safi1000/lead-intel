import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, Info, X } from 'lucide-react'
import { runsApi } from '../../api/endpoints'
import { TRADES } from '../../config/constants'
import { Icon } from '../../components/layout/icon'
import { formatMoney, formatNumber, cn } from '../../lib/utils'
import { etaLabel } from '../../lib/time'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Switch, Slider } from '../../components/ui/controls'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import type { EstimateResponse, RunConfig } from '../../api/types'
import { normalizeError } from '../../api/client'

const STEPS = ['Trade', 'Location', 'Options', 'Estimate'] as const

export function NewRunPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [trade, setTrade] = useState<string | null>('roofing')
  const [city, setCity] = useState('')
  const [zipInput, setZipInput] = useState('')
  const [zips, setZips] = useState<string[]>([])
  const [ownerPhone, setOwnerPhone] = useState(true)
  const [maxLeads, setMaxLeads] = useState(165)
  const [refreshStale, setRefreshStale] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const locationValid = city.trim().length > 0 || zips.length > 0
  const zipError = zipInput && !/^\d{5}$/.test(zipInput)

  function addZip() {
    if (/^\d{5}$/.test(zipInput) && !zips.includes(zipInput)) {
      setZips([...zips, zipInput])
      setZipInput('')
    }
  }

  const config: RunConfig = {
    trade: trade ?? 'roofing',
    locations: { city: city.trim() || undefined, zips: zips.length ? zips : undefined },
    options: { include_owner_phone: ownerPhone, max_leads: maxLeads, refresh_stale: refreshStale },
  }

  const estimate = useMutation<EstimateResponse>({ mutationFn: () => runsApi.estimate(config) })

  const launch = useMutation({
    mutationFn: () => runsApi.create(config),
    onSuccess: (run) => {
      toast.success('Run launched')
      navigate(`/runs/${run.id}`)
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  function goToStep(next: number) {
    if (next === 3 && step !== 3) estimate.mutate()
    setStep(next)
  }

  const canNext = step === 0 ? !!trade : step === 1 ? locationValid : true

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New Run" subtitle="Discover and enrich owner-level leads in 4 steps." />

      {/* Stepper */}
      <ol className="mb-6 flex items-center">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold', i < step ? 'bg-[var(--color-primary)] text-white' : i === step ? 'border-2 border-[var(--color-primary)] text-[var(--color-primary)]' : 'border border-[var(--color-border)] text-[var(--color-text-muted)]')}>
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className={cn('hidden text-sm font-medium sm:inline', i <= step ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]')}>{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={cn('mx-3 h-px flex-1', i < step ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]')} />}
          </li>
        ))}
      </ol>

      <Card className="p-6">
        {/* Step 1 — Trade */}
        {step === 0 && (
          <div>
            <h2 className="text-[18px] font-semibold">Choose a trade</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Roofing is available now. More trades arrive in Phase 2.</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TRADES.map((t) => (
                <button
                  key={t.id}
                  disabled={!t.enabled}
                  onClick={() => setTrade(t.id)}
                  className={cn(
                    'relative flex flex-col items-start gap-2 rounded-[12px] border p-4 text-left transition-colors',
                    !t.enabled && 'cursor-not-allowed opacity-60',
                    trade === t.id ? 'border-[var(--color-primary)] bg-blue-50' : 'border-[var(--color-border)] hover:border-slate-300',
                  )}
                >
                  <Icon name={t.icon} className={cn('h-6 w-6', trade === t.id ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]')} />
                  <span className="text-sm font-semibold">{t.label}</span>
                  {!t.enabled && <span className="absolute right-2 top-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Phase 2</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Location */}
        {step === 1 && (
          <div>
            <h2 className="text-[18px] font-semibold">Target location</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Enter a city and/or specific zip codes. LeadIntel runs full-area grid coverage.</p>
            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" placeholder="e.g. Austin, TX" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="zip">Zip codes (optional)</Label>
                <div className="flex gap-2">
                  <Input id="zip" placeholder="5-digit zip" inputMode="numeric" value={zipInput} invalid={!!zipError} onChange={(e) => setZipInput(e.target.value.replace(/\D/g, '').slice(0, 5))} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addZip())} />
                  <Button variant="outline" onClick={addZip} disabled={!/^\d{5}$/.test(zipInput)}>Add</Button>
                </div>
                {zipError && <p className="mt-1 text-[13px] text-[var(--c-unverified)]">Zip must be 5 digits.</p>}
                {zips.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {zips.map((z) => (
                      <span key={z} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[13px] tabular-nums">
                        {z}
                        <button onClick={() => setZips(zips.filter((x) => x !== z))} aria-label={`Remove ${z}`}><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {!locationValid && <p className="text-[13px] text-[var(--color-text-muted)]">Enter a city or at least one zip to continue.</p>}
            </div>
          </div>
        )}

        {/* Step 3 — Options */}
        {step === 2 && (
          <div>
            <h2 className="text-[18px] font-semibold">Run options</h2>
            <div className="mt-4 space-y-5">
              <div className="flex items-start justify-between gap-4 rounded-[12px] border border-[var(--color-border)] p-4">
                <div>
                  <p className="text-sm font-medium">Include owner direct/cell phone</p>
                  <p className="mt-0.5 flex items-start gap-1 text-[13px] text-[var(--color-text-secondary)]">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Owner phone uses paid skip-trace lookups and increases cost.
                  </p>
                </div>
                <Switch checked={ownerPhone} onCheckedChange={setOwnerPhone} />
              </div>
              <div className="rounded-[12px] border border-[var(--color-border)] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Max leads</p>
                  <span className="text-sm font-semibold tabular-nums">{maxLeads}</span>
                </div>
                <div className="mt-3"><Slider value={maxLeads} min={25} max={400} step={5} onValueChange={setMaxLeads} /></div>
                <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Daily capacity is ~150–200 leads; larger caps span multiple days.</p>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-[12px] border border-[var(--color-border)] p-4">
                <div>
                  <p className="text-sm font-medium">Re-enrich stale records</p>
                  <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">Refresh businesses delivered &gt;90 days ago.</p>
                </div>
                <Switch checked={refreshStale} onCheckedChange={setRefreshStale} />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-[12px] border border-dashed border-[var(--color-border)] p-4 opacity-70">
                <p className="text-sm font-medium">AI lead scoring <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Phase 2</span></p>
                <Switch checked={false} onCheckedChange={() => {}} disabled />
              </div>
            </div>
          </div>
        )}

        {/* Step 4 — Estimate */}
        {step === 3 && (
          <div>
            <h2 className="text-[18px] font-semibold">Estimate &amp; launch</h2>
            {estimate.isPending ? (
              <LoadingState label="Calculating estimate…" />
            ) : estimate.isError ? (
              <ErrorState message={normalizeError(estimate.error).message} onRetry={() => estimate.mutate()} />
            ) : estimate.data ? (
              <EstimatePanel data={estimate.data} ownerPhone={ownerPhone} />
            ) : null}
          </div>
        )}

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between border-t border-[var(--color-border)] pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? navigate('/home') : setStep(step - 1))}>
            <ChevronLeft className="h-4 w-4" /> {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3 ? (
            <Button onClick={() => goToStep(step + 1)} disabled={!canNext}>
              Continue <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => setConfirmOpen(true)} disabled={!estimate.data || estimate.isPending}>
              Launch run
            </Button>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Launch this run?"
        message={`Launch Roofing in ${city || zips.join(', ')}. Estimated cost ${formatMoney(estimate.data?.total_cents)}. This is an estimate, not a guarantee.`}
        confirmLabel="Launch run"
        loading={launch.isPending}
        onConfirm={() => launch.mutate()}
      />
    </div>
  )
}

function EstimatePanel({ data, ownerPhone }: { data: EstimateResponse; ownerPhone: boolean }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-[12px] border border-[var(--color-border)]">
        {data.breakdown.map((b) => (
          <div key={b.label} className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5 text-sm last:border-0">
            <span className="text-[var(--color-text-secondary)]">{b.label}</span>
            <span className="font-medium tabular-nums">{formatMoney(b.cost_cents)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
          <span className="text-sm font-semibold">Estimated total</span>
          <span className="text-[18px] font-bold tabular-nums">{formatMoney(data.total_cents)}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Est. leads', formatNumber(data.est_leads)],
          ['Per lead', formatMoney(data.per_lead_cents)],
          ['Est. time', etaLabel(data.est_eta_seconds)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[12px] bg-slate-50 p-3 text-center">
            <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">{k}</p>
            <p className="mt-1 text-[16px] font-bold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {!ownerPhone && <p className="text-[13px] text-[var(--color-text-muted)]">Tip: enabling owner phone increases reachability but raises cost.</p>}
      <p className="rounded-[8px] bg-amber-50 p-3 text-[13px] text-amber-800">
        This is an estimate based on market density and option selection — final cost depends on actual data availability.
      </p>
    </div>
  )
}
