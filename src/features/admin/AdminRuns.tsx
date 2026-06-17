import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import { RUN_STATUSES } from '../../config/constants'
import { formatMoney, formatNumber } from '../../lib/utils'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback'
import { PageHeader, StatusBadge, ProgressBar } from '../shared/bits'

export function AdminRunsPage() {
  const [status, setStatus] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-runs', status],
    queryFn: () => adminApi.runs({ status: status || undefined, page_size: 100 }),
    refetchInterval: 5000,
  })
  const runs = data?.data ?? []

  return (
    <div>
      <PageHeader title="Run monitoring" subtitle="Live status of every run across all clients." />
      <div className="mb-4 flex gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm">
          <option value="">All statuses</option>
          {RUN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="flex items-center text-[12px] text-[var(--color-text-muted)]">Auto-refreshing every 5s</span>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : runs.length === 0 ? (
          <EmptyState icon={Activity} title="No runs" message="No runs match this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 text-right font-medium">Leads</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{r.client_name}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">Roofing · {r.location_label}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><ProgressBar value={r.progress} className="w-24" /><span className="text-[12px] tabular-nums text-[var(--color-text-muted)]">{Math.round(r.progress * 100)}%</span></div></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(r.leads_found)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(r.cost_cents)}</td>
                    <td className="px-4 py-3 text-right"><Link to={`/admin/runs/${r.id}`} className="text-[13px] font-medium text-[var(--color-admin)] hover:underline">Manage</Link></td>
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
