import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, CheckCircle2, Search, Shuffle, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { assignmentApi, floorConfigApi, leadBatchesApi, manualLeadsApi, progressApi, usersApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuth, useDebounce } from '../../hooks'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import { StageSelect, FollowUpCell } from './controls'
import { canWorkLeads, isManagerRole } from './workflow'
import { LeadDrawer } from './LeadDrawer'
import { DISPOSITION_TIER1, DISPOSITION_TIER2 } from '../../api/types'
import type { LeadStage, ManualLead, ManagedUser, Paginated } from '../../api/types'

/** Shift-time elapsed (ms) inside the PKT calling window 19:00–02:00 (= 14:00–21:00 UTC daily). */
function shiftMsBetween(a: number, b: number): number {
  if (b <= a) return 0
  let total = 0
  const day = new Date(a); day.setUTCHours(0, 0, 0, 0)
  for (let t = day.getTime(); t < b; t += 86_400_000) {
    const ws = t + 14 * 3_600_000, we = t + 21 * 3_600_000
    total += Math.max(0, Math.min(b, we) - Math.max(a, ws))
  }
  return total
}
/** First-touch SLA breach: assigned, never dialled, still active, past the org's SLA window (shift-time). */
function isSlaBreach(l: ManualLead, slaMs: number): boolean {
  if (!l.assigned_at || l.first_touch_at) return false
  if (l.lifecycle_state !== 'Assigned' && l.lifecycle_state !== 'In Progress') return false
  return shiftMsBetween(new Date(l.assigned_at).getTime(), Date.now()) > slaMs
}

interface Tab { key: string; label: string; filter: (l: ManualLead) => boolean }

function tabsFor(role: string | null): Tab[] {
  if (role === 'setter') {
    return [
      { key: 'all', label: 'My leads', filter: () => true },
      { key: 'booked', label: 'Booked', filter: (l) => l.stage === 'Booked' },
      { key: 'notnow', label: 'Not Now', filter: (l) => l.stage === 'Not Now' },
    ]
  }
  if (role === 'closer') {
    return [
      { key: 'tocall', label: 'To call', filter: (l) => l.stage === 'Booked' },
      { key: 'won', label: 'Won', filter: (l) => l.stage === 'Won' },
      { key: 'lost', label: 'Lost', filter: (l) => l.stage === 'Lost' },
      { key: 'all', label: 'All', filter: () => true },
    ]
  }
  return [
    { key: 'all', label: 'All', filter: () => true },
    { key: 'unassigned', label: 'Unassigned', filter: (l) => !l.setter_id },
    { key: 'assigned', label: 'Assigned', filter: (l) => !!l.setter_id },
    { key: 'booked', label: 'Booked', filter: (l) => l.stage === 'Booked' },
    { key: 'won', label: 'Won', filter: (l) => l.stage === 'Won' },
    { key: 'lost', label: 'Lost', filter: (l) => l.stage === 'Lost' },
  ]
}

