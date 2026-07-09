import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Search } from 'lucide-react'
import { locationsApi, sourcingApi, verticalsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Select, Checkbox } from '../../components/ui/controls'
import { LoadingState } from '../../components/feedback'
import { cn } from '../../lib/utils'

/** Per-tenant sourcing profile — niche + target cities + safe field toggles. Drives the engine. */
export function SourcingProfilePage() {
  const qc = useQueryClient()
  const { data: verticals } = useQuery({ queryKey: ['verticals'], queryFn: () => verticalsApi.list() })
  const { data: locations } = useQuery({ queryKey: ['sourcing-locations'], queryFn: () => locationsApi.list() })
  const { data: profile, isLoading } = useQuery({ queryKey: ['sourcing-profile'], queryFn: () => sourcingApi.get() })

  const [verticalKey, setVerticalKey] = useState('')
  const [metros, setMetros] = useState<string[]>([])
  const [fetchAds, setFetchAds] = useState(true)
  const [fetchEmail, setFetchEmail] = useState(true)
  const [fetchHours, setFetchHours] = useState(true)
  const [dailyLimit, setDailyLimit] = useState('1000')
  const [active, setActive] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (profile) {
      setVerticalKey(profile.vertical_key ?? '')
      setMetros(profile.metros ?? [])
      setFetchAds(profile.fetch_ads); setFetchEmail(profile.fetch_email); setFetchHours(profile.fetch_hours)
      setDailyLimit(String(profile.daily_limit)); setActive(profile.active)
    }
  }, [profile])

  const save = useMutation({
    mutationFn: () => sourcingApi.save({ vertical_key: verticalKey || null, search_terms: null, metros, fetch_ads: fetchAds, fetch_email: fetchEmail, fetch_hours: fetchHours, daily_limit: Number(dailyLimit) || 1000, active }),
    onSuccess: () => { toast.success('Sourcing profile saved'); qc.invalidateQueries({ queryKey: ['sourcing-profile'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return (locations ?? []).filter((l) => !q || l.location.toLowerCase().includes(q)).slice(0, 200)
  }, [locations, search])
  const toggleMetro = (loc: string) => setMetros((m) => (m.includes(loc) ? m.filter((x) => x !== loc) : [...m, loc]))

  if (isLoading) return <LoadingState />

  return (
    <div className="reveal max-w-3xl space-y-5">

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

        <div className="grid max-w-sm grid-cols-2 gap-3">
          <div><Label>Daily lead limit</Label><Input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} /></div>
          <label htmlFor="f-active" className="flex cursor-pointer items-center gap-2 pb-2 text-sm"><Checkbox id="f-active" checked={active} onCheckedChange={setActive} aria-label="Sourcing active" /> Sourcing active</label>
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
          {filtered.map((l) => {
            const sel = metros.includes(l.location)
            return (
              <button key={l.location} onClick={() => toggleMetro(l.location)} className={cn('flex w-full items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-left text-[13px] last:border-0 hover:bg-[var(--color-surface-2)]', sel && 'bg-[var(--color-primary)]/5')}>
                <span>{l.location}</span>
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
