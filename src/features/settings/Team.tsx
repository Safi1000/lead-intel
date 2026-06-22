import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Mail, MoreVertical, Trash2, UserPlus } from 'lucide-react'
import { teamApi } from '../../api/endpoints'
import { ROLE_CAPABILITIES, ROLE_LABELS } from '../../config/permissions'
import { Can } from '../../components/rbac/Can'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog'
import {
  DropdownMenu,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
} from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { cn } from '../../lib/utils'
import type { Role, TeamMember } from '../../api/types'

const ASSIGNABLE: Role[] = ['lead_generator', 'setter', 'closer']

export function TeamSettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['team'], queryFn: teamApi.list })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('setter')
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)

  const invite = useMutation({
    mutationFn: () => teamApi.invite({ email, role }),
    onSuccess: () => {
      toast.success('Invite sent')
      setInviteOpen(false)
      setEmail('')
      qc.invalidateQueries({ queryKey: ['team'] })
    },
  })
  const setRoleM = useMutation({
    mutationFn: (v: { id: string; role: string }) => teamApi.setRole(v.id, v.role),
    onSuccess: () => {
      toast.success('Role updated')
      qc.invalidateQueries({ queryKey: ['team'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => teamApi.remove(id),
    onSuccess: () => {
      toast.success('Member removed')
      setRemoveTarget(null)
      qc.invalidateQueries({ queryKey: ['team'] })
    },
  })

  const members = data ?? []
  const managers = members.filter((m) => m.role === 'manager')

  return (
    <div className="reveal max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold">Team &amp; roles</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">Invite teammates and manage their access.</p>
        </div>
        <Can action="manage" resource="users">
          <Button onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" /> Invite</Button>
        </Can>
      </div>

      <Card>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : members.length === 0 ? (
          <EmptyState icon={UserPlus} title="No members yet" message="Invite your first teammate to collaborate." />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {members.map((m) => {
              const isLastOwner = m.role === 'manager' && managers.length === 1
              return (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary)] text-[13px] font-semibold text-white">
                    {m.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="truncate text-[13px] text-[var(--color-text-muted)]">{m.email}</p>
                  </div>
                  {m.status === 'invited' && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Pending</span>
                  )}
                  <span className={cn('rounded-full px-2 py-0.5 text-[12px] font-medium', m.role === 'manager' ? 'bg-blue-50 text-[var(--color-primary)]' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]')}>
                    {ROLE_LABELS[m.role]}
                  </span>
                  <Can action="manage" resource="users" fallback={<span className="w-8" />}>
                    <DropdownMenu>
                      <DropdownTrigger asChild>
                        <button className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-slate-100" aria-label="Member actions">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownTrigger>
                      <DropdownContent>
                        {ASSIGNABLE.map((r) => (
                          <DropdownItem key={r} disabled={isLastOwner} onSelect={() => setRoleM.mutate({ id: m.id, role: r })}>
                            Set as {ROLE_LABELS[r]}
                          </DropdownItem>
                        ))}
                        {m.status === 'invited' && (
                          <DropdownItem onSelect={() => { teamApi.resend(m.id); toast.success('Invite resent') }}>
                            <Mail className="h-4 w-4" /> Resend invite
                          </DropdownItem>
                        )}
                        <DropdownItem destructive disabled={isLastOwner} onSelect={() => setRemoveTarget(m)}>
                          <Trash2 className="h-4 w-4" /> Remove
                        </DropdownItem>
                      </DropdownContent>
                    </DropdownMenu>
                  </Can>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Role legend */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Roles</h3>
        <ul className="mt-3 space-y-2">
          {(['manager', 'lead_generator', 'setter', 'closer'] as Role[]).map((r) => (
            <li key={r} className="flex gap-3 text-[13px]">
              <span className="w-28 shrink-0 font-medium">{ROLE_LABELS[r]}</span>
              <span className="text-[var(--color-text-secondary)]">{ROLE_CAPABILITIES[r]}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="Invite a teammate" description="They’ll receive an email invitation to join.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </div>
          <div>
            <Label htmlFor="invite-role">Role</Label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] px-2 text-sm">
              {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button loading={invite.isPending} disabled={!email.includes('@')} onClick={() => invite.mutate()}>Send invite</Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name}?`}
        message="They’ll lose access immediately. Their notes stay, attributed to a removed user."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate(removeTarget.id)}
      />
    </div>
  )
}