export function LeadQueuePage() {
  const { batchId } = useParams()
  const qc = useQueryClient()
  const { role, user } = useAuth()
  const isManager = isManagerRole(role)
  const canEdit = canWorkLeads(role)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manual-leads', batchId ?? 'all'],
    queryFn: () => manualLeadsApi.list(batchId ? { batch_id: batchId } : undefined),
  })
  const { data: batch } = useQuery({
    queryKey: ['lead-batch', batchId],
    queryFn: () => leadBatchesApi.get(batchId as string),
    enabled: !!batchId,
  })
  const { data: floor } = useQuery({ queryKey: ['floor-config'], queryFn: floorConfigApi.get })
  const slaMs = (floor?.sla_hours ?? 4) * 3_600_000
  const orgSetters = useOrgMembers('setter')
  // §6 round-robin: distribute this batch's unassigned leads evenly across setters, respecting WIP caps.
  const roundRobin = useMutation({
    mutationFn: async () => {
      if (!batchId || orgSetters.length === 0) throw new Error('No setters to round-robin to.')
      const loads = await floorConfigApi.setterLoads()
      const cap = floor?.wip_cap ?? 40
      let remaining = batch?.unassigned_count ?? 0
      if (remaining === 0) throw new Error('No unassigned leads in this batch.')
      const share = Math.ceil(remaining / orgSetters.length)
      let total = 0
      for (const s of orgSetters) {
        if (remaining <= 0) break
        const room = Math.max(0, cap - (loads[s.id] ?? 0))
        const n = Math.min(share, room, remaining)
        if (n > 0) { const got = await assignmentApi.assignLeadsToSetter(batchId, s.id, n); total += got; remaining -= got }
      }
      return total
    },
    onSuccess: (n) => { toast.success(`Round-robin: assigned ${n} lead${n === 1 ? '' : 's'} across the team`); qc.invalidateQueries() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const isSetter = role === 'setter'
  const { data: goal = 0 } = useQuery({ queryKey: ['daily-goal'], queryFn: progressApi.getGoal, enabled: isSetter })
  const periods = useMemo(() => {
    const now = new Date(); const wd = (now.getDay() + 6) % 7
    return {
      day: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
      week: new Date(now.getFullYear(), now.getMonth(), now.getDate() - wd).toISOString(),
      month: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    }
  }, [])
  const { data: myCounts } = useQuery({ queryKey: ['my-counts', periods.day], queryFn: () => progressApi.myCounts(periods), enabled: isSetter })
  const todayDone = myCounts?.today ?? 0

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof manualLeadsApi.update>[1] }) => manualLeadsApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manual-leads'] })
      qc.invalidateQueries({ queryKey: ['lead-batch', batchId] })
      qc.invalidateQueries({ queryKey: ['lead-batches'] })
      qc.invalidateQueries({ queryKey: ['due-today'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const doneM = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => manualLeadsApi.markDone(id, done),
    // Optimistic: flip the row instantly, reconcile in the background.
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: ['manual-leads'] })
      const snapshots = qc.getQueriesData<Paginated<ManualLead>>({ queryKey: ['manual-leads'] })
      const stamp = done ? new Date().toISOString() : null
      for (const [key, val] of snapshots) {
        if (!val) continue
        qc.setQueryData(key, { ...val, data: val.data.map((l) => (l.id === id ? { ...l, done_at: stamp } : l)) })
      }
      return { snapshots }
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshots?.forEach(([key, val]) => qc.setQueryData(key, val))
      toast.error(normalizeError(e).message)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['manual-leads'] })
      qc.invalidateQueries({ queryKey: ['my-progress'] })
      qc.invalidateQueries({ queryKey: ['setter-progress'] })
    },
  })

  const tabs = useMemo(() => tabsFor(role), [role])
  const [tab, setTab] = useState(tabs[0]?.key ?? 'all')
  const [searchRaw, setSearchRaw] = useState('')
  const search = useDebounce(searchRaw, 200).toLowerCase()
  const [assignSetterOpen, setAssignSetterOpen] = useState(false)
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignSetterId, setAssignSetterId] = useState('')
  const bulkAssign = useMutation({
    mutationFn: () => assignmentApi.assignLeadIdsToSetter(assignSetterId, [...selected]),
    onSuccess: (n) => {
      toast.success(`Assigned ${n} of ${selected.size} lead${selected.size === 1 ? '' : 's'}${n < selected.size ? ' — the rest hit the setter’s WIP cap' : ''}`)
      setSelected(new Set()); setAssignSetterId(''); qc.invalidateQueries()
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const bulkUnassign = useMutation({
    mutationFn: (ids: string[]) => manualLeadsApi.unassignMany(ids),
    onSuccess: ({ unassigned, locked }) => {
      if (unassigned > 0) toast.success(`Unassigned ${unassigned} lead${unassigned === 1 ? '' : 's'}${locked > 0 ? ` — ${locked} skipped (Done leads stay with their setter)` : ''}`)
      else toast.info('Nothing unassigned — Done leads stay with their setter forever.')
      setSelected(new Set()); qc.invalidateQueries()
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const [setterFilter, setSetterFilter] = useState('all')
  const [closerFilter, setCloserFilter] = useState('all')
  const [attemptsFilter, setAttemptsFilter] = useState('all')
  const [dueFilter, setDueFilter] = useState('all')
  const [doneFilter, setDoneFilter] = useState('all')
  const [hideDnc, setHideDnc] = useState(false)
  const [scoreMin, setScoreMin] = useState('')
  const [tier1Filter, setTier1Filter] = useState('all')
  const [tier2Filter, setTier2Filter] = useState('all')

  const activeTab = tabs.find((t) => t.key === tab) ?? tabs[0]
  const leads = data?.data ?? []
  const overdue = useMemo(() => leads.filter((l) => isSlaBreach(l, slaMs)).length, [leads, slaMs])

  // Distinct setters/closers present in this batch, for the filter dropdowns.
  const setterNames = useMemo(() => [...new Set(leads.map((l) => l.setter).filter((n): n is string => !!n))].sort(), [leads])
  const closerNames = useMemo(() => [...new Set(leads.map((l) => l.closer).filter((n): n is string => !!n))].sort(), [leads])

  const filtered = useMemo(() => leads.filter((l) => {
    // Hard guarantee: a setter/closer only ever sees leads that belong to them, whatever the source
    // returned (RLS already enforces this server-side; this holds against stale/mock paths too).
    if (role === 'setter' && l.setter_id !== user?.id) return false
    if (role === 'closer' && l.closer_id !== user?.id) return false
    if (activeTab && !activeTab.filter(l)) return false
    if (setterFilter !== 'all' && l.setter !== (setterFilter === 'none' ? null : setterFilter)) return false
    if (closerFilter !== 'all' && l.closer !== (closerFilter === 'none' ? null : closerFilter)) return false
    if (hideDnc && l.dnc) return false
    if (attemptsFilter !== 'all') {
      const a = l.attempt_count
      if (attemptsFilter === '0' && a !== 0) return false
      if (attemptsFilter === '12' && (a < 1 || a > 2)) return false
      if (attemptsFilter === '3' && a < 3) return false
    }
    if (dueFilter !== 'all') {
      const today = new Date().toISOString().slice(0, 10)
      if (!l.next_follow_up) return false
      if (dueFilter === 'overdue' && !(l.next_follow_up < today)) return false
      if (dueFilter === 'today' && l.next_follow_up !== today) return false
      if (dueFilter === 'week') { const wk = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10); if (!(l.next_follow_up >= today && l.next_follow_up <= wk)) return false }
    }
    if (doneFilter !== 'all') {
      const isDone = !!l.done_at
      if (doneFilter === 'done' && !isDone) return false
      if (doneFilter === 'notdone' && isDone) return false
    }
    if (scoreMin) { if (Number(l.data['Quality Score'] ?? 0) < Number(scoreMin)) return false }
    if (tier1Filter !== 'all' && l.last_tier1 !== tier1Filter) return false
    if (tier2Filter !== 'all' && l.last_tier2 !== tier2Filter) return false
    if (search) {
      const hay = (l.display_name + ' ' + Object.values(l.data).join(' ')).toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  }), [leads, role, user?.id, activeTab, search, setterFilter, closerFilter, attemptsFilter, dueFilter, hideDnc, scoreMin, tier1Filter, tier2Filter, doneFilter])

  // Manager selects leads (typically Booked) to hand to a closer.
  const selectable = isManager && (tab === 'booked' || tab === 'assigned' || tab === 'unassigned')
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allShownSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id))
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s)
    if (allShownSelected) filtered.forEach((l) => n.delete(l.id))
    else filtered.forEach((l) => n.add(l.id))
    return n
  })

  return (
    <div className="reveal">
      {batchId && (
        <Link to="/leads" className="mb-4 inline-flex items-center gap-1 text-[13px] text-[var(--color-primary)] hover:underline">
          <ArrowLeft className="h-4 w-4" /> All batches
        </Link>
      )}
      <PageHeader
        title={batch ? batch.file_name : 'Leads'}
        subtitle={batch ? `${batch.template_name} · ${batch.lead_count} lead${batch.lead_count === 1 ? '' : 's'}` : 'Leads assigned to you.'}
        actions={isManager && batchId ? (
          <div className="flex gap-2">
            <Button variant="outline" loading={roundRobin.isPending} onClick={() => roundRobin.mutate()}><Shuffle className="h-4 w-4" /> Round-robin</Button>
            <Button onClick={() => setAssignSetterOpen(true)}><UserPlus className="h-4 w-4" /> Assign to setter</Button>
          </div>
        ) : undefined}
      />

      {isManager && batch && (
        <div className="mb-4 flex flex-wrap gap-2 text-[12px] text-[var(--color-text-muted)]">
          <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 font-medium">{batch.unassigned_count} unassigned</span>
          <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 font-medium">{batch.assigned_count} assigned</span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-400">{batch.booked_count} booked</span>
          <span className="rounded-full bg-green-500/10 px-2.5 py-1 font-medium text-green-700 dark:text-green-400">{batch.won_count} won</span>
          <span className="rounded-full bg-red-500/10 px-2.5 py-1 font-medium text-red-600 dark:text-red-400">{batch.lost_count} lost</span>
        </div>
      )}

      {isManager && batchId && <BatchAccess batchId={batchId} />}

      {isManager && overdue > 0 && (
        <div className="mb-3 rounded-[10px] border border-red-200 bg-red-500/10 px-4 py-2.5 text-[13px] font-medium text-red-700 dark:text-red-400">
          {overdue} lead{overdue === 1 ? '' : 's'} past the first-touch SLA — being auto-recycled to the pool.
        </div>
      )}

      {isSetter && goal > 0 && (
        <div className={cn('mb-3 rounded-[10px] border px-4 py-2.5 text-[13px] font-medium',
          todayDone >= goal ? 'border-green-200 bg-green-500/10 text-green-700 dark:text-green-400' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}>
          Today: {todayDone}/{goal} leads worked {todayDone >= goal ? '· goal met 🎉' : `· ${Math.round((todayDone / goal) * 100)}% of today's target`}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => {
          const count = leads.filter(t.filter).length
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setSelected(new Set()) }}
              className={cn('rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]')}>
              {t.label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 sm:min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <Input value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder="Search leads…" className="pl-9" />
        </div>
        <select value={attemptsFilter} onChange={(e) => setAttemptsFilter(e.target.value)} aria-label="Filter by attempts" className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
          <option value="all">Any attempts</option><option value="0">0 attempts</option><option value="12">1–2</option><option value="3">3+</option>
        </select>
        <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} aria-label="Filter by follow-up" className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
          <option value="all">Any follow-up</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">This week</option>
        </select>
        <select value={doneFilter} onChange={(e) => setDoneFilter(e.target.value)} aria-label="Filter by done status" className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
          <option value="all">Any status</option><option value="done">Marked done</option><option value="notdone">Not done</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-secondary)]"><input type="checkbox" checked={hideDnc} onChange={(e) => setHideDnc(e.target.checked)} className="h-4 w-4 rounded border-[var(--color-border)]" /> Hide DNC</label>
        <Input type="number" min={0} value={scoreMin} onChange={(e) => setScoreMin(e.target.value)} placeholder="Min score" aria-label="Minimum quality score" className="h-9 w-28" />
        <select value={tier1Filter} onChange={(e) => setTier1Filter(e.target.value)} aria-label="Connection outcome" className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
          <option value="all">Any T1</option>{DISPOSITION_TIER1.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={tier2Filter} onChange={(e) => setTier2Filter(e.target.value)} aria-label="Contact outcome" className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
          <option value="all">Any T2</option>{DISPOSITION_TIER2.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {isManager && (
          <>
            <select value={setterFilter} onChange={(e) => setSetterFilter(e.target.value)} aria-label="Filter by setter"
              className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
              <option value="all">All setters</option>
              <option value="none">Unassigned</option>
              {setterNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={closerFilter} onChange={(e) => setCloserFilter(e.target.value)} aria-label="Filter by closer"
              className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
              <option value="all">All closers</option>
              <option value="none">No closer</option>
              {closerNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {(setterFilter !== 'all' || closerFilter !== 'all') && (
              <button onClick={() => { setSetterFilter('all'); setCloserFilter('all') }} className="text-[13px] text-[var(--color-primary)] hover:underline">Clear</button>
            )}
          </>
        )}
      </div>

      {selectable && selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-[10px] border border-[var(--color-primary)] bg-blue-50/50 px-4 py-2.5 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            {tab === 'unassigned' ? (
              <>
                <select value={assignSetterId} onChange={(e) => setAssignSetterId(e.target.value)} aria-label="Assign selected to setter" className="h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[13px]">
                  <option value="">Assign to…</option>
                  {orgSetters.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <Button size="sm" disabled={!assignSetterId} loading={bulkAssign.isPending} onClick={() => bulkAssign.mutate()}><UserPlus className="h-3.5 w-3.5" /> Assign {selected.size}</Button>
              </>
            ) : (
              <Button size="sm" variant="danger" loading={bulkUnassign.isPending} onClick={() => bulkUnassign.mutate([...selected])}><UserMinus className="h-3.5 w-3.5" /> Unassign</Button>
            )}
            <button onClick={() => setSelected(new Set())} className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <Card>
        {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No leads here" message={leads.length === 0 ? 'No leads are assigned to you in this batch yet.' : 'No leads match this view.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  {selectable && <th className="px-4 py-2.5"><input type="checkbox" className="h-4 w-4 rounded border-[var(--color-border)]" checked={allShownSelected} onChange={toggleAll} aria-label="Select all" /></th>}
                  <th className="px-5 py-2.5 font-medium">Lead</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Follow-up</th>
                  <th className="px-3 py-2.5 font-medium">Done</th>
                  {isManager && <th className="px-3 py-2.5 font-medium">Setter</th>}
                  {isManager && <th className="px-3 py-2.5 font-medium">Closer</th>}
                  <th className="px-3 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <LeadRow key={l.id} lead={l} role={role} isManager={isManager} canEdit={canEdit} slaMs={slaMs} onOpen={setDrawerLeadId}
                    selectable={selectable} checked={selected.has(l.id)} onToggle={() => toggle(l.id)}
                    onStage={(stage) => patch.mutate({ id: l.id, body: { stage } })}
                    onFollowUp={(date) => patch.mutate({ id: l.id, body: { next_follow_up: date } })}
                    onDone={(done) => doneM.mutate({ id: l.id, done })} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {assignSetterOpen && batchId && batch && (
        <AssignToSetterDialog batchId={batchId} unassigned={batch.unassigned_count} onClose={() => setAssignSetterOpen(false)} onDone={() => { setAssignSetterOpen(false); qc.invalidateQueries() }} />
      )}

      <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
    </div>
  )
}

function LeadRow({ lead: l, role, isManager, canEdit, slaMs, onOpen, selectable, checked, onToggle, onStage, onFollowUp, onDone }: {
  lead: ManualLead; role: string | null; isManager: boolean; canEdit: boolean; slaMs: number; onOpen: (id: string) => void
  selectable: boolean; checked: boolean; onToggle: () => void
  onStage: (s: LeadStage) => void; onFollowUp: (d: string | null) => void; onDone: (done: boolean) => void
}) {
  return (
    <tr className={cn('border-b border-[var(--color-border)] last:border-0', l.done_at ? 'bg-green-500/10 hover:bg-green-500/15' : 'hover:bg-[var(--color-surface-2)]')}>
      {selectable && <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4 rounded border-[var(--color-border)]" checked={checked} onChange={onToggle} aria-label="Select lead" /></td>}
      <td className="px-5 py-3">
        <button type="button" onClick={() => onOpen(l.id)} className="text-left font-medium text-[var(--color-text)] hover:text-[var(--color-primary)]">{l.display_name}</button>
        {isSlaBreach(l, slaMs) && <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">SLA</span>}
      </td>
      <td className="px-3 py-3"><StageSelect stage={l.stage} role={role} disabled={!canEdit} onChange={onStage} /></td>
      <td className="px-3 py-3"><FollowUpCell value={l.next_follow_up} disabled={!canEdit} onChange={onFollowUp} /></td>
      <td className="px-3 py-3">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onDone(!l.done_at)}
          title={l.done_at ? 'Done — click to reopen' : 'Mark as done'}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors disabled:opacity-40',
            l.done_at
              ? 'border-green-200 bg-green-500/10 text-green-700 dark:text-green-400'
              : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> {l.done_at ? 'Done' : 'Mark'}
        </button>
      </td>
      {isManager && <td className="px-3 py-3 text-[13px] text-[var(--color-text-secondary)]">{l.setter ?? '—'}</td>}
      {isManager && <td className="px-3 py-3 text-[13px] text-[var(--color-text-secondary)]">{l.closer ?? '—'}</td>}
      <td className="px-3 py-3 text-[13px] text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(l.updated_at), { addSuffix: true })}</td>
    </tr>
  )
}

function BatchAccess({ batchId }: { batchId: string }) {
  const qc = useQueryClient()
  const { data: assignments } = useQuery({ queryKey: ['batch-assignments', batchId], queryFn: () => assignmentApi.listForBatch(batchId) })
  const { data: usersList } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  const nameFor = (id: string) => usersList?.find((u) => u.id === id)?.name ?? 'User'
  const revoke = useMutation({
    mutationFn: (userId: string) => assignmentApi.unassignBatch(batchId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['batch-assignments', batchId] }),
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const list = assignments ?? []
  if (list.length === 0) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-[var(--color-text-muted)]">Access:</span>
      {list.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] py-1 pl-2.5 pr-1 text-[12px]">
          <span className="font-medium">{nameFor(a.user_id)}</span>
          <span className="text-[var(--color-text-muted)]">{a.role}</span>
          <button onClick={() => revoke.mutate(a.user_id)} className="rounded-full p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)]" aria-label="Revoke"><X className="h-3 w-3" /></button>
        </span>
      ))}
    </div>
  )
}

function useOrgMembers(role: 'setter' | 'closer'): ManagedUser[] {
  const { data } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  return (data ?? []).filter((u) => u.role === role && u.status === 'active')
}

function AssignToSetterDialog({ batchId, unassigned, onClose, onDone }: { batchId: string; unassigned: number; onClose: () => void; onDone: () => void }) {
  const setters = useOrgMembers('setter')
  const [setterId, setSetterId] = useState('')
  const [count, setCount] = useState(Math.min(50, unassigned))
  const { data: floor } = useQuery({ queryKey: ['floor-config'], queryFn: floorConfigApi.get })
  const { data: loads } = useQuery({ queryKey: ['setter-loads'], queryFn: floorConfigApi.setterLoads })

  // WIP cap: a setter can only receive up to (cap − their current active load) more leads.
  const cap = floor?.wip_cap ?? 40
  const currentLoad = setterId ? (loads?.[setterId] ?? 0) : 0
  const room = Math.max(0, cap - currentLoad)
  const maxAssign = Math.min(unassigned, room)
  const clamped = Math.max(0, Math.min(count, maxAssign))

  const assign = useMutation({
    mutationFn: () => assignmentApi.assignLeadsToSetter(batchId, setterId, clamped),
    onSuccess: (n) => { toast.success(`Assigned ${n} lead${n === 1 ? '' : 's'} at random`); onDone() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Assign leads to a setter" description="A random selection of currently-unassigned leads will be given to the setter.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="as-setter">Setter</Label>
          <select id="as-setter" value={setterId} onChange={(e) => { setSetterId(e.target.value); setCount(Math.min(50, unassigned)) }} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            <option value="">Select a setter…</option>
            {setters.map((u) => <option key={u.id} value={u.id}>{u.name}{loads ? ` — ${loads[u.id] ?? 0}/${cap} active` : ''}</option>)}
          </select>
          {setters.length === 0 && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">No setters in this organization yet — add one in Users.</p>}
        </div>
        {setterId && (
          <p className={cn('text-[12px]', room === 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-[var(--color-text-muted)]')}>
            {room === 0 ? `At WIP cap (${currentLoad}/${cap}) — dispose active leads before assigning more.` : `Holding ${currentLoad}/${cap} active — room for ${room} more.`}
          </p>
        )}
        <div>
          <Label htmlFor="as-count">Number of leads (max {maxAssign})</Label>
          <Input id="as-count" type="number" min={1} max={maxAssign} value={clamped} onChange={(e) => setCount(Math.max(1, Math.min(maxAssign, Number(e.target.value) || 0)))} disabled={maxAssign === 0} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={assign.isPending} disabled={!setterId || clamped < 1 || maxAssign === 0} onClick={() => assign.mutate()}>Assign {clamped} randomly</Button>
        </div>
      </div>
    </Dialog>
  )
}

