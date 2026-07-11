import { useEffect, useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Download, ExternalLink, Mail, Phone, Snowflake } from 'lucide-react'
import { coldLeadsApi, type ColdLeadRow, type ColdLeadFilters } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Select } from '../../components/ui/controls'
import { LoadingState } from '../../components/feedback'
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
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)

  // Debounce the name search so we don't refetch on every keystroke; reset to page 1 on change.
  useEffect(() => { const t = setTimeout(() => { setQ(qInput.trim()); setPage(0) }, 300); return () => clearTimeout(t) }, [qInput])
  // Filter changes go back to page 1 (handled in each control's onChange below).
  const pick = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0) }

  const filters: ColdLeadFilters = { location, niche, hasEmail, hasPhone, q, orgId }

  const facets = useQuery({ queryKey: ['cold-facets', orgId], queryFn: () => coldLeadsApi.facets(orgId) })
  const list = useQuery({
    queryKey: ['cold-list', filters, page],
    queryFn: () => coldLeadsApi.list({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })

  const rows = list.data?.rows ?? []
  const total = list.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const locationOptions = useMemo(() => [
    { value: '', label: 'All locations' },
    ...(facets.data?.locations ?? []).map((l) => ({ value: l.value, label: `${l.value} (${l.count})` })),
  ], [facets.data])
  const nicheOptions = useMemo(() => [
    { value: '', label: 'All niches' },
    ...(facets.data?.niches ?? []).map((n) => ({ value: n.key, label: `${n.label} (${n.count})` })),
  ], [facets.data])

  const doExport = async () => {
    setExporting(true)
    try {
      const { rows: all } = await coldLeadsApi.export(filters)
      const cols: Array<[string, keyof ColdLeadRow]> = [
        ['Name', 'name'], ['Niche', 'niche_label'], ['Location', 'location'], ['Phone', 'phone'],
        ['Email', 'email'], ['Website', 'website'], ['Rating', 'rating'], ['Website Status', 'website_status'],
      ]
      const header = cols.map((c) => c[0]).join(',')
      const lines = all.map((r) => cols.map((c) => csvEscape(r[c[1]])).join(','))
      download(`cold-leads-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines].join('\n'))
      toast.success(`Exported ${all.length} leads`)
    } catch (e) { toast.error(normalizeError(e).message) }
    finally { setExporting(false) }
  }

  return (
    <div className="reveal mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-bold tracking-tight"><Snowflake className="h-6 w-6 text-[var(--color-primary)]" /> Cold Leads</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Businesses we scanned but didn't qualify — a raw pool to filter and export.</p>
        </div>
        <Button onClick={doExport} loading={exporting} disabled={total === 0}><Download className="h-4 w-4" /> Export CSV</Button>
      </div>

      {/* Summary */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Total cold leads" value={facets.data?.total} />
        <Stat label="With a phone" value={facets.data?.withPhone} />
        <Stat label="With an email" value={facets.data?.withEmail} />
      </div>

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="mb-1 text-[12px]">Location</Label>
            <Select value={location} onValueChange={pick(setLocation)} options={locationOptions} className="w-full" />
          </div>
          <div>
            <Label className="mb-1 text-[12px]">Niche</Label>
            <Select value={niche} onValueChange={pick(setNiche)} options={nicheOptions} className="w-full" />
          </div>
          <div>
            <Label htmlFor="cold-q" className="mb-1 text-[12px]">Search by name</Label>
            <Input id="cold-q" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Business name…" />
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm"><input type="checkbox" checked={hasEmail} onChange={(e) => pick(setHasEmail)(e.target.checked)} className="accent-[var(--color-primary)]" /> Has email</label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm"><input type="checkbox" checked={hasPhone} onChange={(e) => pick(setHasPhone)(e.target.checked)} className="accent-[var(--color-primary)]" /> Has phone</label>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {list.isLoading ? <LoadingState /> : rows.length === 0 ? (
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
          <span className="tabular-nums">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="tabular-nums">Page {page + 1} of {pageCount}</span>
            <Button size="sm" variant="outline" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
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
