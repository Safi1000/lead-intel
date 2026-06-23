import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Search, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { assignmentApi, leadBatchesApi, manualLeadsApi, usersApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuth, useDebounce } from '../../hooks'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import { STATUS_META, TEMP_META, isManagerRole } from './workflow'
import type { ManualLead, ManagedUser } from '../../api/types'

interface Tab {
  key: string
  label: string
  filter: (l: ManualLead) => boolean
}

function tabsFor(role: string | null): Tab[] {
  if (role === 'setter') {
    return [
      { key: 'all', label: 'My leads', filter: () => true },
      { key: 'warm', label: 'Warm', filter: (l) => l.temperature === 'warm' },
      { key: 'cold', label: 'Cold', filter: (l) => l.temperature === 'cold' },
    ]
  }
  if (role === 'closer') {
    return [
      { key: 'to_take', label: 'To take', filter: (l) => l.status === 'with_closer' },
      { key: 'working', label: 'Working', filter: (l) => l.status === 'open' },
      { key: 'closed', label: 'Closed', filter: (l) => l.status === 'closed' },
      { key: 'all', label: 'All', filter: () => true },
    ]
  }
  // manager / SA / generator
  return [
    { key: 'all', label: 'All', filter: () => true },
    { key: 'unassigned', label: 'Unassigned', filter: (l) => !l.setter_id },
    { key: 'assigned', label: 'Assigned', filter: (l) => !!l.setter_id },
    { key: 'warm', label: 'Warm', filter: (l) => l.temperature === 'warm' },
    { key: 'cold', label: 'Cold', filter: (l) => l.temperature === 'cold' },
    { key: 'closed', label: 'Closed', filter: (l) => l.status === 'closed' },
  ]
}

export function LeadQueuePage() {
  const { batchId } = useParams()
  const qc = useQueryClient()
  const { role } = useAuth()
  const isManager = isManagerRole(role)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manual-leads', batchId ?? 'all'],
    queryFn: () => manualLeadsApi.list(batchId ? { batch_id: batchId } : undefined),
  })
  const { data: batch } = useQuery({
    queryKey: ['lead-batch', batchId],
    queryFn: () => leadBatchesApi.get(batchId as string),
    enabled: !!batchId,
  })

  const tabs = useMemo(() => tabsFor(role), [role])
  const [tab, setTab] = useState(tabs[0]?.key ?? 'all')
  const [searchRaw, setSearchRaw] = useState('')
  const search = useDebounce(searchRaw, 200).toLowerCase()
  const [assignSetterOpen, setAssignSetterOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignCloserFor, setAssignCloserFor] = useState<string[] | null>(null)

  const activeTab = tabs.find((t) => t.key === tab) ?? tabs[0]
  const leads = data?.data ?? []

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (activeTab && !activeTab.filter(l)) return false
      if (search) {
        const hay = (l.display_name + ' ' + Object.values(l.data).join(' ')).toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })
  }, [leads, activeTab, search])

  // Manager may select leads (for closer assignment) on the warm/unassigned views.
  const selectable = isManager && (tab === 'warm' || tab === 'unassigned' || tab === 'assigned')
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
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
          <Button onClick={() => setAssignSetterOpen(true)}><UserPlus className="h-4 w-4" /> Assign to setter</Button>
        ) : undefined}
      />

      {isManager && batch && (
        <div className="mb-4 flex flex-wrap gap-2 text-[12px] text-[var(--color-text-muted)]">
          <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 font-medium">{batch.unassigned_count} unassigned</span>
          <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 font-medium">{batch.assigned_count} assigned</span>
          <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-600">{batch.warm} warm</span>
          <span className="rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">{batch.closed_count} closed</span>
        </div>
      )}

      {isManager && batchId && <BatchAccess batchId={batchId} />}

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => {
          const count = leads.filter(t.filter).length
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelected(new Set()) }}
              className={cn(
                'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-slate-100',
              )}
            >
              {t.label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder="Search leads…" className="pl-9" />
      </div>

      {/* Selection action bar (manager assigning warm/selected leads to a closer) */}
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
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No leads here" message={leads.length === 0 ? 'No leads are assigned to you in this batch yet.' : 'No leads match this view.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  {selectable && (
                    <th className="px-4 py-2.5"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={allShownSelected} onChange={toggleAll} aria-label="Select all" /></th>
                  )}
                  <th className="px-5 py-2.5 font-medium">Lead</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Temp</th>
                  {isManager && <th className="px-3 py-2.5 font-medium">Setter</th>}
                  {isManager && <th className="px-3 py-2.5 font-medium">Closer</th>}
                  <th className="px-3 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <LeadRow key={l.id} lead={l} isManager={isManager} selectable={selectable} checked={selected.has(l.id)} onToggle={() => toggle(l.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {assignSetterOpen && batchId && batch && (
        <AssignToSetterDialog
          batchId={batchId}
          unassigned={batch.unassigned_count}
          onClose={() => setAssignSetterOpen(false)}
          onDone={() => { setAssignSetterOpen(false); qc.invalidateQueries() }}
        />
      )}
      {assignCloserFor && batchId && (
        <AssignToCloserDialog
          batchId={batchId}
          leadIds={assignCloserFor}
          onClose={() => setAssignCloserFor(null)}
          onDone={() => { setAssignCloserFor(null); setSelected(new Set()); qc.invalidateQueries() }}
        />
      )}
    </div>
  )
}

function LeadRow({ lead: l, isManager, selectable, checked, onToggle }: { lead: ManualLead; isManager: boolean; selectable: boolean; checked: boolean; onToggle: () => void }) {
  const st = STATUS_META[l.status]
  const temp = l.temperature ? TEMP_META[l.temperature] : null
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
      {selectable && (
        <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={checked} onChange={onToggle} aria-label="Select lead" /></td>
      )}
      <td className="px-5 py-3">
        <Link to={`/leads/manual/${l.id}`} className="font-medium text-[var(--color-text)] hover:text-[var(--color-primary)]">{l.display_name}</Link>
      </td>
      <td className="px-3 py-3"><span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium', st.className)}>{st.label}</span></td>
      <td className="px-3 py-3">
        {temp ? (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium', temp.className)}><temp.icon className="h-3 w-3" /> {temp.label}</span>
        ) : <span className="text-[var(--color-text-muted)]">—</span>}
      </td>
      {isManager && <td className="px-3 py-3 text-[13px] text-[var(--color-text-secondary)]">{l.setter ?? '—'}</td>}
      {isManager && <td className="px-3 py-3 text-[13px] text-[var(--color-text-secondary)]">{l.closer ?? '—'}</td>}
      <td className="px-3 py-3 text-[13px] text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(l.updated_at), { addSuffix: true })}</td>
    </tr>
  )
}

/** Manager-only: who can see this batch, with revoke. */
function BatchAccess({ batchId }: { batchId: string }) {
  const qc = useQueryClient()
  const { data: assignments } = useQuery({ queryKey: ['batch-assignments', batchId], queryFn: () => assignmentApi.listForBatch(batchId) })
  const { data: usersList } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  const nameFor = (id: string) => usersList?.find((u) => u.id === id)?.name ?? 'User'
  const revoke = useMutation({
    mutationFn: (userId: string) => assignmentApi.unassignBatch(batchId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['batch-assignments', batchId] }) },
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
