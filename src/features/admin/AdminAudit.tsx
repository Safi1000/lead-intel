import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileClock, Download } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import { Button, Input } from '../../components/ui/primitives'
import { Tooltip } from '../../components/ui/controls'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { relativeTime, absoluteTime } from '../../lib/time'

export function AdminAuditPage() {
  const [search, setSearch] = useState('')
  const [actionType, setActionType] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => adminApi.audit(),
  })

  const entries = data?.data ?? []

  const actionTypes = useMemo(() => {
    return Array.from(new Set(entries.map((e) => e.action))).sort()
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      const matchesQuery = !q || e.actor.toLowerCase().includes(q) || e.action.toLowerCase().includes(q)
      const matchesAction = !actionType || e.action === actionType
      return matchesQuery && matchesAction
    })
  }, [entries, search, actionType])

  return (
    <div className="reveal">
      <PageHeader
        title="Audit Log"
        subtitle="Searchable record of data-access and delivery actions across the platform."
        actions={
          <Button variant="outline" onClick={() => toast.success('Audit export queued')}>
            <Download className="h-4 w-4" /> Export
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-full max-w-xs">
          <Input placeholder="Search actor or action…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
        >
          <option value="">All actions</option>
          {actionTypes.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={FileClock} title="No audit entries" message="No entries match your filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Resource</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                      <Tooltip content={absoluteTime(e.at)}>
                        <span className="cursor-default">{relativeTime(e.at)}</span>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-3 font-medium">{e.actor}</td>
                    <td className="px-4 py-3">
                      <span className="font-data text-[13px] text-[var(--color-text)]">{e.action}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{e.resource}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{e.client}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{e.reason ?? '—'}</td>
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
