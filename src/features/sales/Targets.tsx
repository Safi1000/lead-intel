import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Target } from 'lucide-react'
import { targetsApi, teamsApi, usersApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { blendedStatus, expectedByNow, monthPeriod, paceExpected, paceStatus, type PaceStatus } from './pace'
import { cn } from '../../lib/utils'
import type { Attainment, TargetRow } from '../../api/types'

const STATUS_COLOR: Record<PaceStatus, string> = { on_pace: 'bg-green-500', slipping: 'bg-amber-500', behind: 'bg-red-500' }
const currentPeriod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const todayISO = () => new Date().toISOString().slice(0, 10)

/** One metric's pace bar: fill = attained, ticker line = expected-by-now, colour = status. */
function PaceBar({ label, attained, expected, target, money }: { label: string; attained: number; expected: number; target: number; money?: boolean }) {
  const status = paceStatus(attained, expected)
  const pct = target > 0 ? Math.min(100, (attained / target) * 100) : 0
  const expPct = target > 0 ? Math.min(100, (expected / target) * 100) : 0
  const fmt = (n: number) => (money ? `$${Math.round(n).toLocaleString()}` : Math.round(n).toLocaleString())
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-[var(--color-text-secondary)]">{fmt(attained)} / {fmt(target)} <span className="text-[var(--color-text-muted)]">· expect {fmt(expected)}</span></span>
      </div>
      <div className="relative h-2.5 rounded-full bg-[var(--color-surface-2)]">
        <div className={cn('absolute inset-y-0 left-0 rounded-full', STATUS_COLOR[status])} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-[-2px] w-0.5 bg-[var(--color-text)]" style={{ left: `${expPct}%` }} title="Expected by today" />
      </div>
    </div>
  )
}

