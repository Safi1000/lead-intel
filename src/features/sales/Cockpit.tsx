import { useQuery } from '@tanstack/react-query'
import { kpisApi, targetsApi, teamsApi } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'
import { expectedByNow, monthPeriod, paceStatus, type PaceStatus } from './pace'
import { cn } from '../../lib/utils'

const COST_PER_LEAD = 0.02
const DOT: Record<PaceStatus, string> = { on_pace: 'bg-green-500', slipping: 'bg-amber-500', behind: 'bg-red-500' }
const periodOf = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }

/** Appendix A.1 Owner Cockpit — org funnel · spend/cost-per tiles · team cards with blended pace. */
export function CockpitPage() {
  const p = periodOf()
  const { data: funnel } = useQuery({ queryKey: ['setter-kpis', 'cockpit'], queryFn: () => kpisApi.setterFunnel(monthStart()) })
  const { data: att, isLoading } = useQuery({ queryKey: ['attainment', p], queryFn: () => targetsApi.attainment(p) })
  const { data: targets } = useQuery({ queryKey: ['targets', p], queryFn: () => targetsApi.forPeriod(p) })
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list() })
  const { data: memberships } = useQuery({ queryKey: ['team-memberships'], queryFn: () => teamsApi.allMemberships() })
  const { data: leadCount } = useQuery({ queryKey: ['org-lead-count'], queryFn: () => kpisApi.orgLeadCount() })
  if (isLoading) return <LoadingState />

  const totals = (funnel ?? []).reduce((a, r) => ({ attempts: a.attempts + r.attempts, connects: a.connects + r.connects, booked: a.booked + r.booked }), { attempts: 0, connects: 0, booked: 0 })
  const won = att?.org.closes ?? 0
  const revenue = att?.org.revenue ?? 0
  const spend = (leadCount ?? 0) * COST_PER_LEAD
  const { start, end } = monthPeriod(`${p}-01`)
  const asOf = new Date().toISOString().slice(0, 10)

  const teamCard = (teamId: string) => {
    const ids = (memberships ?? []).filter((m) => m.team_id === teamId).map((m) => m.user_id)
    let booked = 0, wonC = 0, rev = 0
    for (const id of ids) { booked += att?.bySetter[id] ?? 0; const c = att?.byCloser[id]; if (c) { wonC += c.closes; rev += c.revenue } }
    const tt = (targets ?? []).filter((t) => t.level === 'team' && t.owner_id === teamId).slice(-1)[0]
    const exp = tt?.closes_value ? expectedByNow(tt.closes_value, start, end, asOf) : 0
    return { booked, won: wonC, rev, status: paceStatus(wonC, exp), hasTarget: !!tt }
  }

  return (
    <div className="reveal">
      <PageHeader title="Owner Cockpit" subtitle="Org funnel, spend and team pace — this month." />
      <div className="stagger-in mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Attempts" value={totals.attempts} />
        <StatCard label="Connects" value={totals.connects} />
        <StatCard label="Booked" value={totals.booked} />
        <StatCard label="Closes (won)" value={won} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Revenue (MTD)" value={`$${Math.round(revenue).toLocaleString()}`} />
        <StatCard label="Est. spend" value={`$${Math.round(spend).toLocaleString()}`} />
        <StatCard label="Cost / booked" value={totals.booked ? `$${(spend / totals.booked).toFixed(2)}` : '—'} />
        <StatCard label="Cost / close" value={won ? `$${(spend / won).toFixed(2)}` : '—'} />
      </div>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Teams</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(teams ?? []).map((t) => {
          const c = teamCard(t.id)
          return (
            <Card key={t.id} className="p-4">
              <div className="mb-2 flex items-center gap-2">
                {c.hasTarget && <span className={cn('h-2.5 w-2.5 rounded-full', DOT[c.status])} />}
                <h3 className="text-[15px] font-semibold">{t.name}</h3>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-bold tabular-nums">{c.booked}</p><p className="text-[11px] text-[var(--color-text-muted)]">Booked</p></div>
                <div><p className="text-lg font-bold tabular-nums">{c.won}</p><p className="text-[11px] text-[var(--color-text-muted)]">Won</p></div>
                <div><p className="text-lg font-bold tabular-nums text-[var(--color-primary)]">${Math.round(c.rev / 1000)}k</p><p className="text-[11px] text-[var(--color-text-muted)]">Rev</p></div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
