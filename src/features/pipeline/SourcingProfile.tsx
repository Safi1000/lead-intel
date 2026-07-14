import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { locationsApi, sourcingApi, verticalsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Select, Checkbox } from '../../components/ui/controls'
import { LoadingState } from '../../components/feedback'
import { cn } from '../../lib/utils'

// Countries are chosen instead of individual cities. The actual city pool lives in the
// search_locations table ("the cities we already placed"); selecting a country drops that
// country's whole pool into the profile's metros, which the engine crosses with the niche's
// search terms and runs until the qualified target is met.
const COUNTRY_LABELS: Record<string, string> = { US: 'United States', CA: 'Canada' }
const countryName = (code: string) => COUNTRY_LABELS[code] ?? code

/** Per-tenant sourcing profile — niche + target countries + safe field toggles. Drives the engine.
 * Rendered inside the unified Sourcing workspace (config → cost → run). */
export function SourcingConfig() {
  const qc = useQueryClient()
  const { data: verticals } = useQuery({ queryKey: ['verticals'], queryFn: () => verticalsApi.list() })
  const { data: profile, isLoading } = useQuery({ queryKey: ['sourcing-profile'], queryFn: () => sourcingApi.get() })
  const { data: locations } = useQuery({ queryKey: ['sourcing-locations'], queryFn: () => locationsApi.list() })

  // The live location pool grouped by country: { CA: [...469], US: [...98] }.
  const byCountry = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const l of locations ?? []) (m[l.country] ??= []).push(l.location)
    return m
  }, [locations])
  const countryKeys = useMemo(() => Object.keys(byCountry).sort(), [byCountry])

  const [verticalKey, setVerticalKey] = useState('')
  const [countries, setCountries] = useState<string[]>([])
  const [fetchAds, setFetchAds] = useState(true)
  const [fetchEmail, setFetchEmail] = useState(true)
  const [fetchHours, setFetchHours] = useState(true)

  // The metro pool is the union of the selected countries' city pools — that's what gets saved/run.
  const metros = useMemo(() => countries.flatMap((c) => byCountry[c] ?? []), [countries, byCountry])
  const savedSnapshotRef = useRef('')
  const inferredRef = useRef(false)

  // Adopt the saved profile once BOTH it and the location pool are loaded: a country is "on" if any
  // of its cities is in the saved metros. Snapshot the DERIVED state so we never auto-save on mount.
  useEffect(() => {
    if (!profile || countryKeys.length === 0 || inferredRef.current) return
    const savedMetros = profile.metros ?? []
    const inferred = countryKeys.filter((c) => (byCountry[c] ?? []).some((m) => savedMetros.includes(m)))
    setVerticalKey(profile.vertical_key ?? '')
    setCountries(inferred)
    setFetchAds(profile.fetch_ads); setFetchEmail(profile.fetch_email); setFetchHours(profile.fetch_hours)
    const derivedMetros = inferred.flatMap((c) => byCountry[c] ?? [])
    savedSnapshotRef.current = JSON.stringify({ v: profile.vertical_key ?? '', m: derivedMetros, a: profile.fetch_ads, e: profile.fetch_email, h: profile.fetch_hours })
    inferredRef.current = true
  }, [profile, byCountry, countryKeys])

  const save = useMutation({
    mutationFn: () => sourcingApi.save({ vertical_key: verticalKey || null, search_terms: null, metros, fetch_ads: fetchAds, fetch_email: fetchEmail, fetch_hours: fetchHours, daily_limit: profile?.daily_limit ?? 1000, active: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sourcing-profile'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  // Auto-save the config (debounced) so the single "Start run" below just runs. Never fires before
  // the initial profile has been adopted, so it can't clobber a saved selection on load.
  const cfgKey = JSON.stringify({ v: verticalKey, m: metros, a: fetchAds, e: fetchEmail, h: fetchHours })
  useEffect(() => {
    if (!profile || !inferredRef.current || cfgKey === savedSnapshotRef.current) return
    const t = setTimeout(() => { save.mutate(undefined, { onSuccess: () => { savedSnapshotRef.current = cfgKey } }) }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey, profile])

  const toggleCountry = (c: string) => setCountries((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))

  if (isLoading) return <LoadingState />

  return (
    <div className="space-y-5">

      <Card className="space-y-4 p-5">
        <div>
          <Label>Niche</Label>
          <Select
            value={verticalKey}
            onValueChange={setVerticalKey}
            placeholder="Select a niche…"
            className="w-full max-w-xs"
            options={(verticals ?? []).map((v) => ({ value: v.key, label: v.label }))}
          />
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Need a niche we don't list? Ask us and we'll add it.</p>
        </div>

        <div>
          <Label>Data to fetch</Label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label htmlFor="f-ads" className="flex cursor-pointer items-center gap-2"><Checkbox id="f-ads" checked={fetchAds} onCheckedChange={setFetchAds} aria-label="Google Ads check" /> Google Ads check</label>
            <label htmlFor="f-email" className="flex cursor-pointer items-center gap-2"><Checkbox id="f-email" checked={fetchEmail} onCheckedChange={setFetchEmail} aria-label="Email enrichment" /> Email enrichment</label>
            <label htmlFor="f-hours" className="flex cursor-pointer items-center gap-2"><Checkbox id="f-hours" checked={fetchHours} onCheckedChange={setFetchHours} aria-label="Business hours" /> Business hours</label>
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Website + reviews are always fetched (they drive the score). Turning the others off lowers your cost per lead.</p>
        </div>

      </Card>

      <Card className="p-5">
        <Label className="mb-1 block">Target countries</Label>
        <p className="mb-3 text-[12px] text-[var(--color-text-muted)]">Pick where to source. LeadIntel runs across every city we cover in each country and stops once your qualified target is met.</p>
        {countryKeys.length === 0 ? (
          <p className="py-4 text-[13px] text-[var(--color-text-muted)]">Loading coverage…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {countryKeys.map((c) => {
              const sel = countries.includes(c)
              return (
                <button
                  key={c}
                  onClick={() => toggleCountry(c)}
                  className={cn(
                    'flex items-center justify-between rounded-[12px] border p-4 text-left transition-colors',
                    sel ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/40',
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold">{countryName(c)}</span>
                    <span className="text-[12px] text-[var(--color-text-muted)]">{(byCountry[c]?.length ?? 0).toLocaleString()} cities</span>
                  </span>
                  {sel && <Check className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />}
                </button>
              )
            })}
          </div>
        )}
        {countryKeys.length > 0 && countries.length === 0 && <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">Select at least one country to run.</p>}
      </Card>

      <div className="flex justify-end text-[12px] text-[var(--color-text-muted)]">
        {save.isPending ? 'Saving…' : 'Changes save automatically'}
      </div>
    </div>
  )
}

/** Settings → Sourcing: the org's daily lead limit (caps manual runs + daily auto-run). */
export function SourcingSettingsPage() {
  const qc = useQueryClient()
  const { data: profile, isLoading } = useQuery({ queryKey: ['sourcing-profile'], queryFn: () => sourcingApi.get() })
  const [limit, setLimit] = useState('')
  useEffect(() => { if (profile) setLimit(profile.daily_limit ? String(profile.daily_limit) : '') }, [profile])
  const save = useMutation({
    mutationFn: () => sourcingApi.save({
      vertical_key: profile?.vertical_key ?? null,
      search_terms: null,
      metros: profile?.metros ?? [],
      fetch_ads: profile?.fetch_ads ?? true,
      fetch_email: profile?.fetch_email ?? true,
      fetch_hours: profile?.fetch_hours ?? true,
      daily_limit: Number(limit) || 0,
      active: true,
    }),
    onSuccess: () => { toast.success('Daily lead limit saved'); qc.invalidateQueries({ queryKey: ['sourcing-profile'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  if (isLoading) return <LoadingState />
  return (
    <div className="max-w-md">
      <Card className="space-y-3 p-5">
        <div>
          <Label htmlFor="dll">Daily lead limit</Label>
          <Input id="dll" type="number" min={0} placeholder="e.g. 1000" value={limit} onChange={(e) => setLimit(e.target.value)} className="max-w-[220px]" />
          <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)]">The most leads this org can generate per day, across manual runs and the daily auto-run. Leave blank for no limit.</p>
        </div>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save limit</Button>
      </Card>
    </div>
  )
}
