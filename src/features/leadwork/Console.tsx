import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, PhoneMissed, UserX, type LucideIcon } from 'lucide-react'
import { floorConfigApi, kpisApi } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'
import { cn } from '../../lib/utils'

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }

function AlertTile({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: 'red' | 'amber' }) {
  const active = value > 0
  const box = !active ? 'border-[var(--color-border)]' : tone === 'red' ? 'border-red-300 bg-red-50/50' : 'border-amber-300 bg-amber-50/50'
  const ic = !active ? 'text-[var(--color-text-muted)]' : tone === 'red' ? 'text-red-600' : 'text-amber-600'
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

  if (isLoading || !alerts) return <LoadingState />

  const totals = (funnel ?? []).reduce((a, r) => ({ attempts: a.attempts + r.attempts, connects: a.connects + r.connects, booked: a.booked + r.booked }), { attempts: 0, connects: 0, booked: 0 })
  const links = [
    { to: '/performance', label: 'Performance' }, { to: '/targets', label: 'Targets' },
    { to: '/teams', label: 'Teams' }, { to: '/deals', label: 'Deals' }, { to: '/scripts', label: 'Scripts' },
  ]

  return (
    <div className="reveal">
      <PageHeader title="Manager Console" subtitle="Floor health at a glance." />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--color-border)] px-3 py-2 text-sm font-medium hover:bg-slate-50">
            {l.label}<ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}
