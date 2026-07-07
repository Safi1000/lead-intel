import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { kpisApi } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'
import { cn } from '../../lib/utils'

const RANGES = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: 'mtd', label: 'This month' },
]

function sinceFor(range: string): string {
  if (range === 'mtd') { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }
  const days = range === '7' ? 7 : 30
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/** §8 setter funnel — disposition-derived (dials/talk-time arrive once CloudTalk is on Expert). */
export function PerformancePage() {
  const [range, setRange] = useState('30')
  const since = useMemo(() => sinceFor(range), [range])
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['setter-kpis', range], queryFn: () => kpisApi.setterFunnel(since) })
  const { data: closers } = useQuery({ queryKey: ['closer-kpis'], queryFn: () => kpisApi.closerFunnel() })

  const rows = data ?? []
  const totals = useMemo(() => rows.reduce((a, r) => ({
    attempts: a.attempts + r.attempts, connects: a.connects + r.connects, conversations: a.conversations + r.conversations, booked: a.booked + r.booked,
  }), { attempts: 0, connects: 0, conversations: 0, booked: 0 }), [rows])
  const connectRate = totals.attempts ? Math.round((totals.connects / totals.attempts) * 100) : 0
  const bookingRate = totals.connects ? Math.round((totals.booked / totals.connects) * 100) : 0
  const wonTotal = (closers ?? []).reduce((s, c) => s + c.won, 0)
  const funnel = [
    { label: 'Attempts', value: totals.attempts },
    { label: 'Connects', value: totals.connects },
    { label: 'Conversations', value: totals.conversations },
    { label: 'Booked', value: totals.booked },
    { label: 'Won', value: wonTotal },
  ]

  return (
    <div className="reveal">
      <PageHeader title="Performance" subtitle="Setter funnel from logged call outcomes." />

      <div className="mb-4 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)}
            className={cn('rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              range === r.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]')}>
            {r.label}
          </button>
        ))}
      </div>

      {!isLoading && !isError && rows.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Attempts" value={totals.attempts} />
          <StatCard label="Connects" value={totals.connects} />
          <StatCard label="Connect rate" value={`${connectRate}%`} />
          <StatCard label="Booking rate" value={`${bookingRate}%`} />
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Conversion funnel</h2>
          <div className="space-y-3">
            {funnel.map((s, i) => {
              const max = funnel[0].value || 1
              const prev = i > 0 ? funnel[i - 1].value : null
              const conv = prev ? Math.round((s.value / (prev || 1)) * 100) : null
              return (
                <div key={s.label}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="font-medium">{s.label}</span>
                    <span className="tabular-nums text-[var(--color-text-secondary)]">{s.value.toLocaleString()}{conv != null && <span className="ml-2 text-[12px] text-[var(--color-text-muted)]">{conv}% of prev</span>}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-signal)] transition-all" style={{ width: `${Math.round((s.value / max) * 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card>
        {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="No outcomes yet" message="Once setters start logging call outcomes, the funnel shows up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Setter</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Assigned</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Worked</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Attempts</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Connects</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Connect %</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Convos</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Booked</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Booking %</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Speed (h)</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rep_id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-5 py-3 font-medium">{r.name}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.assigned}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.worked}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.attempts}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.connects}</td>
                    <td className="px-3 py-3 tabular-nums font-medium">{r.connectRate}%</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.conversations}</td>
                    <td className="px-3 py-3 tabular-nums font-semibold text-[var(--color-primary)]">{r.booked}</td>
                    <td className="px-3 py-3 tabular-nums font-medium">{r.bookingRate}%</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.speedHrs || '—'}</td>
                    <td className={cn('px-3 py-3 tabular-nums', r.overdue ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-[var(--color-text-secondary)]')}>{r.overdue || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(closers?.length ?? 0) > 0 && (
        <Card className="mt-5">
          <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[15px] font-semibold">Closers</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Closer</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Won</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Proposals</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Close %</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Revenue</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Avg deal</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Pipeline</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Cycle (days)</th>
                </tr>
              </thead>
              <tbody>
                {(closers ?? []).map((c) => (
                  <tr key={c.rep_id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-5 py-3 font-medium">{c.name}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{c.won}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{c.proposals}</td>
                    <td className="px-3 py-3 tabular-nums font-medium">{c.closeRate}%</td>
                    <td className="px-3 py-3 tabular-nums font-semibold text-[var(--color-primary)]">${Math.round(c.revenue).toLocaleString()}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">${c.avgDeal.toLocaleString()}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">${Math.round(c.pipeline).toLocaleString()}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{c.cycleDays || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">Dials, talk time and recordings will populate automatically once CloudTalk is upgraded to Expert (API access).</p>
    </div>
  )
}
