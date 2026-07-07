import { useQuery } from '@tanstack/react-query'
import { kpisApi, orgCreditsApi, targetsApi } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'

const COST_PER_LEAD = 0.02
// Estimated provider split of the blended per-lead cost (a live per-provider ledger needs engine hooks).
const PROVIDER_SPLIT = [
  { name: 'Google Places', pct: 0.4 },
  { name: 'DataForSEO (reviews + ads)', pct: 0.35 },
  { name: 'OpenAI (scoring)', pct: 0.25 },
]
const periodOf = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }

/** §13 Usage & credits — balance, spend, cost-per-lead/booking/close, provider split. */
export function CreditsPage() {
  const { data: credits } = useQuery({ queryKey: ['org-credits'], queryFn: () => orgCreditsApi.mine() })
  const { data: leadCount, isLoading } = useQuery({ queryKey: ['org-lead-count'], queryFn: () => kpisApi.orgLeadCount() })
  const { data: funnel } = useQuery({ queryKey: ['setter-kpis', 'credits'], queryFn: () => kpisApi.setterFunnel(monthStart()) })
  const { data: att } = useQuery({ queryKey: ['attainment', periodOf()], queryFn: () => targetsApi.attainment(periodOf()) })
  if (isLoading) return <LoadingState />

  const spend = (leadCount ?? 0) * COST_PER_LEAD
  const booked = (funnel ?? []).reduce((s, r) => s + r.booked, 0)
  const won = att?.org.closes ?? 0

  return (
    <div className="reveal">
      <PageHeader title="Usage & credits" subtitle="Spend and unit economics across delivered leads." />
      <div className="stagger-in mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Leads delivered" value={leadCount ?? 0} />
        <StatCard label="Est. spend" value={`$${Math.round(spend).toLocaleString()}`} />
        <StatCard label="Credits remaining" value={credits != null ? `$${Math.round(credits).toLocaleString()}` : '—'} />
        <StatCard label="Cost / lead" value={`$${COST_PER_LEAD.toFixed(2)}`} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="Cost / booked" value={booked ? `$${(spend / booked).toFixed(2)}` : '—'} />
        <StatCard label="Cost / close" value={won ? `$${(spend / won).toFixed(2)}` : '—'} />
        <StatCard label="Bookings (MTD)" value={booked} />
      </div>
      <Card>
        <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[15px] font-semibold">Estimated spend by provider</h2></div>
        <div className="divide-y divide-[var(--color-border)]">
          {PROVIDER_SPLIT.map((p) => (
            <div key={p.name} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="tabular-nums text-[var(--color-text-secondary)]">${Math.round(spend * p.pct).toLocaleString()} <span className="text-[12px] text-[var(--color-text-muted)]">· {Math.round(p.pct * 100)}%</span></span>
            </div>
          ))}
        </div>
      </Card>
      <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">Spend estimated at ~${COST_PER_LEAD.toFixed(2)}/delivered lead. A live per-provider credit ledger requires engine-side hooks.</p>
    </div>
  )
}
