import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Search } from 'lucide-react'
import { sourcingApi, verticalsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Select, Checkbox } from '../../components/ui/controls'
import { LoadingState } from '../../components/feedback'
import { cn } from '../../lib/utils'

/** Per-tenant sourcing profile — niche + target cities + safe field toggles. Drives the engine.
 * Rendered inside the unified Sourcing workspace (config → cost → run). */
export function SourcingConfig() {
  const qc = useQueryClient()
  const { data: verticals } = useQuery({ queryKey: ['verticals'], queryFn: () => verticalsApi.list() })
  const { data: profile, isLoading } = useQuery({ queryKey: ['sourcing-profile'], queryFn: () => sourcingApi.get() })

  const [verticalKey, setVerticalKey] = useState('')
  const [metros, setMetros] = useState<string[]>([])
  const [fetchAds, setFetchAds] = useState(true)
  const [fetchEmail, setFetchEmail] = useState(true)
  const [fetchHours, setFetchHours] = useState(true)
  const [search, setSearch] = useState('')

  // Worldwide city list (~148k), lazy-loaded so it doesn't bloat the initial bundle.
  const citiesRef = useRef<{ list: { name: string; countryCode: string }[]; countries: Map<string, string> } | null>(null)
  const [citiesReady, setCitiesReady] = useState(false)
  useEffect(() => {
    let alive = true
    import('country-state-city').then(({ City, Country }) => {
      if (!alive) return
      citiesRef.current = { list: City.getAllCities(), countries: new Map(Country.getAllCountries().map((c) => [c.isoCode, c.name])) }
      setCitiesReady(true)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (profile) {
      setVerticalKey(profile.vertical_key ?? '')
      setMetros(profile.metros ?? [])
      setFetchAds(profile.fetch_ads); setFetchEmail(profile.fetch_email); setFetchHours(profile.fetch_hours)
    }
  }, [profile])

  const save = useMutation({
    mutationFn: () => sourcingApi.save({ vertical_key: verticalKey || null, search_terms: null, metros, fetch_ads: fetchAds, fetch_email: fetchEmail, fetch_hours: fetchHours, daily_limit: profile?.daily_limit ?? 1000, active: true }),
    onSuccess: () => { toast.success('Sourcing profile saved'); qc.invalidateQueries({ queryKey: ['sourcing-profile'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const filtered = useMemo(() => {
    const data = citiesRef.current
    const q = search.trim().toLowerCase()
    if (!data || q.length < 2) return []
    const seen = new Set<string>()
    const prefix: string[] = []
    const sub: string[] = []
    for (const c of data.list) {
      const idx = c.name.toLowerCase().indexOf(q)
      if (idx === -1) continue
      const label = `${c.name}, ${data.countries.get(c.countryCode) ?? c.countryCode}`
      if (seen.has(label)) continue
      seen.add(label)
      ;(idx === 0 ? prefix : sub).push(label)
      if (prefix.length + sub.length >= 400) break // scan cap
    }
    // Prefix (name starts with query) first, shortest first so "Paris, France" beats "Paris-Plage".
    prefix.sort((a, b) => a.length - b.length)
    return [...prefix, ...sub].slice(0, 100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, citiesReady])
  const toggleMetro = (loc: string) => setMetros((m) => (m.includes(loc) ? m.filter((x) => x !== loc) : [...m, loc]))

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
        <div className="mb-2 flex items-center justify-between">
          <Label className="mb-0">Target cities ({metros.length} selected)</Label>
          {metros.length > 0 && <button onClick={() => setMetros([])} className="text-[12px] text-[var(--color-primary)] hover:underline">Clear all</button>}
        </div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cities…" className="pl-9" />
        </div>
        {metros.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {metros.slice(0, 30).map((m) => <button key={m} onClick={() => toggleMetro(m)} className="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[12px] text-[var(--color-primary)]">{m.split(',')[0]} ✕</button>)}
            {metros.length > 30 && <span className="self-center text-[12px] text-[var(--color-text-muted)]">+{metros.length - 30} more</span>}
          </div>
        )}
        <div className="max-h-64 overflow-y-auto rounded-[10px] border border-[var(--color-border)]">
          {search.trim().length < 2 ? (
            <p className="px-3 py-6 text-center text-[13px] text-[var(--color-text-muted)]">{citiesReady ? 'Type at least 2 letters to search cities worldwide.' : 'Loading world cities…'}</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-[var(--color-text-muted)]">No cities match “{search}”.</p>
          ) : filtered.map((loc) => {
            const sel = metros.includes(loc)
            return (
              <button key={loc} onClick={() => toggleMetro(loc)} className={cn('flex w-full items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-left text-[13px] last:border-0 hover:bg-[var(--color-surface-2)]', sel && 'bg-[var(--color-primary)]/5')}>
                <span>{loc}</span>
                {sel && <Check className="h-4 w-4 text-[var(--color-primary)]" />}
              </button>
            )
          })}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button>
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
