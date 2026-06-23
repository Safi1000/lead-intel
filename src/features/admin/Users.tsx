import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { KeyRound, MessageSquare, MoreVertical, Plus, Trash2, UserPlus } from 'lucide-react'
import { usersApi, statsApi, userRemarksApi, type CreateUserBody, type OrgUserStats } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuth } from '../../hooks'
import { ROLE_LABELS, PERMISSION_CATALOG, permKey, roleGrants } from '../../config/permissions'
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives'
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog'
import { DropdownMenu, DropdownTrigger, DropdownContent, DropdownItem } from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import type { ManagedUser, PermissionOverrides, Role } from '../../api/types'

const ASSIGNABLE_ROLES: Role[] = ['manager', 'lead_generator', 'setter', 'closer']

function buildPermState(role: Role, overrides?: PermissionOverrides): Record<string, boolean> {
  const m: Record<string, boolean> = {}
  for (const p of PERMISSION_CATALOG) {
    const key = permKey(p.resource, p.action)
    let v = roleGrants(role, p.action, p.resource)
    if (overrides?.granted.includes(key)) v = true
    if (overrides?.denied.includes(key)) v = false
    m[key] = v
  }
  return m
}
function toOverrides(role: Role, state: Record<string, boolean>): PermissionOverrides {
  const granted: string[] = []
  const denied: string[] = []
  for (const p of PERMISSION_CATALOG) {
    const key = permKey(p.resource, p.action)
    const def = roleGrants(role, p.action, p.resource)
    if (state[key] && !def) granted.push(key)
    if (!state[key] && def) denied.push(key)
  }
  return { granted, denied }
}

/** Compact, role-specific activity chips for a user. */
function UserStatChips({ user: u, stats }: { user: ManagedUser; stats: OrgUserStats }) {
  const chips: string[] = []
  if (u.role === 'manager') {
    // Org-wide rollup (visible only on this manager/SA-only page).
    chips.push(`${stats.totals.leads} leads`, `${stats.totals.batches} batches`, `${stats.totals.booked} booked`, `${stats.totals.won} won`, `${stats.totals.lost} lost`)
  } else if (u.role === 'lead_generator') {
    const s = stats.byUploader[u.name]
    chips.push(`${s?.batches ?? 0} batches`, `${s?.leads ?? 0} leads uploaded`)
  } else if (u.role === 'setter') {
    const s = stats.bySetter[u.name]
    chips.push(`${s?.total ?? 0} assigned`, `${s?.contacted ?? 0} worked`, `${s?.booked ?? 0} booked`, `${s?.won ?? 0} won`)
  } else if (u.role === 'closer') {
    const s = stats.byCloser[u.name]
    chips.push(`${s?.total ?? 0} assigned`, `${s?.booked ?? 0} to call`, `${s?.won ?? 0} won`, `${s?.lost ?? 0} lost`)
  }
  if (chips.length === 0) return <span className="text-[12px] text-[var(--color-text-muted)]">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--color-text-secondary)]">{c}</span>
      ))}
    </div>
  )
}

