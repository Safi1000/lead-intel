import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Workflow } from 'lucide-react'
import { runsApi } from '../../api/endpoints'
import { RUN_STATUSES } from '../../config/constants'
import { useDebounce } from '../../hooks'
import { SEARCH_DEBOUNCE_MS } from '../../config/constants'
import { formatNumber } from '../../lib/utils'
import { relativeTime, absoluteTime } from '../../lib/time'
import { Button, Input } from '../../components/ui/primitives'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback'
import { PageHeader, StatusBadge, FillChip } from '../shared/bits'

export function RunHistoryPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, SEARCH_DEBOUNCE_MS)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['runs', { status, search: debounced }],
    queryFn: () => runsApi.list({ status: status || undefined, search: debounced || undefined, page_size: 50 }),
  })
  const runs = data?.data ?? []

  return (
    <div>
      <PageHeader
        title="Runs"
        subtitle="Every enrichment run for your account."
        actions={<Link to="/runs/new"><Button><Plus className="h-4 w-4" /> New Run</Button></Link>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search by city…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select
          value={status}
          onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
          className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
        >
          <option value="">All statuses</option>
          {RUN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : runs.length === 0 ? (
          <EmptyState icon={Workflow} title="No runs yet" message="Launch your first run to start discovering leads." action={<Link to="/runs/new"><Button>New Run</Button></Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Trade · Location</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Leads</th>
                  <th className="px-4 py-3 font-medium">Fill</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/runs/${r.id}`} className="font-medium hover:text-[var(--color-primary)]">Roofing · {r.location_label}</Link>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(r.leads_found)}</td>
                    <td className="px-4 py-3"><FillChip value={r.fill_rate?.overall} /></td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]" title={absoluteTime(r.created_at)}>{relativeTime(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Link to={`/runs/${r.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                        <Link to={`/runs/${r.id}/leads`}><Button variant="ghost" size="sm">Leads</Button></Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
