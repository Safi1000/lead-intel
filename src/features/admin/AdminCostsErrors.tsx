import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { adminApi } from '../../api/endpoints'
import { formatMoney } from '../../lib/utils'
import { relativeTime } from '../../lib/time'
import { Button, Card } from '../../components/ui/primitives'
import { ErrorState, LoadingState, TableSkeleton, EmptyState } from '../../components/feedback'
import { PageHeader, ProgressBar, SectionCard } from '../shared/bits'
import { cn } from '../../lib/utils'

export function AdminCostsPage() {
  const [groupBy, setGroupBy] = useState<'run' | 'client'>('run')
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-costs', groupBy], queryFn: () => adminApi.costs(groupBy) })

  if (isLoading) return <LoadingState />
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />

  const ceilingPct = data.monthly_total_cents / data.monthly_ceiling_cents
  const chartData = data.rows.slice(0, 8).map((r) => ({ name: r.label.slice(0, 16), cost: r.total_cents / 100 }))

  return (
    <div>
      <PageHeader
        title="Cost tracking"
        subtitle="Per-run and per-client spend, with monthly ceiling monitoring."
        actions={
          <div className="flex rounded-[8px] border border-[var(--color-border)] p-0.5">
            {(['run', 'client'] as const).map((g) => (
              <button key={g} onClick={() => setGroupBy(g)} className={cn('rounded-[6px] px-3 py-1 text-sm font-medium capitalize', groupBy === g ? 'bg-[var(--color-admin)] text-white' : 'text-[var(--color-text-secondary)]')}>By {g}</button>
            ))}
          </div>
        }
      />

      {data.near_cap.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-semibold">API nearing monthly cap</p><p>{data.near_cap.map((c) => `${c.api} at ${Math.round(c.pct * 100)}%`).join(', ')}. Consider throttling new runs.</p></div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5"><p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">Monthly spend</p><p className="mt-1 text-[24px] font-bold tabular-nums">{formatMoney(data.monthly_total_cents)}</p></Card>
        <Card className="p-5"><p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">Monthly ceiling</p><p className="mt-1 text-[24px] font-bold tabular-nums">{formatMoney(data.monthly_ceiling_cents)}</p></Card>
        <Card className="p-5">
          <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">Ceiling used</p>
          <p className={cn('mt-1 text-[24px] font-bold tabular-nums', ceilingPct > 0.8 ? 'text-[var(--c-unverified)]' : '')}>{Math.round(ceilingPct * 100)}%</p>
          <div className="mt-2"><ProgressBar value={ceilingPct} className="h-1.5" /></div>
        </Card>
      </div>

      <SectionCard title="Spend by group" className="mt-6">
        <div className="p-5">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ left: -10 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" unit="$" />
              <RTooltip formatter={(v) => [`$${v}`, 'Cost']} />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]} fill="#7c3aed" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto border-t border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]"><th className="px-5 py-2.5 font-medium">Group</th><th className="px-5 py-2.5 font-medium">API breakdown</th><th className="px-5 py-2.5 text-right font-medium">Total</th></tr></thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {data.rows.map((r) => (
                <tr key={r.group}>
                  <td className="px-5 py-3 font-medium">{r.label}</td>
                  <td className="px-5 py-3 text-[13px] text-[var(--color-text-secondary)]">{r.api_breakdown.map((a) => `${a.api} ${formatMoney(a.cost_cents)}`).join(' · ') || '—'}</td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatMoney(r.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}

const SEVERITY = {
  critical: 'bg-red-50 text-red-700',
  warning: 'bg-amber-50 text-amber-700',
  info: 'bg-slate-100 text-slate-600',
}

export function AdminErrorsPage() {
  const [showResolved, setShowResolved] = useState(true)
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-errors'], queryFn: adminApi.errors })
  const rows = (data?.data ?? []).filter((e) => showResolved || !e.resolved)

  return (
    <div>
      <PageHeader
        title="Error log &amp; alerts"
        subtitle="API failures and alerts across all runs."
        actions={<Button variant="outline" size="sm" onClick={() => setShowResolved(!showResolved)}>{showResolved ? 'Hide resolved' : 'Show resolved'}</Button>}
      />
      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={5} cols={4} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No errors" message="No errors match this filter — systems healthy." />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {rows.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-4">
                <span className={cn('mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase', SEVERITY[e.severity])}>{e.severity}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{e.source} <span className="font-normal text-[var(--color-text-muted)]">· {e.client_name}</span></p>
                  <p className="text-[13px] text-[var(--color-text-secondary)]">{e.message}</p>
                  <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{relativeTime(e.created_at)}{e.run_id && <> · <a href={`/admin/runs/${e.run_id}`} className="text-[var(--color-admin)] hover:underline">view run</a></>}</p>
                </div>
                {e.resolved ? <span className="inline-flex items-center gap-1 text-[12px] text-[var(--c-verified)]"><CheckCircle2 className="h-3.5 w-3.5" /> Resolved</span> : <Button size="sm" variant="ghost">Mark resolved</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
