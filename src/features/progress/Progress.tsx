import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Target } from 'lucide-react'
import { monthStartISO, progressApi, type SetterDoneStat } from '../../api/endpoints'
import { useAuth } from '../../hooks'
import { Card } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { cn } from '../../lib/utils'

/** Goals are monthly. Nothing here tracks a day or a week — one target, one bar,
 *  measured from the 1st of the current month. */
function useMonth() {
  return useMemo(() => {
    const start = monthStartISO()
    return { start, label: format(new Date(start), 'MMMM yyyy') }
  }, [])
}

/** A count vs the monthly target with a progress bar. */
function GoalCard({ label, count, target }: { label: string; count: number; target: number }) {
  const pct = target > 0 ? Math.min(1, count / target) : 0
  const met = target > 0 && count >= target
  return (
    <Card className="max-w-md p-5">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 flex items-end gap-1">
        <span className="text-[28px] font-bold tabular-nums leading-none text-[var(--color-text)]">{count}</span>
        {target > 0 && <span className="mb-0.5 text-sm text-[var(--color-text-muted)]">/ {target}</span>}
      </div>
      {target > 0 ? (
        <>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
            <div className={cn('h-full rounded-full transition-all', met ? 'bg-[var(--c-verified)]' : 'bg-[var(--color-primary)]')} style={{ width: `${pct * 100}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{met ? 'Goal met 🎉' : `${Math.round(pct * 100)}% of goal`}</p>
        </>
      ) : (
        <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">No monthly goal set</p>
      )}
    </Card>
  )
}

/** A setter sees only their own count. */
function MyProgress({ monthStart, monthLabel, goal }: { monthStart: string; monthLabel: string; goal: number }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-progress', monthStart],
    queryFn: () => progressApi.myMonthCount(monthStart),
  })
  if (isLoading) return <LoadingState />
  if (isError || data == null) return <ErrorState onRetry={() => refetch()} />
  return <GoalCard label={monthLabel} count={data} target={goal} />
}

function StatCell({ count, target }: { count: number; target: number }) {
  const pct = target > 0 ? Math.min(1, count / target) : 0
  const met = target > 0 && count >= target
  return (
    <td className="px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="w-20 tabular-nums text-[var(--color-text)]">{count}{target > 0 && <span className="text-[var(--color-text-muted)]"> / {target}</span>}</span>
        {target > 0 && (
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-border)]">
            <span className={cn('block h-full rounded-full', met ? 'bg-[var(--c-verified)]' : 'bg-[var(--color-primary)]')} style={{ width: `${pct * 100}%` }} />
          </span>
        )}
      </div>
    </td>
  )
}

/** Manager / SA see every setter's month-to-date count. */
function OverseerProgress({ monthStart, monthLabel, goal }: { monthStart: string; monthLabel: string; goal: number }) {
  const { data, isLoading, isError, refetch } = useQuery<SetterDoneStat[]>({
    queryKey: ['setter-progress', monthStart],
    queryFn: () => progressApi.setterStats(monthStart),
  })
  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />
  const rows = data ?? []
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
        <span className="text-[15px] font-semibold">Setters — {monthLabel}</span>
        <span className="text-[13px] text-[var(--color-text-secondary)]">Monthly goal: {goal > 0 ? `${goal} leads` : 'not set'}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Target} title="No setters yet" message="Add users with the setter role to track their throughput here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
                <th className="px-5 py-2.5 font-medium">Setter</th>
                <th className="px-3 py-2.5 font-medium">This month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                  <td className="px-5 py-3 font-medium text-[var(--color-text)]">{r.name}</td>
                  <StatCell count={r.month} target={goal} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function ProgressPage() {
  const { role } = useAuth()
  const isOverseer = role === 'manager' || role === 'superadmin' || role === 'admin'
  const { start, label } = useMonth()
  const goal = useQuery({ queryKey: ['monthly-goal'], queryFn: progressApi.getGoal }).data ?? 0

  return (
    <div className="reveal">
      {isOverseer
        ? <OverseerProgress monthStart={start} monthLabel={label} goal={goal} />
        : <MyProgress monthStart={start} monthLabel={label} goal={goal} />}
    </div>
  )
}
