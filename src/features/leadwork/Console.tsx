import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { Activity, AlertTriangle, ArrowRight, Layers, PhoneMissed, UserX, type LucideIcon } from 'lucide-react'
import { activityFeedApi, floorConfigApi, kpisApi, leadBatchesApi } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'
import { cn } from '../../lib/utils'

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }
const twoDaysAgo = () => new Date(Date.now() - 2 * 86_400_000).toISOString()

function AlertTile({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: 'red' | 'amber' }) {
  const active = value > 0
  const box = !active ? 'border-[var(--color-border)]' : tone === 'red' ? 'border-red-300 bg-red-500/10' : 'border-amber-300 bg-amber-500/10'
  const ic = !active ? 'text-[var(--color-text-muted)]' : tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
  return (
    <Card className={cn('border p-4', box)}>
      <div className="mb-1 flex items-center gap-2"><Icon className={cn('h-4 w-4', ic)} /><span className="text-[13px] font-medium text-[var(--color-text-secondary)]">{label}</span></div>
      <p className={cn('text-2xl font-bold tabular-nums', active && ic)}>{value}</p>
    </Card>
  )
}

/** §10/§14 Manager Console — floor-health alert tiles + this-month funnel + quick links. */
export function ConsolePage() {
  const { data: floor } = useQuery({ queryKey: ['floor-config'], queryFn: floorConfigApi.get })
  const { data: alerts, isLoading } = useQuery({ queryKey: ['floor-alerts', floor?.sla_hours], queryFn: () => kpisApi.floorAlerts(floor?.sla_hours ?? 4), enabled: !!floor })
  const { data: funnel } = useQuery({ queryKey: ['setter-kpis', 'console-mtd'], queryFn: () => kpisApi.setterFunnel(monthStart()) })
  const { data: batches } = useQuery({ queryKey: ['lead-batches'], queryFn: leadBatchesApi.list })
  const { data: feed } = useQuery({ queryKey: ['activity-feed', 'console'], queryFn: () => activityFeedApi.list(twoDaysAgo()) })

  if (isLoading || !alerts) return <LoadingState />

  const totals = (funnel ?? []).reduce((a, r) => ({ attempts: a.attempts + r.attempts, connects: a.connects + r.connects, booked: a.booked + r.booked }), { attempts: 0, connects: 0, booked: 0 })
  const activeBatches = (batches ?? []).filter((b) => !b.archived_at && b.lead_count > 0)
  const burn = activeBatches.reduce((a, b) => ({ total: a.total + b.lead_count, worked: a.worked + (b.lead_count - b.new_count) }), { total: 0, worked: 0 })
  const burnPct = burn.total ? Math.round((burn.worked / burn.total) * 100) : 0
  const links = [
    { to: '/performance', label: 'Performance' }, { to: '/targets', label: 'Targets' },
    { to: '/teams', label: 'Teams' }, { to: '/deals', label: 'Deals' }, { to: '/scripts', label: 'Scripts' },
  ]

  return (
    <div className="reveal">
      <PageHeader title="Manager Console" subtitle="Floor health at a glance." />
      <div className="stagger-in mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AlertTile icon={AlertTriangle} label="SLA breaches" value={alerts.slaBreaches} tone="red" />
        <AlertTile icon={PhoneMissed} label="Overdue callbacks" value={alerts.overdueCallbacks} tone="amber" />
        <AlertTile icon={UserX} label="Idle reps (30m+)" value={alerts.idleReps} tone="amber" />
      </div>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">This month</h2>
      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Attempts" value={totals.attempts} />
        <StatCard label="Connects" value={totals.connects} />
        <StatCard label="Booked" value={totals.booked} />
      </div>

      {(funnel?.length ?? 0) > 0 && (
        <Card className="mb-6">
          <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[15px] font-semibold">Setter leaderboard</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Setter</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Connect %</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Booked</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Worked / Assigned</th>
                  <th className="px-3 py-2.5 font-medium tabular-nums">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {(funnel ?? []).slice(0, 8).map((r) => (
                  <tr key={r.rep_id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-5 py-3 font-medium">{r.name}</td>
                    <td className="px-3 py-3 tabular-nums font-medium">{r.connectRate}%</td>
                    <td className="px-3 py-3 tabular-nums font-semibold text-[var(--color-primary)]">{r.booked}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.worked}/{r.assigned}</td>
                    <td className={cn('px-3 py-3 tabular-nums', r.overdue ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-[var(--color-text-secondary)]')}>{r.overdue || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2"><Layers className="h-4 w-4 text-[var(--color-primary)]" /><h2 className="text-[15px] font-semibold">Batch burn-down</h2></div>
          {activeBatches.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No active batches.</p>
          ) : (
            <>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-[var(--color-text-secondary)]">{burn.worked.toLocaleString()} / {burn.total.toLocaleString()} worked</span>
                <span className="font-semibold tabular-nums">{burnPct}%</span>
              </div>
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-signal)]" style={{ width: `${burnPct}%` }} />
              </div>
              <div className="space-y-2">
                {activeBatches.slice(0, 4).map((b) => {
                  const w = b.lead_count - b.new_count
                  const p = b.lead_count ? Math.round((w / b.lead_count) * 100) : 0
                  return (
                    <div key={b.id}>
                      <div className="flex items-center justify-between text-[12px]"><span className="truncate text-[var(--color-text-secondary)]">{b.file_name}</span><span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">{w}/{b.lead_count}</span></div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]"><div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${p}%` }} /></div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2"><Activity className="h-4 w-4 text-[var(--color-primary)]" /><h2 className="text-[15px] font-semibold">Live activity</h2></div>
          {(feed?.length ?? 0) === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No activity in the last 48 hours.</p>
          ) : (
            <div className="space-y-2.5">
              {(feed ?? []).slice(0, 7).map((f) => (
                <div key={f.id} className="flex items-start justify-between gap-3 text-[13px]">
                  <p className="min-w-0 truncate"><span className="font-medium">{f.author ?? 'Someone'}</span> <span className="text-[var(--color-text-secondary)]">{f.type.toLowerCase()}</span> <span className="text-[var(--color-text-muted)]">· {f.lead_name}</span></p>
                  <span className="shrink-0 text-[12px] text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(f.at), { addSuffix: true })}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--color-border)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface-2)]">
            {l.label}<ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}
