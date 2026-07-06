import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { FileClock } from 'lucide-react'
import { auditApi, usersApi, type AuditRow } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'

const ACTION_LABEL: Record<string, string> = { disposition: 'Disposition', deal: 'Deal', reassign: 'Reassign' }

/** §3 AuditLog viewer — immutable feed auto-written by DB triggers. */
export function AuditLogPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['audit-log'], queryFn: () => auditApi.list(150) })
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  const nameFor = (id: string | null | undefined) => (id ? users?.find((u) => u.id === id)?.name ?? 'User' : 'System')
  const detail = (r: AuditRow) => {
    const m = r.meta ?? {}
    if (r.action === 'disposition') return `${m.tier1 ?? ''}${m.tier2 ? ` → ${m.tier2}` : ''}`
    if (r.action === 'deal') return `${m.stage ?? ''}${m.value != null ? ` · $${Number(m.value).toLocaleString()}` : ''}`
    if (r.action === 'reassign') return `→ ${nameFor(m.setter_id as string | null)}`
    return ''
  }
  const rows = data ?? []

  return (
    <div className="reveal max-w-3xl">
      <PageHeader title="Audit log" subtitle="Immutable record of dispositions, deals and reassignments." />
      {rows.length === 0 ? (
        <EmptyState icon={FileClock} title="No activity yet" message="Actions appear here as your team works leads." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Actor</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-5 py-3 whitespace-nowrap text-[13px] text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</td>
                    <td className="px-3 py-3 font-medium">{nameFor(r.actor_id)}</td>
                    <td className="px-3 py-3">{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td className="px-3 py-3 text-[var(--color-text-secondary)]">{detail(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