export function UsersPage() {
  const qc = useQueryClient()
  const { role } = useAuth()
  const canSeeManagerStats = role === 'manager' || role === 'superadmin' || role === 'admin'
  const usersQ = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  const statsQ = useQuery({ queryKey: ['org-user-stats'], queryFn: () => statsApi.org() })
  const remarkCountsQ = useQuery({ queryKey: ['user-remark-counts'], queryFn: () => userRemarksApi.counts() })

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null)
  const [remarksTarget, setRemarksTarget] = useState<ManagedUser | null>(null)
  const remarkCounts = remarkCountsQ.data ?? {}

  const del = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => { toast.success('User removed'); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const toggleStatus = useMutation({
    mutationFn: (u: ManagedUser) => usersApi.update(u.id, { status: u.status === 'active' ? 'disabled' : 'active' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const users = usersQ.data ?? []

  return (
    <div className="reveal">
      <PageHeader
        title="Users"
        subtitle="Create and manage the users in this organization."
        actions={<Button onClick={() => { setEditing(null); setFormOpen(true) }}><UserPlus className="h-4 w-4" /> Add user</Button>}
      />

      <Card>
        {usersQ.isLoading ? (
          <LoadingState />
        ) : usersQ.isError ? (
          <ErrorState onRetry={() => usersQ.refetch()} />
        ) : users.length === 0 ? (
          <EmptyState icon={UserPlus} title="No users yet" message="Add your first user to get started." action={<Button onClick={() => { setEditing(null); setFormOpen(true) }}><Plus className="h-4 w-4" /> Add user</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="px-3 py-2.5 font-medium">Activity</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{u.name}</p>
                        {remarkCounts[u.id] > 0 && (
                          <button onClick={() => setRemarksTarget(u)} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-slate-200" title="View remarks">
                            <MessageSquare className="h-3 w-3" /> {remarkCounts[u.id]}
                          </button>
                        )}
                      </div>
                      <p className="text-[12px] text-[var(--color-text-muted)]">{u.email}</p>
                    </td>
                    <td className="px-3 py-3"><span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[12px] font-medium">{ROLE_LABELS[u.role]}</span></td>
                    <td className="px-3 py-3">
                      {u.role === 'manager' && !canSeeManagerStats ? (
                        <span className="text-[12px] text-[var(--color-text-muted)]">—</span>
                      ) : statsQ.data ? (
                        <UserStatChips user={u} stats={statsQ.data} />
                      ) : (
                        <span className="text-[12px] text-[var(--color-text-muted)]">…</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn('inline-flex items-center gap-1 text-[12px] font-medium', u.status === 'active' ? 'text-[var(--c-verified)]' : 'text-[var(--color-text-muted)]')}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', u.status === 'active' ? 'bg-[var(--c-verified)]' : 'bg-slate-300')} />
                        {u.status === 'active' ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <DropdownMenu>
                        <DropdownTrigger asChild>
                          <button className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-slate-100" aria-label="User actions"><MoreVertical className="h-4 w-4" /></button>
                        </DropdownTrigger>
                        <DropdownContent>
                          <DropdownItem onSelect={() => { setEditing(u); setFormOpen(true) }}>Edit role &amp; permissions</DropdownItem>
                          <DropdownItem onSelect={() => setRemarksTarget(u)}><MessageSquare className="h-4 w-4" /> Remarks</DropdownItem>
                          <DropdownItem onSelect={() => setResetTarget(u)}><KeyRound className="h-4 w-4" /> Reset password</DropdownItem>
                          <DropdownItem onSelect={() => toggleStatus.mutate(u)}>{u.status === 'active' ? 'Disable' : 'Enable'} account</DropdownItem>
                          <DropdownItem destructive onSelect={() => setDeleteTarget(u)}><Trash2 className="h-4 w-4" /> Remove</DropdownItem>
                        </DropdownContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {formOpen && (
        <UserFormDialog
          user={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); qc.invalidateQueries({ queryKey: ['users'] }) }}
        />
      )}

      {resetTarget && <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />}

      {remarksTarget && (
        <UserRemarksDialog
          user={remarksTarget}
          onClose={() => setRemarksTarget(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ['user-remark-counts'] })}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Remove ${deleteTarget?.name}?`}
        message="They lose access immediately. This cannot be undone."
        confirmLabel="Remove"
        destructive
        loading={del.isPending}
        onConfirm={() => deleteTarget && del.mutate(deleteTarget.id)}
      />
    </div>
  )
}

function UserFormDialog({ user, onClose, onSaved }: { user: ManagedUser | null; onClose: () => void; onSaved: () => void }) {
  const editMode = !!user
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>(user?.role ?? 'setter')
  const [perms, setPerms] = useState<Record<string, boolean>>(() => buildPermState(user?.role ?? 'setter', user?.permissions))

  // Reset toggles to the role's defaults when the role changes.
  useEffect(() => { setPerms(buildPermState(role, editMode && role === user?.role ? user?.permissions : undefined)) }, [role]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => {
      const permissions = toOverrides(role, perms)
      if (editMode) return usersApi.update(user!.id, { name: name.trim(), role, permissions })
      const body: CreateUserBody = { name: name.trim(), email: email.trim(), password, role, org_id: null, permissions }
      return usersApi.create(body)
    },
    onSuccess: () => { toast.success(editMode ? 'User updated' : 'User created'); onSaved() },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const valid = name.trim() && (editMode || (/^\S+@\S+\.\S+$/.test(email) && password.length >= 6))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={editMode ? `Edit ${user?.name}` : 'Add user'} description={editMode ? 'Update role and permissions.' : 'Create a user with a login, role, and permissions.'}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div>
          <Label htmlFor="u-name">Full name</Label>
          <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
        </div>
        {!editMode && (
          <>
            <div>
              <Label htmlFor="u-email">Email</Label>
              <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
            </div>
            <div>
              <Label htmlFor="u-pass">Temporary password</Label>
              <Input id="u-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </div>
          </>
        )}
        <div>
          <Label htmlFor="u-role">Role</Label>
          <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div>
          <Label className="mb-1.5">Permissions</Label>
          <p className="mb-2 text-[12px] text-[var(--color-text-muted)]">Defaults follow the role; toggle to grant or revoke individually.</p>
          <div className="space-y-1.5 rounded-[8px] border border-[var(--color-border)] p-3">
            {PERMISSION_CATALOG.map((p) => {
              const key = permKey(p.resource, p.action)
              return (
                <label key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span>{p.label}</span>
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={!!perms[key]} onChange={(e) => setPerms((s) => ({ ...s, [key]: e.target.checked }))} />
                </label>
              )
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{editMode ? 'Save changes' : 'Create user'}</Button>
        </div>
      </div>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => usersApi.resetPassword(user.id, password),
    onSuccess: () => { toast.success(`Password reset for ${user.name}`); onClose() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Reset password — ${user.name}`} description="Set a new password for this user.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="rp">New password</Label>
          <Input id="rp" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={reset.isPending} disabled={password.length < 6} onClick={() => reset.mutate()}>Reset password</Button>
        </div>
      </div>
    </Dialog>
  )
}

/** Manager/SA-only remarks thread about a user. */
function UserRemarksDialog({ user, onClose, onChanged }: { user: ManagedUser; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient()
  const key = ['user-remarks', user.id]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => userRemarksApi.list(user.id) })
  const [text, setText] = useState('')

  const refresh = () => { qc.invalidateQueries({ queryKey: key }); onChanged() }
  const add = useMutation({
    mutationFn: () => userRemarksApi.add(user.id, text),
    onSuccess: () => { setText(''); refresh() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const del = useMutation({
    mutationFn: (id: string) => userRemarksApi.remove(id),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const remarks = data ?? []
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Remarks — ${user.name}`} description="Private notes for managers and super admins only. This user can't see them.">
      <div className="space-y-4">
        <div className="max-h-[40vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
          ) : remarks.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No remarks yet.</p>
          ) : (
            remarks.map((r) => (
              <div key={r.id} className="group rounded-[10px] bg-[var(--color-surface-2)] p-3">
                <div className="mb-1 flex items-center gap-2 text-[12px]">
                  <span className="font-semibold text-[var(--color-text)]">{r.author ?? 'Unknown'}</span>
                  <span className="text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(r.at), { addSuffix: true })}</span>
                  <button onClick={() => del.mutate(r.id)} className="ml-auto rounded p-0.5 text-[var(--color-text-muted)] opacity-0 transition group-hover:opacity-100 hover:bg-slate-200 hover:text-red-600" aria-label="Delete remark"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{r.text}</p>
              </div>
            ))
          )}
        </div>
        <div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={`Add a remark about ${user.name.split(' ')[0]}…`} />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button loading={add.isPending} disabled={!text.trim()} onClick={() => add.mutate()}>Add remark</Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
