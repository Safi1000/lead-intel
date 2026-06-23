import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { FileSpreadsheet, FileUp, Flame, Layers, Search, Snowflake } from 'lucide-react'
import { Link } from 'react-router-dom'
import { leadBatchesApi } from '../../api/endpoints'
import { useAuth, useDebounce } from '../../hooks'
import { Button, Card, Input } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'
import { cn } from '../../lib/utils'
import type { LeadBatch } from '../../api/types'

export function BatchesPage() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const isGenerator = role === 'manager' || role === 'lead_generator' || role === 'admin' || role === 'superadmin'

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['lead-batches'], queryFn: leadBatchesApi.list })
  const [searchRaw, setSearchRaw] = useState('')
  const search = useDebounce(searchRaw, 200).toLowerCase()

  const batches = data ?? []
  const totals = useMemo(() => ({
    batches: batches.length,
    leads: batches.reduce((s, b) => s + b.lead_count, 0),
    closed: batches.reduce((s, b) => s + b.closed_count, 0),
    warm: batches.reduce((s, b) => s + b.warm, 0),
    cold: batches.reduce((s, b) => s + b.cold, 0),
  }), [batches])

  const filtered = useMemo(() => {
    if (!search) return batches
    return batches.filter((b) => (b.file_name + ' ' + b.template_name + ' ' + (b.created_by ?? '')).toLowerCase().includes(search))
  }, [batches, search])

  return (
    <div className="reveal">
      <PageHeader
        title="Leads"
        subtitle="Each uploaded sheet is a batch. Open one to work its leads."
        actions={isGenerator ? <Link to="/upload"><Button><FileUp className="h-4 w-4" /> Upload leads</Button></Link> : undefined}
      />

      {!isLoading && !isError && batches.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Batches" value={totals.batches} />
          <StatCard label="Total leads" value={totals.leads} />
          <StatCard label="Closed" value={totals.closed} />
          <StatCard label="Warm" value={totals.warm} />
          <StatCard label="Cold" value={totals.cold} />
        </div>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder="Search batches…" className="pl-9" />
      </div>

      <Card>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={batches.length === 0 ? 'No batches yet' : 'No batches match'}
            message={batches.length === 0 ? 'Upload a sheet of leads — each upload becomes a batch you can work.' : 'Try a different search.'}
            action={isGenerator && batches.length === 0 ? <Link to="/upload"><Button><FileUp className="h-4 w-4" /> Upload leads</Button></Link> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Batch</th>
                  <th className="px-3 py-2.5 font-medium">Leads</th>
                  <th className="px-3 py-2.5 font-medium">Progress</th>
                  <th className="px-3 py-2.5 font-medium">Temp</th>
                  <th className="px-3 py-2.5 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <BatchRow key={b.id} batch={b} onOpen={() => navigate(`/leads/batch/${b.id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Pill({ label, value, className }: { label: string; value: number; className: string }) {
  if (!value) return null
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>{value} {label}</span>
}

function BatchRow({ batch: b, onOpen }: { batch: LeadBatch; onOpen: () => void }) {
  return (
    <tr className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50" onClick={onOpen}>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-blue-50 text-[var(--color-primary)]"><FileSpreadsheet className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="truncate font-medium text-[var(--color-text)]">{b.file_name}</p>
            <p className="truncate text-[12px] text-[var(--color-text-muted)]">{b.template_name}{b.created_by ? ` · by ${b.created_by}` : ''}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <span className="font-semibold tabular-nums">{b.lead_count}</span>
        {b.rejected_count > 0 && <span className="ml-1 text-[12px] text-[var(--color-text-muted)]">({b.rejected_count} rejected)</span>}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          <Pill label="new" value={b.new_count} className="bg-slate-100 text-slate-600" />
          <Pill label="setter" value={b.with_setter} className="bg-blue-50 text-blue-700" />
          <Pill label="closer" value={b.with_closer} className="bg-violet-50 text-violet-700" />
          <Pill label="open" value={b.open_count} className="bg-amber-50 text-amber-700" />
          <Pill label="closed" value={b.closed_count} className="bg-green-50 text-green-700" />
          <Pill label="returned" value={b.returned_count} className="bg-orange-50 text-orange-700" />
          {b.lead_count === 0 && <span className="text-[12px] text-[var(--color-text-muted)]">—</span>}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="inline-flex items-center gap-1 text-red-600"><Flame className="h-3.5 w-3.5" /> {b.warm}</span>
          <span className="inline-flex items-center gap-1 text-sky-600"><Snowflake className="h-3.5 w-3.5" /> {b.cold}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-[13px] text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}</td>
    </tr>
  )
}
