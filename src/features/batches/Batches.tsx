import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Boxes, Download } from 'lucide-react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { batchesApi } from '../../api/endpoints'
import { CONFIDENCE, type ConfidenceStatus } from '../../config/constants'
import { useAuth } from '../../hooks'
import { formatMoney, formatNumber, formatPercent } from '../../lib/utils'
import { relativeTime, absoluteTime } from '../../lib/time'
import { Button, Card } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from '../../components/feedback'
import { PageHeader, FillChip, SectionCard } from '../shared/bits'

export function BatchesPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['batches'], queryFn: batchesApi.list })
  const batches = data?.data ?? []

  return (
    <div>
      <PageHeader title="Batches" subtitle="Delivery batches produced by completed runs." />
      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : batches.length === 0 ? (
          <EmptyState icon={Boxes} title="No batches yet" message="Completed runs deliver batches with an auto-generated fill-rate report." action={<Link to="/runs/new"><Button>New Run</Button></Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Batch</th>
                  <th className="px-4 py-3 text-right font-medium">Leads</th>
                  <th className="px-4 py-3 font-medium">Fill</th>
                  <th className="px-4 py-3 font-medium">Delivered</th>
                  <th className="px-4 py-3 text-right font-medium">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {batches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">Roofing · {b.location_label}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(b.lead_count)}</td>
                    <td className="px-4 py-3"><FillChip value={b.fill_rate} /></td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]" title={absoluteTime(b.delivered_at)}>{relativeTime(b.delivered_at)}</td>
                    <td className="px-4 py-3 text-right"><Link to={`/batches/${b.id}/report`}><Button variant="outline" size="sm">View report</Button></Link></td>
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

export function FillRateReportPage() {
  const { batchId } = useParams()
  const { role } = useAuth()
  const canSeeCost = role === 'manager'
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['batch-report', batchId],
    queryFn: () => batchesApi.report(batchId as string),
  })

  if (isLoading) return <LoadingState label="Building report…" />
  if (isError || !data) return <ErrorState message="Report not found." onRetry={() => refetch()} />

  const fieldData = data.per_field.map((f) => ({ name: f.field, value: Math.round(f.fill * 100) }))
  const dist = data.confidence_distribution
  const distTotal = (Object.values(dist) as number[]).reduce((a, b) => a + b, 0) || 1
  const order: ConfidenceStatus[] = ['verified', 'probable', 'unverified', 'missing']

  return (
    <div>
      <PageHeader
        title="Fill-rate report"
        subtitle={<Link to="/batches" className="text-[var(--color-primary)] hover:underline">← Back to batches</Link>}
        actions={<Button variant="outline"><Download className="h-4 w-4" /> Download report</Button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Mini label="Leads" value={formatNumber(data.batch.lead_count)} />
        <Mini label="Overall fill" value={formatPercent(data.batch.fill_rate)} />
        <Mini label="Deduped" value={`${data.batch.deduped_count} skipped`} hint="Already delivered to you" />
        {canSeeCost && <Mini label="Total cost" value={formatMoney(data.cost_cents)} />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Fill rate by field">
          <div className="p-5">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={fieldData} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94A3B8" unit="%" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={100} stroke="#94A3B8" />
                <RTooltip formatter={(v) => [`${v}%`, 'Fill']} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#2563EB" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Confidence distribution">
          <div className="p-5">
            <div className="flex h-4 overflow-hidden rounded-full">
              {order.map((s) => (
                <div key={s} title={`${CONFIDENCE[s].label}: ${dist[s]}`} style={{ width: `${(dist[s] / distTotal) * 100}%`, backgroundColor: `var(--c-${s})` }} />
              ))}
            </div>
            <ul className="mt-4 space-y-2">
              {order.map((s) => (
                <li key={s} className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `var(--c-${s})` }} />{CONFIDENCE[s].label}</span>
                  <span className="tabular-nums text-[var(--color-text-secondary)]">{dist[s]} ({formatPercent(dist[s] / distTotal)})</span>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-[22px] font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[12px] text-[var(--color-text-muted)]">{hint}</p>}
    </Card>
  )
}
