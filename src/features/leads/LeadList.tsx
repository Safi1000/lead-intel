import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { Check, Download, Filter, Globe, Megaphone, Rows3, SlidersHorizontal } from 'lucide-react'
import { leadsApi, exportsApi } from '../../api/endpoints'
import { useDebounce } from '../../hooks'
import { SEARCH_DEBOUNCE_MS } from '../../config/constants'
import { useUIStore } from '../../stores/uiStore'
import { cn } from '../../lib/utils'
import { Button, Input } from '../../components/ui/primitives'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Checkbox,
  Switch,
} from '../../components/ui/controls'
import { ConfidenceDot, ConfidenceLegend, FieldCell, rowBorderColor } from '../../components/confidence'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import type { LeadRow } from '../../api/types'

type ColKey =
  | 'business_name'
  | 'owner_name'
  | 'business_phone'
  | 'owner_phone'
  | 'email'
  | 'website'
  | 'ads'
  | 'socials'

const COLUMNS: { key: ColKey; label: string; always?: boolean }[] = [
  { key: 'business_name', label: 'Business', always: true },
  { key: 'owner_name', label: 'Owner' },
  { key: 'business_phone', label: 'Business phone' },
  { key: 'owner_phone', label: 'Owner phone' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
  { key: 'ads', label: 'Ads' },
  { key: 'socials', label: 'Social' },
]

export function LeadListPage() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const compact = useUIStore((s) => s.compactTables)
  const setCompact = useUIStore((s) => s.setCompact)

  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, SEARCH_DEBOUNCE_MS)
  const [hasOwnerPhone, setHasOwnerPhone] = useState(false)
  const [hasEmail, setHasEmail] = useState(false)
  const [conf, setConf] = useState('')
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['leads', runId, { debounced, hasOwnerPhone, hasEmail, conf }],
    queryFn: () =>
      leadsApi.listForRun(runId as string, {
        search: debounced || undefined,
        has_owner_phone: hasOwnerPhone || undefined,
        has_email: hasEmail || undefined,
        confidence: conf || undefined,
        page_size: 5000,
      }),
  })
  const leads = useMemo(() => data?.data ?? [], [data])

  const exportLeads = useMutation({
    mutationFn: (format: 'csv' | 'xlsx') => exportsApi.create({ run_id: runId, format }),
    onSuccess: () => {
      toast.success('Export started — track it on the Exports page.')
      navigate('/exports')
    },
  })

  const visibleCols = COLUMNS.filter((c) => !hidden.has(c.key))

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null)
  const rowHeight = compact ? 36 : 44
  const virtualizer = useVirtualizer({
    count: leads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  })

  const allSelected = leads.length > 0 && selected.size === leads.length
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)))
  }
  function toggleOne(id: string) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle={<Link to={`/runs/${runId}`} className="text-[var(--color-primary)] hover:underline">← Back to run</Link>}
        actions={
          <>
            <Button variant="outline" onClick={() => exportLeads.mutate('csv')} loading={exportLeads.isPending}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="ghost" onClick={() => exportLeads.mutate('xlsx')}>Export XLSX</Button>
          </>
        }
      />

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search business or owner…" value={search} onChange={(e) => setSearch(e.target.value)} />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4" /> Filters
              {(hasOwnerPhone || hasEmail || conf) && <span className="ml-1 h-2 w-2 rounded-full bg-[var(--color-primary)]" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-3">
            <label className="flex items-center justify-between text-sm">Has owner phone <Switch checked={hasOwnerPhone} onCheckedChange={setHasOwnerPhone} /></label>
            <label className="flex items-center justify-between text-sm">Has email <Switch checked={hasEmail} onCheckedChange={setHasEmail} /></label>
            <div>
              <p className="mb-1 text-[13px] font-medium">Row confidence</p>
              <select value={conf} onChange={(e) => setConf(e.target.value)} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] px-2 text-sm">
                <option value="">Any</option>
                <option value="verified">Verified</option>
                <option value="probable">Probable</option>
                <option value="unverified">Unverified</option>
                <option value="missing">Missing</option>
              </select>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm"><SlidersHorizontal className="h-4 w-4" /> Columns</Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 space-y-1.5">
            {COLUMNS.map((c) => (
              <label key={c.key} className={cn('flex items-center gap-2 text-sm', c.always && 'opacity-50')}>
                <Checkbox
                  checked={!hidden.has(c.key)}
                  onCheckedChange={(v) => {
                    if (c.always) return
                    const next = new Set(hidden)
                    v ? next.delete(c.key) : next.add(c.key)
                    setHidden(next)
                  }}
                  aria-label={c.label}
                />
                {c.label}
              </label>
            ))}
          </PopoverContent>
        </Popover>

        <Button variant="outline" size="sm" onClick={() => setCompact(!compact)}>
          <Rows3 className="h-4 w-4" /> {compact ? 'Comfortable' : 'Compact'}
        </Button>

        <span className="ml-auto hidden sm:block"><ConfidenceLegend /></span>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="mb-2 flex items-center gap-3 rounded-[8px] border border-[var(--color-primary)] bg-blue-50 px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => exportLeads.mutate('csv')}>Export selected</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={10} cols={visibleCols.length + 1} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : leads.length === 0 ? (
          <EmptyState
            icon={Filter}
            title="No leads match"
            message={search || hasOwnerPhone || hasEmail || conf ? 'No leads match your filters — try clearing them.' : 'This run produced no leads yet. If it’s still running, leads appear live.'}
            action={(search || hasOwnerPhone || hasEmail || conf) ? <Button variant="outline" size="sm" onClick={() => { setSearch(''); setHasOwnerPhone(false); setHasEmail(false); setConf('') }}>Clear filters</Button> : undefined}
          />
        ) : (
          <div>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2 text-[12px] text-[var(--color-text-muted)]">
              <span>{leads.length.toLocaleString()} leads</span>
              <span className="sm:hidden"><ConfidenceLegend /></span>
            </div>
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-slate-50 px-4 py-2 text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <span className="w-5"><Checkbox checked={allSelected ? true : selected.size ? 'indeterminate' : false} onCheckedChange={toggleAll} aria-label="Select all" /></span>
              {visibleCols.map((c) => (
                <span key={c.key} className={cn('truncate', c.key === 'business_name' ? 'flex-[2]' : 'flex-1', (c.key === 'ads' || c.key === 'website') && 'hidden md:block')}>{c.label}</span>
              ))}
              <span className="w-14 text-right">View</span>
            </div>
            {/* Virtualized rows */}
            <div ref={parentRef} className="scrollbar-thin max-h-[calc(100dvh-320px)] overflow-auto">
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((vi) => {
                  const lead = leads[vi.index]
                  return (
                    <LeadRowView
                      key={lead.id}
                      lead={lead}
                      cols={visibleCols}
                      selected={selected.has(lead.id)}
                      onToggle={() => toggleOne(lead.id)}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: vi.size, transform: `translateY(${vi.start}px)` }}
                      compact={compact}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LeadRowView({
  lead,
  cols,
  selected,
  onToggle,
  style,
  compact,
}: {
  lead: LeadRow
  cols: readonly { key: ColKey; label: string }[]
  selected: boolean
  onToggle: () => void
  style: React.CSSProperties
  compact: boolean
}) {
  return (
    <div
      style={{ ...style, borderLeft: `3px solid ${rowBorderColor(lead.row_confidence)}` }}
      className={cn('flex items-center gap-3 border-b border-[var(--color-border)] px-4 text-sm hover:bg-slate-50', compact ? 'py-1.5' : 'py-2.5', selected && 'bg-blue-50/60')}
    >
      <span className="w-5"><Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${lead.business_name}`} /></span>
      {cols.map((c) => (
        <span key={c.key} className={cn('truncate', c.key === 'business_name' ? 'flex-[2] font-medium' : 'flex-1', (c.key === 'ads' || c.key === 'website') && 'hidden md:block')}>
          <Cell colKey={c.key} lead={lead} />
        </span>
      ))}
      <span className="w-14 text-right">
        <Link to={`/leads/${lead.id}`} className="text-[13px] font-medium text-[var(--color-primary)] hover:underline">View</Link>
      </span>
    </div>
  )
}

function Cell({ colKey, lead }: { colKey: ColKey; lead: LeadRow }) {
  switch (colKey) {
    case 'business_name':
      return <span className="truncate">{lead.business_name}</span>
    case 'owner_name':
      return <FieldCell field={lead.owner_name} />
    case 'business_phone':
      return <FieldCell field={lead.business_phone} />
    case 'owner_phone':
      return <FieldCell field={lead.owner_phone} />
    case 'email':
      return <FieldCell field={lead.email} />
    case 'website':
      return lead.website_live == null ? (
        <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]"><ConfidenceDot status="missing" />—</span>
      ) : (
        <span className={cn('inline-flex items-center gap-1', lead.website_live ? 'text-[var(--c-verified)]' : 'text-[var(--c-unverified)]')}>
          <Globe className="h-3.5 w-3.5" />{lead.website_live ? 'Live' : 'Down'}
        </span>
      )
    case 'ads':
      return lead.ad_activity === 'active' ? (
        <span className="inline-flex items-center gap-1 text-[var(--c-probable)]"><Megaphone className="h-3.5 w-3.5" />Active</span>
      ) : (
        <span className="text-[var(--color-text-muted)]">None</span>
      )
    case 'socials':
      return lead.socials.length ? (
        <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]"><Check className="h-3.5 w-3.5" />{lead.socials.length}</span>
      ) : (
        <span className="text-[var(--color-text-muted)]">—</span>
      )
    default:
      return null
  }
}
