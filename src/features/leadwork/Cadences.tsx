import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { GitBranch, Plus, Trash2, X } from 'lucide-react'
import { cadencesApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { LEAD_STAGES } from '../../api/types'
import type { Cadence, CadenceAction, CadenceStep } from '../../api/types'

const ACTIONS: { value: CadenceAction; label: string }[] = [
  { value: 'task', label: 'Call / task' },
  { value: 'email', label: 'Send email' },
  { value: 'move', label: 'Move stage' },
]
// Move a lead to one of the user-facing stages (never back to 'New').
const MOVE_STATES = LEAD_STAGES.filter((s) => s !== 'New')

export function CadencesPage() {
  const qc = useQueryClient()
  const { data: cadences, isLoading, isError, refetch } = useQuery({ queryKey: ['cadences'], queryFn: () => cadencesApi.list() })
  const [editing, setEditing] = useState<Cadence | null>(null)
  const [newName, setNewName] = useState('')
  const create = useMutation({ mutationFn: () => cadencesApi.create(newName.trim()), onSuccess: (c) => { setNewName(''); qc.invalidateQueries({ queryKey: ['cadences'] }); setEditing(c) }, onError: (e) => toast.error(normalizeError(e).message) })
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => cadencesApi.update(id, { active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['cadences'] }) })
  const remove = useMutation({ mutationFn: (id: string) => cadencesApi.remove(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cadences'] }); setEditing(null) }, onError: (e) => toast.error(normalizeError(e).message) })

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  return (
    <div className="reveal space-y-5">
      {editing ? (
        <CadenceEditor cadence={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['cadences'] }) }} />
      ) : (
        <>
          <Card className="p-5">
            <Label htmlFor="cad-name">New sequence</Label>
            <div className="flex gap-2">
              <Input id="cad-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Warm med-spa · 5 touch" className="max-w-xs" />
              <Button disabled={!newName.trim()} loading={create.isPending} onClick={() => create.mutate()}><Plus className="h-4 w-4" /> Create</Button>
            </div>
          </Card>
          {(cadences?.length ?? 0) === 0 ? (
            <EmptyState icon={GitBranch} title="No sequences yet" message="Create one above, then add its steps." />
          ) : (cadences ?? []).map((c) => (
            <Card key={c.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-[12px] text-[var(--color-text-muted)]">{c.active ? 'Active' : 'Paused'}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: c.id, active: !c.active })}>{c.active ? 'Pause' : 'Activate'}</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(c)}>Edit steps</Button>
                <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => remove.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}

function CadenceEditor({ cadence, onClose }: { cadence: Cadence; onClose: () => void }) {
  const { data: initial } = useQuery({ queryKey: ['cadence-steps', cadence.id], queryFn: () => cadencesApi.steps(cadence.id) })
  const [steps, setSteps] = useState<CadenceStep[] | null>(null)
  useEffect(() => { if (steps === null && initial) setSteps(initial) }, [initial, steps])
  const current = steps ?? initial ?? []
  const update = (i: number, patch: Partial<CadenceStep>) => setSteps(current.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const save = useMutation({ mutationFn: () => cadencesApi.setSteps(cadence.id, current), onSuccess: () => { toast.success('Sequence saved'); onClose() }, onError: (e) => toast.error(normalizeError(e).message) })

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">{cadence.name} — steps</h2>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      {current.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No steps yet — add the first touch below.</p>}
      {current.map((s, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-[10px] border border-[var(--color-border)] p-3">
          <div>
            <Label className="text-[12px]">Day</Label>
            <Input type="number" min={0} value={s.day_offset} onChange={(e) => update(i, { day_offset: Number(e.target.value) || 0 })} className="w-16" />
          </div>
          <div>
            <Label className="text-[12px]">Action</Label>
            <select value={s.action} onChange={(e) => update(i, { action: e.target.value as CadenceAction })} className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
              {ACTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </div>
          {s.action === 'move' ? (
            <div>
              <Label className="text-[12px]">Move to</Label>
              <select value={s.target_state ?? ''} onChange={(e) => update(i, { target_state: e.target.value })} className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
                <option value="">Select…</option>
                {MOVE_STATES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          ) : (
            <div className="min-w-[160px] flex-1">
              <Label className="text-[12px]">Note</Label>
              <Input value={s.note ?? ''} onChange={(e) => update(i, { note: e.target.value })} placeholder="What to do / say" />
            </div>
          )}
          <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setSteps(current.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setSteps([...current, { step_order: current.length + 1, day_offset: current.length ? current[current.length - 1].day_offset + 2 : 0, action: 'task', script_id: null, note: '', target_state: null }])}><Plus className="h-4 w-4" /> Add step</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save sequence</Button>
      </div>
    </Card>
  )
}
