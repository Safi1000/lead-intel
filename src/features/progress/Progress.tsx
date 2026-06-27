import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDaysInMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { Target } from 'lucide-react'
import { progressApi, type DoneCounts, type Periods, type SetterDoneStat } from '../../api/endpoints'
import { useAuth } from '../../hooks'
import { Card } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'

interface PeriodInfo extends Periods { daysInMonth: number }

function usePeriods(): PeriodInfo {
  return useMemo(() => {
    const now = new Date()
    return {
      day: startOfDay(now).toISOString(),
      week: startOfWeek(now, { weekStartsOn: 1 }).toISOString(),
      month: startOfMonth(now).toISOString(),
      daysInMonth: getDaysInMonth(now),
    }
  }, [])
}

function targetsFor(goal: number, p: PeriodInfo) {
  return { today: goal, week: goal * 7, month: goal * p.daysInMonth }
}

/** A count vs target with a progress bar. */
function GoalCard({ label, count, target }: { label: string; count: number; target: number }) {
  const pct = target > 0 ? Math.min(1, count / target) : 0
  const met = target > 0 && count >= target
  return (
    <Card className="p-5">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 flex items-end gap-1">
        <span className="text-[28px] font-bold tabular-nums leading-none text-[var(--color-text)]">{count}</span>
        {target > 0 && <span className="mb-0.5 text-sm text-[var(--color-text-muted)]">/ {target}</span>}
      </div>
      {target > 0 ? (
        <>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className={cn('h-full rounded-full transition-all', met ? 'bg-[var(--c-verified)]' : 'bg-[var(--color-primary)]')} style={{ width: `${pct * 100}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{met ? 'Goal met 🎉' : `${Math.round(pct * 100)}% of goal`}</p>
        </>
      ) : (
        <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">No daily goal set</p>
      )}
    </Card>
  )
}

/** A setter sees only their own counts. */
function MyProgress({ periods, goal }: { periods: PeriodInfo; goal: number }) {
  const { data, isLoading, isError, refetch } = useQuery<DoneCounts>({
    queryKey: ['my-progress', periods.day],
    queryFn: () => progressApi.myCounts(periods),
  })
  if (isLoading) return <LoadingState />
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />
  const t = targetsFor(goal, periods)
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <GoalCard label="Today" count={data.today} target={t.today} />
      <GoalCard label="This week" count={data.week} target={t.week} />
      <GoalCard label="This month" count={data.month} target={t.month} />
    </div>
  )
}

function StatCell({ count, target }: { count: number; target: number }) {
  const pct = target > 0 ? Math.min(1, count / target) : 0
  const met = target > 0 && count >= target
  return (
    <td className="px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="w-14 tabular-nums text-[var(--color-text)]">{count}{target > 0 && <span className="text-[var(--color-text-muted)]"> / {target}</span>}</span>
        {target > 0 && (
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
            <span className={cn('block h-full rounded-full', met ? 'bg-[var(--c-verified)]' : 'bg-[var(--color-primary)]')} style={{ width: `${pct * 100}%` }} />
          </span>
        )}
      </div>
    </td>
  )
}

/** Manager / SA see every setter's counts. */
function OverseerProgress({ periods, goal }: { periods: PeriodInfo; goal: number }) {
  const { data, isLoading, isError, refetch } = useQuery<SetterDoneStat[]>({
    queryKey: ['setter-progress', periods.day],
    queryFn: () => progressApi.setterStats(periods),
  })
  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />
  const rows = data ?? []
  const t = targetsFor(goal, periods)
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
        <span className="text-[15px] font-semibold">Setters</span>
        <span className="text-[13px] text-[var(--color-text-secondary)]">Daily goal: {goal > 0 ? `${goal} leads/day` : 'not set'}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Target} title="No setters yet" message="Add users with the setter role to track their throughput here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
                <th className="px-5 py-2.5 font-medium">Setter</th>
                <th className="px-3 py-2.5 font-medium">Today</th>
                <th className="px-3 py-2.5 font-medium">This week</th>
                <th className="px-3 py-2.5 font-medium">This month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-[var(--color-text)]">{r.name}</td>
                  <StatCell count={r.today} target={t.today} />
                  <StatCell count={r.week} target={t.week} />
                  <StatCell count={r.month} target={t.month} />
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
  const periods = usePeriods()
  const goal = useQuery({ queryKey: ['daily-goal'], queryFn: progressApi.getGoal }).data ?? 0

  return (
    <div className="reveal">
      <PageHeader
        title={isOverseer ? 'Setter progress' : 'My progress'}
        subtitle={isOverseer ? 'Leads processed (marked done) by each setter — daily, weekly, monthly.' : 'Leads you’ve marked done against the daily goal.'}
      />
      {isOverseer ? <OverseerProgress periods={periods} goal={goal} /> : <MyProgress periods={periods} goal={goal} />}
    </div>
  )
}