/** §8 blended targets — owner sets org revenue + closes; pace vs expected-by-now (holiday-aware). */
export function TargetsPage() {
  const qc = useQueryClient()
  const period = currentPeriod()
  const { data: targets, isLoading, isError, refetch } = useQuery({ queryKey: ['targets', period], queryFn: () => targetsApi.forPeriod(period) })
  const { data: att } = useQuery({ queryKey: ['attainment', period], queryFn: () => targetsApi.attainment(period) })
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list() })
  const { data: memberships } = useQuery({ queryKey: ['team-memberships'], queryFn: () => teamsApi.allMemberships() })

  const orgChanges = useMemo(() => (targets ?? []).filter((t) => t.level === 'org' && !t.owner_id), [targets])
  const orgTarget = orgChanges[orgChanges.length - 1]
  const { start, end } = monthPeriod(`${period}-01`)
  const expRev = orgChanges.length ? paceExpected(orgChanges.map((t) => ({ at: t.set_at, value: t.revenue_value })), start, end, todayISO()) : 0
  const expCloses = orgChanges.length ? paceExpected(orgChanges.map((t) => ({ at: t.set_at, value: t.closes_value })), start, end, todayISO()) : 0
  const orgAtt = att?.org ?? { closes: 0, revenue: 0 }
  const blended = blendedStatus(paceStatus(orgAtt.revenue, expRev), paceStatus(orgAtt.closes, expCloses))

  const [rev, setRev] = useState('')
  const [cl, setCl] = useState('')
  useEffect(() => { if (orgTarget) { setRev(String(orgTarget.revenue_value)); setCl(String(orgTarget.closes_value)) } }, [orgTarget])
  const save = useMutation({
    mutationFn: () => targetsApi.set('org', null, period, Number(rev) || 0, Number(cl) || 0),
    onSuccess: () => { toast.success('Target set'); qc.invalidateQueries({ queryKey: ['targets', period] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  // Cascade: latest target per owner, per-team attainment (sum of member closers), roll-up vs org.
  const closers = (users ?? []).filter((u) => u.role === 'closer')
  const latestByOwner = (level: TargetRow['level']) => {
    const map = new Map<string, TargetRow>()
    for (const t of (targets ?? []).filter((x) => x.level === level && x.owner_id)) map.set(t.owner_id as string, t)
    return map
  }
  const repTargets = latestByOwner('rep')
  const teamTargets = latestByOwner('team')
  const teamCloserIds = (teamId: string) => (memberships ?? []).filter((mm) => mm.team_id === teamId).map((mm) => mm.user_id)
  const teamAtt = (teamId: string): Attainment => teamCloserIds(teamId).reduce((a, id) => {
    const x = att?.byCloser[id]; if (x) { a.closes += x.closes; a.revenue += x.revenue } return a
  }, { closes: 0, revenue: 0 })
  const repSum = [...repTargets.values()].reduce((s, t) => ({ rev: s.rev + t.revenue_value, cl: s.cl + t.closes_value }), { rev: 0, cl: 0 })

  return (
    <div className="reveal max-w-3xl">
      <PageHeader title="Targets" subtitle={`Blended revenue + closes · ${period}`} />

      <Card className="mb-5 p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className={cn('h-3 w-3 rounded-full', STATUS_COLOR[blended])} />
          <h2 className="text-[15px] font-semibold">This month{orgTarget ? '' : ' — no target set'}</h2>
        </div>
        {orgTarget ? (
          <div className="space-y-4">
            <PaceBar label="Revenue" attained={orgAtt.revenue} expected={expRev} target={orgTarget.revenue_value} money />
            <PaceBar label="Closes" attained={orgAtt.closes} expected={expCloses} target={orgTarget.closes_value} />
            <p className="text-[12px] text-[var(--color-text-muted)]">Dot = worse of the two (a missed close count can't hide behind revenue). The tick marks expected-by-today, holiday-adjusted for US + Canada.</p>
          </div>
        ) : <p className="text-sm text-[var(--color-text-secondary)]">Set a monthly revenue + closes target below to start tracking pace.</p>}
      </Card>

      <Card className="mb-5 max-w-md p-5">
        <div className="mb-1 flex items-center gap-2"><Target className="h-5 w-5 text-[var(--color-primary)]" /><h2 className="text-[16px] font-semibold">Set org target</h2></div>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">Changing mid-month prorates forward — it won't penalise what's already banked.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="t-rev">Revenue (USD)</Label><Input id="t-rev" type="number" min={0} value={rev} onChange={(e) => setRev(e.target.value)} /></div>
          <div><Label htmlFor="t-cl">Closes</Label><Input id="t-cl" type="number" min={0} value={cl} onChange={(e) => setCl(e.target.value)} /></div>
        </div>
        <Button className="mt-3" loading={save.isPending} onClick={() => save.mutate()}>Save target</Button>
      </Card>

      {(teams?.length ?? 0) > 0 && (
        <Card className="mb-5">
          <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[15px] font-semibold">Team targets</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><CascadeHead first="Team" /></thead>
              <tbody>
                {(teams ?? []).map((t) => (
                  <TargetRowEditor key={t.id} level="team" ownerId={t.id} name={t.name} period={period} existing={teamTargets.get(t.id)} att={teamAtt(t.id)} monthStart={start} monthEnd={end} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">Closer targets</h2>
          {orgTarget && (
            <span className={cn('text-[12px] font-medium', repSum.cl === orgTarget.closes_value && repSum.rev === orgTarget.revenue_value ? 'text-[var(--color-text-muted)]' : 'text-amber-600')}>
              Split so far: ${Math.round(repSum.rev).toLocaleString()} / {repSum.cl} vs org ${Math.round(orgTarget.revenue_value).toLocaleString()} / {orgTarget.closes_value}
            </span>
          )}
        </div>
        {closers.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--color-text-muted)]">No closers in this organization yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><CascadeHead first="Closer" /></thead>
              <tbody>
                {closers.map((c) => (
                  <TargetRowEditor key={c.id} level="rep" ownerId={c.id} name={c.name} period={period} existing={repTargets.get(c.id)} att={att?.byCloser[c.id] ?? { closes: 0, revenue: 0 }} monthStart={start} monthEnd={end} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(users ?? []).some((u) => u.role === 'setter') && (
        <Card className="mt-5">
          <div className="border-b border-[var(--color-border)] px-5 py-3">
            <h2 className="text-[15px] font-semibold">Setter targets <span className="text-[12px] font-normal text-[var(--color-text-muted)]">— "closes" = booked meetings</span></h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><CascadeHead first="Setter" /></thead>
              <tbody>
                {(users ?? []).filter((u) => u.role === 'setter').map((s) => (
                  <TargetRowEditor key={s.id} level="rep" ownerId={s.id} name={s.name} period={period} existing={repTargets.get(s.id)} att={{ closes: att?.bySetter[s.id] ?? 0, revenue: 0 }} monthStart={start} monthEnd={end} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function CascadeHead({ first }: { first: string }) {
  return (
    <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
      <th className="px-4 py-2.5 font-medium">{first}</th>
      <th className="px-2 py-2.5 font-medium">Revenue $</th>
      <th className="px-2 py-2.5 font-medium">Closes</th>
      <th className="px-2 py-2.5 font-medium">Attained</th>
      <th className="px-2 py-2.5" />
    </tr>
  )
}

/** One cascade row: editable revenue+closes target for an owner (team/rep), with attainment + pace dot. */
function TargetRowEditor({ level, ownerId, name, period, existing, att, monthStart, monthEnd }: {
  level: 'team' | 'rep'; ownerId: string; name: string; period: string
  existing?: TargetRow; att: Attainment; monthStart: string; monthEnd: string
}) {
  const qc = useQueryClient()
  const [rev, setRev] = useState('')
  const [cl, setCl] = useState('')
  useEffect(() => { setRev(existing ? String(existing.revenue_value) : ''); setCl(existing ? String(existing.closes_value) : '') }, [existing?.id])
  const save = useMutation({
    mutationFn: () => targetsApi.set(level, ownerId, period, Number(rev) || 0, Number(cl) || 0),
    onSuccess: () => { toast.success('Target saved'); qc.invalidateQueries({ queryKey: ['targets', period] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const tgtCloses = existing?.closes_value ?? 0
  const expCloses = tgtCloses ? expectedByNow(tgtCloses, monthStart, monthEnd, new Date().toISOString().slice(0, 10)) : 0
  const status = paceStatus(att.closes, expCloses)
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="px-4 py-2">
        <span className="inline-flex items-center gap-2 font-medium">
          {existing && <span className={cn('h-2 w-2 rounded-full', STATUS_COLOR[status])} />}{name}
        </span>
      </td>
      <td className="px-2 py-2"><Input type="number" min={0} value={rev} onChange={(e) => setRev(e.target.value)} className="w-24" /></td>
      <td className="px-2 py-2"><Input type="number" min={0} value={cl} onChange={(e) => setCl(e.target.value)} className="w-20" /></td>
      <td className="px-2 py-2 whitespace-nowrap tabular-nums text-[13px] text-[var(--color-text-secondary)]">${Math.round(att.revenue).toLocaleString()} · {att.closes}</td>
      <td className="px-2 py-2"><Button size="sm" variant="outline" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></td>
    </tr>
  )
}
