import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, ArrowLeft, ShieldAlert, UserCog, Trash2 } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import type { AdminClient } from '../../api/types'
import { Button, Card, CardBody, Input } from '../../components/ui/primitives'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback'
import { PageHeader, SectionCard } from '../shared/bits'
import { formatMoney } from '../../lib/i18n'
import { cn, formatNumber } from '../../lib/utils'
import { relativeTime, absoluteTime } from '../../lib/time'

const STATUS_TONE: Record<AdminClient['status'], string> = {
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-amber-50 text-amber-700',
  deleting: 'bg-red-50 text-red-700',
}

function StatusBadge({ status }: { status: AdminClient['status'] }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium capitalize', STATUS_TONE[status])}>
      {status}
    </span>
  )
}

export function AdminClientsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => adminApi.clients(),
  })

  const clients = useMemo(() => {
    const all = data?.data ?? []
    const q = search.trim().toLowerCase()
    return q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all
  }, [data, search])

  return (
    <div className="reveal">
      <PageHeader title="Clients" subtitle="Every client account on the platform." />

      <div className="mb-4 max-w-xs">
        <Input placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : clients.length === 0 ? (
          <EmptyState icon={Building2} title="No clients" message="No clients match your search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Leads delivered</th>
                  <th className="px-4 py-3 text-right font-medium">Spend</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/admin/clients/${c.id}`)}
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/admin/clients/${c.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 capitalize text-[var(--color-text-secondary)]">{c.plan}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={c.status} />
                        {c.status === 'deleting' && c.retention_days != null && (
                          <span className="text-[11px] text-[var(--color-text-muted)]">Retention: {c.retention_days}d left</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(c.leads_delivered)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(c.spend_cents, 'USD')}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{relativeTime(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function OverviewCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
        <p className="mt-2 text-[24px] font-bold tabular-nums leading-none text-[var(--color-text)]">{value}</p>
        {hint && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{hint}</p>}
      </CardBody>
    </Card>
  )
}

type ConfirmKind = 'suspend' | 'reactivate' | 'impersonate' | 'delete' | null

export function AdminClientDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [kind, setKind] = useState<ConfirmKind>(null)

  const { data: client, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-client', id],
    queryFn: () => adminApi.client(id),
    enabled: !!id,
  })

  const suspendMut = useMutation({
    mutationFn: (reason: string) => adminApi.suspendClient(id, reason),
    onSuccess: () => {
      toast.success('Client status updated')
      qc.invalidateQueries({ queryKey: ['admin-client', id] })
      qc.invalidateQueries({ queryKey: ['admin-clients'] })
      setKind(null)
    },
    onError: () => toast.error('Failed to update client'),
  })

  const deleteMut = useMutation({
    mutationFn: (reason: string) => adminApi.suspendClient(id, `soft-delete: ${reason}`),
    onSuccess: () => {
      toast.success('Soft-delete scheduled')
      qc.invalidateQueries({ queryKey: ['admin-client', id] })
      qc.invalidateQueries({ queryKey: ['admin-clients'] })
      setKind(null)
    },
    onError: () => toast.error('Failed to schedule delete'),
  })

  if (isLoading) {
    return (
      <div className="reveal">
        <PageHeader title="Client" />
        <TableSkeleton rows={6} cols={4} />
      </div>
    )
  }
  if (isError || !client) {
    return (
      <div className="reveal">
        <PageHeader title="Client" />
        <ErrorState onRetry={() => refetch()} />
      </div>
    )
  }

  const isActive = client.status === 'active'

  return (
    <div className="reveal">
      <Link to="/admin/clients" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>
      <PageHeader
        title={client.name}
        subtitle={`${client.plan} plan · ${client.status}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setKind('impersonate')}>
              <UserCog className="h-4 w-4" /> Manage as
            </Button>
            {isActive ? (
              <Button variant="outline" onClick={() => setKind('suspend')}>
                <ShieldAlert className="h-4 w-4" /> Suspend
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setKind('reactivate')}>
                <ShieldAlert className="h-4 w-4" /> Reactivate
              </Button>
            )}
            <Button variant="danger" onClick={() => setKind('delete')}>
              <Trash2 className="h-4 w-4" /> Soft-delete
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <OverviewCard label="Plan" value={<span className="capitalize">{client.plan}</span>} />
        <OverviewCard label="Spend" value={formatMoney(client.spend_cents, 'USD')} />
        <OverviewCard label="Leads delivered" value={formatNumber(client.leads_delivered)} />
        <OverviewCard label="Status" value={<StatusBadge status={client.status} />} hint={`Since ${absoluteTime(client.created_at)}`} />
      </div>

      {client.status === 'deleting' && client.retention_days != null && (
        <div className="mb-6 rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          This account is scheduled for deletion. Data retained for {client.retention_days} more day{client.retention_days === 1 ? '' : 's'}.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Usage summary">
          <div className="divide-y divide-[var(--color-border)] text-sm">
            <div className="flex justify-between px-5 py-3">
              <span className="text-[var(--color-text-secondary)]">Leads delivered</span>
              <span className="tabular-nums font-medium">{formatNumber(client.leads_delivered)}</span>
            </div>
            <div className="flex justify-between px-5 py-3">
              <span className="text-[var(--color-text-secondary)]">Lifetime spend</span>
              <span className="tabular-nums font-medium">{formatMoney(client.spend_cents, 'USD')}</span>
            </div>
            <div className="flex justify-between px-5 py-3">
              <span className="text-[var(--color-text-secondary)]">Account age</span>
              <span className="font-medium">{relativeTime(client.created_at)}</span>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Billing state">
          <div className="px-5 py-4 text-sm text-[var(--color-text-secondary)]">
            {isActive
              ? `Billing is active on the ${client.plan} plan. Invoices are issued monthly and settle automatically.`
              : `Billing is paused while the account is ${client.status}. No charges will be incurred until the account is reactivated.`}
          </div>
        </SectionCard>

        <SectionCard title="Market locks">
          <div className="px-5 py-4 text-sm text-[var(--color-text-secondary)]">
            This client holds market locks across their active trades and areas. Review the global{' '}
            <Link to="/admin/market-locks" className="font-medium text-[var(--color-admin)] hover:underline">market locks</Link> view to release or audit them.
          </div>
        </SectionCard>

        <SectionCard title="Team">
          <div className="px-5 py-4 text-sm text-[var(--color-text-secondary)]">
            Team members and their roles are managed by the client. Use “Manage as” to inspect their workspace; the action is written to the audit log.
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={kind === 'suspend' || kind === 'reactivate'}
        onOpenChange={(v) => !v && setKind(null)}
        title={kind === 'reactivate' ? 'Reactivate client' : 'Suspend client'}
        message={
          kind === 'reactivate'
            ? `Restore access for ${client.name}. This is written to the audit log.`
            : `Suspend access for ${client.name}. Running deliveries will be paused. This is written to the audit log.`
        }
        confirmLabel={kind === 'reactivate' ? 'Reactivate' : 'Suspend'}
        requireReason
        destructive={kind === 'suspend'}
        loading={suspendMut.isPending}
        onConfirm={(reason) => suspendMut.mutate(reason ?? '')}
      />

      <ConfirmDialog
        open={kind === 'impersonate'}
        onOpenChange={(v) => !v && setKind(null)}
        title="Impersonate client"
        message={`Open ${client.name}'s workspace as an administrator. This access is logged.`}
        confirmLabel="Manage as client"
        requireReason
        loading={false}
        onConfirm={() => {
          toast.success('Impersonation logged')
          setKind(null)
          navigate('/admin/clients')
        }}
      />

      <ConfirmDialog
        open={kind === 'delete'}
        onOpenChange={(v) => !v && setKind(null)}
        title="Soft-delete client"
        message={`This schedules ${client.name} for deletion. Data is retained for a grace period before permanent removal. This is written to the audit log.`}
        confirmLabel="Soft-delete"
        requireText={client.name}
        requireReason
        destructive
        loading={deleteMut.isPending}
        onConfirm={(reason) => deleteMut.mutate(reason ?? '')}
      />
    </div>
  )
}
