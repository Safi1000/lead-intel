import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, Mail, Phone, Snowflake } from 'lucide-react'
import { coldLeadsApi, crmApi, CRM_PROVIDERS, type ColdLeadRow, type CrmProvider } from '../../api/endpoints'
import { SendToCrmMenu, crmResultToast } from '../leadwork/SendToCrm'
import { normalizeError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Select, Checkbox } from '../../components/ui/controls'
import { LoadingState, ErrorState } from '../../components/feedback'
import { toast } from 'sonner'

const PAGE_SIZE = 50
const hrefFor = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`)
const prettyHost = (s: string) => { try { return new URL(hrefFor(s)).hostname.replace(/^www\./, '') } catch { return s } }

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function ColdLeadsPage() {
  const orgId = useAuthStore((s) => s.actingOrgId)
  const [location, setLocation] = useState('')
  const [niche, setNiche] = useState('')
  const [hasEmail, setHasEmail] = useState(false)
  const [hasPhone, setHasPhone] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  // Load the whole cold pool once, then filter + paginate in the browser (instant, no round-trips).
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cold-all', orgId],
    queryFn: () => coldLeadsApi.all(orgId),
    staleTime: 5 * 60 * 1000,
  })
  const allRows = useMemo(() => data?.rows ?? [], [data])

  // Resetting to page 1 whenever a filter changes keeps the view sensible.
  const set = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0) }

  const locations = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of allRows) if (r.location) m.set(r.location, (m.get(r.location) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [allRows])
  const niches = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>()
    for (const r of allRows) { const n = m.get(r.niche_key) ?? { label: r.niche_label, count: 0 }; n.count++; m.set(r.niche_key, n) }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [allRows])
  const withEmail = useMemo(() => allRows.filter((r) => r.email).length, [allRows])
  const withPhone = useMemo(() => allRows.filter((r) => r.phone).length, [allRows])

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return allRows.filter((r) =>
      (!location || r.location === location) &&
      (!niche || r.niche_key === niche) &&
      (!hasEmail || !!r.email) &&
      (!hasPhone || !!r.phone) &&
      (!ql || r.name.toLowerCase().includes(ql)),
    ).sort((a, b) => a.name.localeCompare(b.name))
  }, [allRows, location, niche, hasEmail, hasPhone, q])

  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount - 1)
  const rows = filtered.slice(pageSafe * PAGE_SIZE, (pageSafe + 1) * PAGE_SIZE)

  const locationOptions = useMemo(() => [{ value: '', label: 'All locations' }, ...locations.map(([v, c]) => ({ value: v, label: `${v} (${c})` }))], [locations])
  const nicheOptions = useMemo(() => [{ value: '', label: 'All niches' }, ...niches.map(([k, v]) => ({ value: k, label: `${v.label} (${v.count})` }))], [niches])

  // CRM: push the filtered cold pool into a connected CRM (backend caps a single push at 500).
  const CRM_CAP = 500
  const { data: crmStatus } = useQuery({ queryKey: ['crm-status'], queryFn: () => crmApi.status(orgId), staleTime: 60_000 })
  const crmConnected = useMemo<CrmProvider[]>(
    () => (crmStatus ? CRM_PROVIDERS.filter((p) => crmStatus[p]?.connected) : []),
    [crmStatus],
  )
  const sendCrm = useMutation({
    mutationFn: async (providers: CrmProvider[]) => {
      const ids = filtered.slice(0, CRM_CAP).map((r) => r.place_id)
      const all = await Promise.all(providers.map((p) => crmApi.push({ provider: p, source: 'cold', ids, orgId })))
      return { results: all.flatMap((r) => r.results), providers }
    },
    onSuccess: ({ results, providers }) => crmResultToast(results, providers),
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const doExport = () => {
    const cols: Array<[string, keyof ColdLeadRow]> = [
      ['Name', 'name'], ['Niche', 'niche_label'], ['Location', 'location'], ['Phone', 'phone'],
      ['Email', 'email'], ['Website', 'website'], ['Rating', 'rating'], ['Website Status', 'website_status'],
    ]
    const header = cols.map((c) => c[0]).join(',')
    const lines = filtered.map((r) => cols.map((c) => csvEscape(r[c[1]])).join(','))
    download(`cold-leads-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines].join('\n'))
    toast.success(`Exported ${filtered.length} leads`)
  }

  if (isError) return <ErrorState onRetry={() => refetch()} />

  return (
    <div className="reveal mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-bold tracking-tight"><Snowflake className="h-6 w-6 text-[var(--color-primary)]" /> Cold Leads</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Businesses we scanned but didn't qualify — a raw pool to filter and export.</p>
        </div>
        <div className="flex items-center gap-2">
          <SendToCrmMenu
            connected={crmConnected}
            pending={sendCrm.isPending}
            disabled={total === 0}
            size="md"
            onSend={(p) => sendCrm.mutate(p)}
            label={`Send to CRM${total > CRM_CAP ? ` (${CRM_CAP})` : total > 0 ? ` (${total.toLocaleString()})` : ''}`}
          />

          <Button onClick={doExport} disabled={total === 0}><Download className="h-4 w-4" /> Export CSV{total > 0 ? ` (${total.toLocaleString()})` : ''}</Button>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Total cold leads" value={isLoading ? undefined : allRows.length} />
        <Stat label="With a phone" value={isLoading ? undefined : withPhone} />
        <Stat label="With an email" value={isLoading ? undefined : withEmail} />
      </div>

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="mb-1 text-[12px]">Location</Label>
            <Select value={location} onValueChange={set(setLocation)} options={locationOptions} className="w-full" />
          </div>
          <div>
            <Label className="mb-1 text-[12px]">Niche</Label>
            <Select value={niche} onValueChange={set(setNiche)} options={nicheOptions} className="w-full" />
          </div>
          <div>
            <Label htmlFor="cold-q" className="mb-1 text-[12px]">Search by name</Label>
            <Input id="cold-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Business name…" />
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={hasEmail} onCheckedChange={set(setHasEmail)} aria-label="Has email" /> Has email</label>
            <label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={hasPhone} onCheckedChange={set(setHasPhone)} aria-label="Has phone" /> Has phone</label>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {isLoading ? <LoadingState /> : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-text-muted)]">No cold leads match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-4 py-2.5 font-medium">Business</th>
                  <th className="px-4 py-2.5 font-medium">Niche</th>
                  <th className="px-4 py-2.5 font-medium">Location</th>
                  <th className="px-4 py-2.5 font-medium">Phone</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Website</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rating</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.place_id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-4 py-2.5 font-medium">{r.name || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{r.niche_label}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{r.location || '—'}</td>
                    <td className="px-4 py-2.5">{r.phone ? <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"><Phone className="h-3.5 w-3.5" />{r.phone}</a> : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                    <td className="px-4 py-2.5">{r.email ? <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 break-all text-[var(--color-primary)] hover:underline"><Mail className="h-3.5 w-3.5 shrink-0" />{r.email}</a> : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                    <td className="px-4 py-2.5">{r.website ? <a href={hrefFor(r.website)} target="_blank" rel="noreferrer" title={r.website} className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline">{prettyHost(r.website)}<ExternalLink className="h-3 w-3 shrink-0" /></a> : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.rating != null ? `${r.rating}★` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-3 flex items-center justify-between text-[13px] text-[var(--color-text-muted)]">
          <span className="tabular-nums">{pageSafe * PAGE_SIZE + 1}–{Math.min((pageSafe + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)}>Prev</Button>
            <span className="tabular-nums">Page {pageSafe + 1} of {pageCount}</span>
            <Button size="sm" variant="outline" disabled={pageSafe >= pageCount - 1} onClick={() => setPage(pageSafe + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <Card className="p-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-[22px] font-bold tabular-nums">{value == null ? '—' : value.toLocaleString()}</p>
    </Card>
  )
}
