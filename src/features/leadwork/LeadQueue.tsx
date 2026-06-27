import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, CheckCircle2, Search, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { assignmentApi, leadBatchesApi, manualLeadsApi, usersApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuth, useDebounce } from '../../hooks'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import { StageSelect, FollowUpCell } from './controls'
import { canWorkLeads, isManagerRole } from './workflow'
import type { LeadStage, ManualLead, ManagedUser, Paginated } from '../../api/types'

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
  const { role } = useAuth()
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignCloserFor, setAssignCloserFor] = useState<string[] | null>(null)
  const [setterFilter, setSetterFilter] = useState('all')
  const [closerFilter, setCloserFilter] = useState('all')

  const activeTab = tabs.find((t) => t.key === tab) ?? tabs[0]
  const leads = data?.data ?? []

  // Distinct setters/closers present in this batch, for the filter dropdowns.
  const setterNames = useMemo(() => [...new Set(leads.map((l) => l.setter).filter((n): n is string => !!n))].sort(), [leads])
  const closerNames = useMemo(() => [...new Set(leads.map((l) => l.closer).filter((n): n is string => !!n))].sort(), [leads])

  const filtered = useMemo(() => leads.filter((l) => {
    if (activeTab && !activeTab.filter(l)) return false
    if (setterFilter !== 'all' && l.setter !== (setterFilter === 'none' ? null : setterFilter)) return false
    if (closerFilter !== 'all' && l.closer !== (closerFilter === 'none' ? null : closerFilter)) return false
    if (search) {
      const hay = (l.display_name + ' ' + Object.values(l.data).join(' ')).toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  }), [leads, activeTab, search, setterFilter, closerFilter])

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
        actions={isManager && batchId ? <Button onClick={() => setAssignSetterOpen(true)}><UserPlus className="h-4 w-4" /> Assign to setter</Button> : undefined}
      />

      {isManager && batch && (
        <div className="mb-4 flex flex-wrap gap-2 text-[12px] text-[var(--color-text-muted)]">
          <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 font-medium">{batch.unassigned_count} unassigned</span>
          <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 font-medium">{batch.assigned_count} assigned</span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">{batch.booked_count} booked</span>
          <span className="rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">{batch.won_count} won</span>
          <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-600">{batch.lost_count} lost</span>
        </div>
      )}

      {isManager && batchId && <BatchAccess batchId={batchId} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => {
          const count = leads.filter(t.filter).length
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setSelected(new Set()) }}
              className={cn('rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-slate-100')}>
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
            <Button size="sm" onClick={() => setAssignCloserFor([...selected])}><UserPlus className="h-3.5 w-3.5" /> Assign to closer</Button>
            <button onClick={() => setSelected(new Set())} className="rounded p-1 text-[var(--color-text-muted)] hover:bg-slate-100"><X className="h-4 w-4" /></button>
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
                  {selectable && <th className="px-4 py-2.5"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={allShownSelected} onChange={toggleAll} aria-label="Select all" /></th>}
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
                  <LeadRow key={l.id} lead={l} role={role} isManager={isManager} canEdit={canEdit}
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
      {assignCloserFor && batchId && (
        <AssignToCloserDialog batchId={batchId} leadIds={assignCloserFor} onClose={() => setAssignCloserFor(null)} onDone={() => { setAssignCloserFor(null); setSelected(new Set()); qc.invalidateQueries() }} />
      )}
    </div>
  )
}

function LeadRow({ lead: l, role, isManager, canEdit, selectable, checked, onToggle, onStage, onFollowUp, onDone }: {
  lead: ManualLead; role: string | null; isManager: boolean; canEdit: boolean
  selectable: boolean; checked: boolean; onToggle: () => void
  onStage: (s: LeadStage) => void; onFollowUp: (d: string | null) => void; onDone: (done: boolean) => void
}) {
  return (
    <tr className={cn('border-b border-[var(--color-border)] last:border-0', l.done_at ? 'bg-green-50 hover:bg-green-100' : 'hover:bg-slate-50')}>
      {selectable && <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={checked} onChange={onToggle} aria-label="Select lead" /></td>}
      <td className="px-5 py-3">
        <Link to={`/leads/manual/${l.id}`} className="font-medium text-[var(--color-text)] hover:text-[var(--color-primary)]">{l.display_name}</Link>
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
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-slate-50',
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
          <button onClick={() => revoke.mutate(a.user_id)} className="rounded-full p-0.5 text-[var(--color-text-muted)] hover:bg-slate-200" aria-label="Revoke"><X className="h-3 w-3" /></button>
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
  const assign = useMutation({
    mutationFn: () => assignmentApi.assignLeadsToSetter(batchId, setterId, count),
    onSuccess: (n) => { toast.success(`Assigned ${n} lead${n === 1 ? '' : 's'} at random`); onDone() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Assign leads to a setter" description="A random selection of currently-unassigned leads will be given to the setter.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="as-setter">Setter</Label>
          <select id="as-setter" value={setterId} onChange={(e) => setSetterId(e.target.value)} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            <option value="">Select a setter…</option>
            {setters.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {setters.length === 0 && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">No setters in this organization yet — add one in Users.</p>}
        </div>
        <div>
          <Label htmlFor="as-count">Number of leads (max {unassigned} unassigned)</Label>
          <Input id="as-count" type="number" min={1} max={unassigned} value={count} onChange={(e) => setCount(Math.max(1, Math.min(unassigned, Number(e.target.value) || 0)))} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={assign.isPending} disabled={!setterId || count < 1 || unassigned === 0} onClick={() => assign.mutate()}>Assign {count} randomly</Button>
        </div>
      </div>
    </Dialog>
  )
}

function AssignToCloserDialog({ batchId, leadIds, onClose, onDone }: { batchId: string; leadIds: string[]; onClose: () => void; onDone: () => void }) {
  const closers = useOrgMembers('closer')
  const [closerId, setCloserId] = useState('')
  const assign = useMutation({
    mutationFn: () => assignmentApi.assignLeadsToCloser(batchId, closerId, leadIds),
    onSuccess: (n) => { toast.success(`Assigned ${n} lead${n === 1 ? '' : 's'} to closer`); onDone() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Assign ${leadIds.length} lead${leadIds.length === 1 ? '' : 's'} to a closer`} description="The selected leads become visible to the closer and move into their queue.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="ac-closer">Closer</Label>
          <select id="ac-closer" value={closerId} onChange={(e) => setCloserId(e.target.value)} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            <option value="">Select a closer…</option>
            {closers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {closers.length === 0 && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">No closers in this organization yet — add one in Users.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={assign.isPending} disabled={!closerId} onClick={() => assign.mutate()}>Assign to closer</Button>
        </div>
      </div>
    </Dialog>
  )
}
