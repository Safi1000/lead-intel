import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, LogIn, Plus, Trash2, UserPlus } from 'lucide-react'
import { authApi, orgsApi, usersApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import type { Org } from '../../api/types'

export function OrganizationsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list })

  const [createOpen, setCreateOpen] = useState(false)
  const [addManagerFor, setAddManagerFor] = useState<Org | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Org | null>(null)

  const enter = useMutation({
    mutationFn: (id: string) => orgsApi.enter(id),
    onSuccess: async () => {
      const me = await authApi.me()
      setSession({ user: me.user, client: me.client, role: me.role, flags: me.feature_flags, permissions: me.permissions, actingOrgId: me.acting_org_id, tosAcceptedAt: me.tos_accepted_at })
      await qc.invalidateQueries()
      navigate('/home')
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const del = useMutation({
    mutationFn: (id: string) => orgsApi.remove(id),
    onSuccess: () => { toast.success('Organization deleted'); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['orgs'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const orgs = data ?? []

  return (
    <div className="reveal">
      <PageHeader
        title="Organizations"
        subtitle="Open an organization to work inside it, or add a manager to run it."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New organization</Button>}
      />

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : orgs.length === 0 ? (
        <EmptyState icon={Building2} title="No organizations yet" message="Create your first organization, then add a manager to it." action={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New organization</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o) => (
            <Card key={o.id} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-blue-50 text-[var(--color-primary)]"><Building2 className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[15px] font-semibold">{o.name}</h3>
                  <p className="text-[12px] text-[var(--color-text-muted)]">{o.user_count ?? 0} user{o.user_count === 1 ? '' : 's'} · {o.manager_count ?? 0} manager{o.manager_count === 1 ? '' : 's'}</p>
                </div>
                <button onClick={() => setDeleteTarget(o)} aria-label="Delete organization" className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-slate-100"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border)] pt-3">
                <Button size="sm" className="flex-1" loading={enter.isPending && enter.variables === o.id} onClick={() => enter.mutate(o.id)}>
                  <LogIn className="h-3.5 w-3.5" /> View
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setAddManagerFor(o)}>
                  <UserPlus className="h-3.5 w-3.5" /> Add manager
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {createOpen && <CreateOrgDialog onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); qc.invalidateQueries({ queryKey: ['orgs'] }) }} />}

      {addManagerFor && (
        <AddManagerDialog org={addManagerFor} onClose={() => setAddManagerFor(null)} onSaved={() => { setAddManagerFor(null); qc.invalidateQueries({ queryKey: ['orgs'] }) }} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        message="This removes the organization and all of its users, templates, and leads. This cannot be undone."
        confirmLabel="Delete organization"
        requireText={deleteTarget?.name}
        destructive
        loading={del.isPending}
        onConfirm={() => deleteTarget && del.mutate(deleteTarget.id)}
      />
    </div>
  )
}

function CreateOrgDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => orgsApi.create(name.trim()),
    onSuccess: () => { toast.success('Organization created'); onSaved() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New organization" description="Give the organization a name. You can add its manager next.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="o-name">Organization name</Label>
          <Input id="o-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Roofing" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>Create</Button>
        </div>
      </div>
    </Dialog>
  )
}

function AddManagerDialog({ org, onClose, onSaved }: { org: Org; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const create = useMutation({
    mutationFn: () => usersApi.create({ name: name.trim(), email: email.trim(), password, role: 'manager', org_id: org.id }),
    onSuccess: () => { toast.success(`Manager added to ${org.name}`); onSaved() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const valid = name.trim() && /^\S+@\S+\.\S+$/.test(email) && password.length >= 6
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Add manager — ${org.name}`} description="Creates a manager who can run this organization and add its users.">
      <div className="space-y-4">
        <div><Label htmlFor="m-name">Full name</Label><Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></div>
        <div><Label htmlFor="m-email">Email</Label><Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com" /></div>
        <div><Label htmlFor="m-pass">Temporary password</Label><Input id="m-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>Add manager</Button>
        </div>
      </div>
    </Dialog>
  )
}
