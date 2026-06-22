import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, Plus, Trash2, Users } from 'lucide-react'
import { orgsApi, usersApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import type { Org } from '../../api/types'

export function OrganizationsPage() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list })
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Org | null>(null)

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
        subtitle="Create client organizations and assign a manager to each."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New organization</Button>}
      />

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : orgs.length === 0 ? (
        <EmptyState icon={Building2} title="No organizations yet" message="Create your first organization and its manager." action={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New organization</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o) => (
            <Card key={o.id} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-blue-50 text-[var(--color-primary)]"><Building2 className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold">{o.name}</h3>
                  <p className="text-[12px] text-[var(--color-text-muted)]">{o.user_count ?? 0} user{o.user_count === 1 ? '' : 's'} · {o.manager_count ?? 0} manager{o.manager_count === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border)] pt-3">
                <Link to="/users" className="flex-1"><Button size="sm" variant="outline" className="w-full"><Users className="h-3.5 w-3.5" /> Users</Button></Link>
                <Button size="icon" variant="ghost" aria-label="Delete organization" onClick={() => setDeleteTarget(o)}><Trash2 className="h-4 w-4 text-[var(--c-unverified)]" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {createOpen && <CreateOrgDialog onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); qc.invalidateQueries({ queryKey: ['orgs'] }); qc.invalidateQueries({ queryKey: ['users'] }) }} />}

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

/** Creates the org, then its first manager account. */
function CreateOrgDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [orgName, setOrgName] = useState('')
  const [mName, setMName] = useState('')
  const [mEmail, setMEmail] = useState('')
  const [mPass, setMPass] = useState('')

  const create = useMutation({
    mutationFn: async () => {
      const org = await orgsApi.create(orgName.trim())
      await usersApi.create({ name: mName.trim(), email: mEmail.trim(), password: mPass, role: 'manager', org_id: org.id })
      return org
    },
    onSuccess: () => { toast.success('Organization and manager created'); onSaved() },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const valid = orgName.trim() && mName.trim() && /^\S+@\S+\.\S+$/.test(mEmail) && mPass.length >= 6

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New organization" description="Create the organization and its first manager. The manager can then add their own users.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="o-name">Organization name</Label>
          <Input id="o-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Roofing" />
        </div>
        <div className="rounded-[8px] border border-[var(--color-border)] p-3">
          <p className="mb-2 text-[13px] font-medium">Manager account</p>
          <div className="space-y-3">
            <div><Label htmlFor="m-name">Full name</Label><Input id="m-name" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Jane Doe" /></div>
            <div><Label htmlFor="m-email">Email</Label><Input id="m-email" type="email" value={mEmail} onChange={(e) => setMEmail(e.target.value)} placeholder="jane@acme.com" /></div>
            <div><Label htmlFor="m-pass">Temporary password</Label><Input id="m-pass" type="text" value={mPass} onChange={(e) => setMPass(e.target.value)} placeholder="At least 6 characters" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>Create organization</Button>
        </div>
      </div>
    </Dialog>
  )
}
