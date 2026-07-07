import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Mail, Phone, Plus, Trash2 } from 'lucide-react'
import { scriptsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuth } from '../../hooks'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import type { Script } from '../../api/types'

const BLANK = { kind: 'call' as 'call' | 'email', name: '', body: '' }

export function ScriptsPage() {
  const { role } = useAuth()
  const canEdit = role === 'manager' || role === 'superadmin' || role === 'admin'
  const qc = useQueryClient()
  const { data: scripts, isLoading, isError, refetch } = useQuery({ queryKey: ['scripts'], queryFn: () => scriptsApi.list() })

  const [editing, setEditing] = useState<null | { id?: string; kind: 'call' | 'email'; name: string; body: string }>(null)
  const [deleteFor, setDeleteFor] = useState<Script | null>(null)
  const save = useMutation({
    mutationFn: () => scriptsApi.save(editing!),
    onSuccess: () => { toast.success('Saved'); setEditing(null); qc.invalidateQueries({ queryKey: ['scripts'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => scriptsApi.remove(id),
    onSuccess: () => { toast.success('Deleted'); setDeleteFor(null); qc.invalidateQueries({ queryKey: ['scripts'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  return (
    <div className="reveal max-w-3xl space-y-5">
      <PageHeader title="Scripts & templates" subtitle="Call scripts and email templates the floor can reference." />
      {canEdit && !editing && <Button onClick={() => setEditing({ ...BLANK })}><Plus className="h-4 w-4" /> New template</Button>}

      {editing && (
        <Card className="space-y-3 p-5">
          <div className="flex gap-2">
            {(['call', 'email'] as const).map((k) => (
              <button key={k} onClick={() => setEditing({ ...editing, kind: k })}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ${editing.kind === k ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)]'}`}>
                {k === 'call' ? <Phone className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}{k === 'call' ? 'Call script' : 'Email'}
              </button>
            ))}
          </div>
          <div>
            <Label htmlFor="s-name">Name</Label>
            <Input id="s-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Opener — booking a slot" />
          </div>
          <div>
            <Label htmlFor="s-body">Body</Label>
            <textarea id="s-body" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={8}
              className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm" placeholder="Write the script or template…" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={save.isPending} disabled={!editing.name.trim()} onClick={() => save.mutate()}>Save</Button>
          </div>
        </Card>
      )}

      {(scripts?.length ?? 0) === 0 && !editing ? (
        <EmptyState icon={Phone} title="No templates yet" message={canEdit ? 'Create a call script or email template above.' : 'Your manager hasn’t added any yet.'} />
      ) : (scripts ?? []).map((s) => (
        <Card key={s.id} className="p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {s.kind === 'call' ? <Phone className="h-4 w-4 text-[var(--color-primary)]" /> : <Mail className="h-4 w-4 text-[var(--color-primary)]" />}
              <h2 className="text-[15px] font-semibold">{s.name}</h2>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: s.id, kind: s.kind, name: s.name, body: s.body })}>Edit</Button>
                <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setDeleteFor(s)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{s.body}</p>
        </Card>
      ))}

      <ConfirmDialog open={!!deleteFor} onOpenChange={(v) => { if (!v) setDeleteFor(null) }}
        title="Delete this template?" message={deleteFor ? `"${deleteFor.name}" will be removed.` : ''}
        confirmLabel="Delete" destructive loading={remove.isPending} onConfirm={() => deleteFor && remove.mutate(deleteFor.id)} />
    </div>
  )
}
