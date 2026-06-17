import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Network, Plus, UserCog, Palette, X } from 'lucide-react'
import { resellerApi } from '../../api/endpoints'
import type { SubClient } from '../../api/types'
import { Button, Card, CardBody, Input } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback'
import { PageHeader, SectionCard, FillChip } from '../shared/bits'
import { formatMoney } from '../../lib/i18n'
import { cn, formatNumber } from '../../lib/utils'

const SUB_STATUS_TONE: Record<SubClient['status'], string> = {
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-amber-50 text-amber-700',
}

const STATEMENT_TONE: Record<string, string> = {
  paid: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
  due: 'bg-amber-50 text-amber-700',
  overdue: 'bg-red-50 text-red-700',
}

export function ResellerPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [viewingAs, setViewingAs] = useState<string | null>(null)

  const subQuery = useQuery({ queryKey: ['reseller-sub-clients'], queryFn: () => resellerApi.subClients() })
  const revenueQuery = useQuery({ queryKey: ['reseller-revenue'], queryFn: () => resellerApi.revenue() })

  const createMut = useMutation({
    mutationFn: (n: string) => resellerApi.create(n),
    onSuccess: (sub) => {
      toast.success(`Sub-client “${sub.name}” created`)
      qc.invalidateQueries({ queryKey: ['reseller-sub-clients'] })
      setCreateOpen(false)
      setName('')
    },
    onError: () => toast.error('Failed to create sub-client'),
  })

  const subClients = subQuery.data ?? []
  const revenue = revenueQuery.data
  const isLoading = subQuery.isLoading || revenueQuery.isLoading
  const isError = subQuery.isError || revenueQuery.isError

  const refetch = () => {
    subQuery.refetch()
    revenueQuery.refetch()
  }

  return (
    <div className="reveal">
      <PageHeader
        title="Reseller"
        subtitle="Manage your sub-clients, commissions, and branding."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create sub-client
          </Button>
        }
      />

      {viewingAs && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm">
          <span className="text-[var(--color-text)]">
            Viewing as <span className="font-semibold">{viewingAs}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setViewingAs(null)}>
            <X className="h-4 w-4" /> Exit
          </Button>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardBody>
                <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Commission earned</p>
                <p className="mt-2 text-[28px] font-bold tabular-nums leading-none text-[var(--color-text)]">
                  {formatMoney(revenue?.commission_cents, 'USD')}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Pending payout</p>
                <p className="mt-2 text-[28px] font-bold tabular-nums leading-none text-[var(--color-text)]">
                  {formatMoney(revenue?.pending_cents, 'USD')}
                </p>
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Statements">
              {!revenue || revenue.statements.length === 0 ? (
                <EmptyState title="No statements" message="No commission statements yet." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                        <th className="px-4 py-3 font-medium">Period</th>
                        <th className="px-4 py-3 text-right font-medium">Amount</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {revenue.statements.map((st) => (
                        <tr key={st.period} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium">{st.period}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatMoney(st.amount_cents, 'USD')}</td>
                          <td className="px-4 py-3">
                            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium capitalize', STATEMENT_TONE[st.status] ?? 'bg-slate-100 text-slate-700')}>
                              {st.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Sub-clients">
              {subClients.length === 0 ? (
                <EmptyState
                  icon={Network}
                  title="No sub-clients"
                  message="Create your first sub-client to start managing accounts."
                  action={
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4" /> Create sub-client
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Plan</th>
                        <th className="px-4 py-3 text-right font-medium">Leads</th>
                        <th className="px-4 py-3 font-medium">Fill</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {subClients.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium">{s.name}</td>
                          <td className="px-4 py-3 capitalize text-[var(--color-text-secondary)]">{s.plan}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(s.leads_delivered)}</td>
                          <td className="px-4 py-3"><FillChip value={s.fill} /></td>
                          <td className="px-4 py-3">
                            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium capitalize', SUB_STATUS_TONE[s.status])}>
                              {s.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setViewingAs(s.name)
                                  toast.success(`Switched to ${s.name}`)
                                }}
                              >
                                <UserCog className="h-4 w-4" /> Manage as
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => toast.success(`Branding for ${s.name}`)}>
                                <Palette className="h-4 w-4" /> Branding
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Create sub-client" description="Add a new account you manage as a reseller.">
        <div className="mb-4">
          <Input
            placeholder="Sub-client name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) createMut.mutate(name.trim())
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button loading={createMut.isPending} disabled={!name.trim()} onClick={() => createMut.mutate(name.trim())}>
            Create
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
