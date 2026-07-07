import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { portalApi } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'

/** §Surface 2 client portal — read-only results for the external customer. RLS scopes to their org. */
export function PortalPage() {
  const { data, isLoading } = useQuery({ queryKey: ['portal'], queryFn: () => portalApi.summary() })
  if (isLoading || !data) return <LoadingState />

  return (
    <div className="reveal">
      <PageHeader title="Your results" subtitle="Leads delivered and booked for your business." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Leads delivered" value={data.delivered} />
        <StatCard label="Meetings booked" value={data.booked} />
        <StatCard label="Deals won" value={data.won} />
        <StatCard label="Revenue" value={`$${Math.round(data.revenue).toLocaleString()}`} />
      </div>
      <Card>
        <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[15px] font-semibold">Recent leads</h2></div>
        {data.recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--color-text-muted)]">No leads delivered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Business</th>
                  <th className="px-3 py-2.5 font-medium">City</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((l) => (
                  <tr key={l.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-5 py-3 font-medium">{l.name}</td>
                    <td className="px-3 py-3 text-[var(--color-text-secondary)]">{l.city || '—'}</td>
                    <td className="px-3 py-3">
                      {l.booked
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[12px] font-medium text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" /> Booked</span>
                        : <span className="text-[12px] text-[var(--color-text-muted)]">Delivered</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
