import { useQuery } from '@tanstack/react-query'
import { Network, Info } from 'lucide-react'
import { resellerApi } from '../../api/endpoints'
import type { SubClient } from '../../api/types'
import { Card, CardBody } from '../../components/ui/primitives'
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

export function AdminResellersPage() {
  const subQuery = useQuery({ queryKey: ['reseller-sub-clients'], queryFn: () => resellerApi.subClients() })
  const revenueQuery = useQuery({ queryKey: ['reseller-revenue'], queryFn: () => resellerApi.revenue() })

  const subClients = subQuery.data ?? []
  const revenue = revenueQuery.data
  const isLoading = subQuery.isLoading || revenueQuery.isLoading
  const isError = subQuery.isError || revenueQuery.isError

  const refetch = () => {
    subQuery.refetch()
    revenueQuery.refetch()
  }

  if (isLoading) {
    return (
      <div className="reveal">
        <PageHeader title="Resellers" />
        <TableSkeleton rows={6} cols={5} />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="reveal">
        <PageHeader title="Resellers" />
        <ErrorState onRetry={refetch} />
      </div>
    )
  }

  return (
    <div className="reveal">
      <PageHeader title="Resellers" subtitle="Admin oversight of reseller-managed clients and commissions." />

      <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
        <p>This is a read-only oversight view. Resellers manage their own sub-clients and branding from the reseller dashboard.</p>
      </div>

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
        <SectionCard title="Reseller-managed clients">
          {subClients.length === 0 ? (
            <EmptyState icon={Network} title="No managed clients" message="No reseller-managed clients yet." />
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Statements">
          {!revenue || revenue.statements.length === 0 ? (
            <EmptyState title="No statements" message="No commission statements have been generated yet." />
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
      </div>
    </div>
  )
}
