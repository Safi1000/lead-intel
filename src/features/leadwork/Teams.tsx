import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, UserMinus, Users, X } from 'lucide-react'
import { manualLeadsApi, teamsApi, usersApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import type { Team } from '../../api/types'

export function TeamsPage() {
  const qc = useQueryClient()
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['teams'] }); qc.invalidateQueries({ queryKey: ['team-memberships'] }) }
  const { data: teams, isLoading, isError, refetch } = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list() })
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  const { data: memberships } = useQuery({ queryKey: ['team-memberships'], queryFn: () => teamsApi.allMemberships() })

  const [newName, setNewName] = useState('')
  const create = useMutation({
    mutationFn: () => teamsApi.create(newName.trim()),
    onSuccess: () => { toast.success('Team created'); setNewName(''); invalidate() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const [deleteFor, setDeleteFor] = useState<Team | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => teamsApi.remove(id),
    onSuccess: () => { toast.success('Team deleted'); setDeleteFor(null); invalidate() },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  const managers = (users ?? []).filter((u) => u.role === 'manager')
  const assignable = (users ?? []).filter((u) => u.role === 'setter' || u.role === 'closer' || u.role === 'manager')

  return (
    <div className="reveal max-w-4xl space-y-5">
      <PageHeader title="Teams" subtitle="Organise reps into teams. Managers see their teams' leads; assignment and targets cascade down." />

      <Card className="p-5">
        <Label htmlFor="team-name">New team</Label>
        <div className="flex items-center gap-2">
          <Input id="team-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. West Coast" className="max-w-xs" />
          <Button loading={create.isPending} disabled={!newName.trim()} onClick={() => create.mutate()}><Plus className="h-4 w-4" /> Create</Button>
        </div>
      </Card>

      {(teams?.length ?? 0) === 0 ? (
        <EmptyState icon={Users} title="No teams yet" message="Create a team above to start organising reps." />
      ) : (teams ?? []).map((t) => (
        <TeamCard key={t.id} team={t} managers={managers} assignable={assignable}
          members={(memberships ?? []).filter((m) => m.team_id === t.id)} allUsers={users ?? []}
          onChanged={invalidate} onDelete={() => setDeleteFor(t)} />
      ))}

      <OffboardCard reps={assignable} onDone={invalidate} />

      <ConfirmDialog open={!!deleteFor} onOpenChange={(v) => { if (!v) setDeleteFor(null) }}
        title="Delete this team?" message={deleteFor ? `"${deleteFor.name}" will be removed. Its leads lose their team assignment (they stay in the org pool) and members are unlinked.` : ''}
        confirmLabel="Delete team" destructive loading={remove.isPending} onConfirm={() => deleteFor && remove.mutate(deleteFor.id)} />
    </div>
  )
}

function TeamCard({ team, managers, assignable, members, allUsers, onChanged, onDelete }: {
  team: Team
  managers: Array<{ id: string; name: string }>
  assignable: Array<{ id: string; name: string; role: string }>
  members: Array<{ user_id: string; role_in_team: string }>
  allUsers: Array<{ id: string; name: string }>
  onChanged: () => void
  onDelete: () => void
}) {
  const nameFor = (id: string) => allUsers.find((u) => u.id === id)?.name ?? 'User'
  const setMgr = useMutation({ mutationFn: (mid: string | null) => teamsApi.update(team.id, { manager_id: mid }), onSuccess: onChanged, onError: (e) => toast.error(normalizeError(e).message) })
  const addM = useMutation({ mutationFn: ({ uid, role }: { uid: string; role: 'setter' | 'closer' | 'manager' }) => teamsApi.addMember(team.id, uid, role), onSuccess: onChanged, onError: (e) => toast.error(normalizeError(e).message) })
  const rmM = useMutation({ mutationFn: (uid: string) => teamsApi.removeMember(team.id, uid), onSuccess: onChanged, onError: (e) => toast.error(normalizeError(e).message) })
  const [addId, setAddId] = useState('')
  const memberIds = new Set(members.map((m) => m.user_id))
  const canAdd = assignable.filter((u) => !memberIds.has(u.id))

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold">{team.name}</h2>
        <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <Label className="text-[13px]">Manager</Label>
        <select value={team.manager_id ?? ''} onChange={(e) => setMgr.mutate(e.target.value || null)}
          className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
          <option value="">— none —</option>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Members ({members.length})</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {members.length === 0 && <span className="text-[13px] text-[var(--color-text-muted)]">No members yet.</span>}
          {members.map((m) => (
            <span key={m.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] py-1 pl-2.5 pr-1 text-[12px]">
              <span className="font-medium">{nameFor(m.user_id)}</span>
              <span className="text-[var(--color-text-muted)]">{m.role_in_team}</span>
              <button onClick={() => rmM.mutate(m.user_id)} className="rounded-full p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)]" aria-label="Remove"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select value={addId} onChange={(e) => setAddId(e.target.value)} className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            <option value="">Add member…</option>
            {canAdd.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!addId} loading={addM.isPending}
            onClick={() => { const u = canAdd.find((x) => x.id === addId); if (u) addM.mutate({ uid: u.id, role: (u.role === 'closer' ? 'closer' : u.role === 'manager' ? 'manager' : 'setter') }); setAddId('') }}>Add</Button>
        </div>
      </div>
    </Card>
  )
}

/** §15 rep offboarding — bulk-move a departing rep's active leads to another rep or the pool. */
function OffboardCard({ reps, onDone }: { reps: Array<{ id: string; name: string; role: string }>; onDone: () => void }) {
  const qc = useQueryClient()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const run = useMutation({
    mutationFn: () => manualLeadsApi.reassignFrom(fromId, toId || null, 'setter'),
    onSuccess: (n) => { toast.success(`Reassigned ${n} active lead${n === 1 ? '' : 's'}`); qc.invalidateQueries({ queryKey: ['manual-leads'] }); onDone() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2"><UserMinus className="h-5 w-5 text-[var(--color-primary)]" /><h2 className="text-[16px] font-semibold">Offboard / reassign a rep</h2></div>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">Move a departing setter's active (not-done) leads to someone else, or back to the pool. Done leads stay put.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="off-from">From</Label>
          <select id="off-from" value={fromId} onChange={(e) => setFromId(e.target.value)} className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            <option value="">Select rep…</option>
            {reps.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="off-to">To</Label>
          <select id="off-to" value={toId} onChange={(e) => setToId(e.target.value)} className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            <option value="">— back to pool —</option>
            {reps.filter((u) => u.id !== fromId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <Button variant="danger" disabled={!fromId} loading={run.isPending} onClick={() => run.mutate()}>Reassign</Button>
      </div>
    </Card>
  )
}
