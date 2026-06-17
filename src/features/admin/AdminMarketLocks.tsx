import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Lock, Unlock, Check, Info } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import type { MarketLock } from '../../api/types'
import { Button } from '../../components/ui/primitives'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { relativeTime, absoluteTime } from '../../lib/time'

export function AdminMarketLocksPage() {
  const qc = useQueryClient()
  const [releasing, setReleasing] = useState<MarketLock | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-market-locks'],
    queryFn: () => adminApi.marketLocks(),
  })

  const locks = data?.data ?? []

  const releaseMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.releaseLock(id, reason),
    onSuccess: () => {
      toast.success('Lock released')
      qc.invalidateQueries({ queryKey: ['admin-market-locks'] })
      setReleasing(null)
    },
    onError: () => toast.error('Failed to release lock'),
  })

  return (
    <div className="reveal">
      <PageHeader title="Market Locks" subtitle="Exclusive trade + area locks held across all clients." />

      <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
        <p>
          Lock pricing is set per trade and area in the pricing configuration. Force-releasing a lock frees the market for re-sale
          and is written to the audit log.
        </p>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : locks.length === 0 ? (
          <EmptyState icon={Lock} title="No market locks" message="No active locks across any client." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Trade</th>
                  <th className="px-4 py-3 font-medium">Area</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                  <th className="px-4 py-3 font-medium">Auto-renew</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {locks.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{l.client_name ?? '—'}</td>
                    <td className="px-4 py-3 capitalize text-[var(--color-text-secondary)]">{l.trade}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{l.area}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]" title={absoluteTime(l.expires_at)}>
                      {relativeTime(l.expires_at)}
                    </td>
                    <td className="px-4 py-3">
                      {l.auto_renew ? (
                        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-green-700">
                          <Check className="h-3.5 w-3.5" /> On
                        </span>
                      ) : (
                        <span className="text-[13px] text-[var(--color-text-muted)]">Off</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => setReleasing(l)}>
                        <Unlock className="h-4 w-4" /> Force release
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!releasing}
        onOpenChange={(v) => !v && setReleasing(null)}
        title="Force release lock"
        message={
          releasing
            ? `Release the ${releasing.trade} lock on ${releasing.area}${
                releasing.client_name ? ` held by ${releasing.client_name}` : ''
              }. The market becomes available immediately. This is written to the audit log.`
            : ''
        }
        confirmLabel="Force release"
        requireReason
        destructive
        loading={releaseMut.isPending}
        onConfirm={(reason) => {
          if (releasing) releaseMut.mutate({ id: releasing.id, reason: reason ?? '' })
        }}
      />
    </div>
  )
}
