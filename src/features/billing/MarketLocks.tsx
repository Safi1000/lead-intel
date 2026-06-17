import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Lock, MapPin } from 'lucide-react'
import { marketLocksApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { formatMoney } from '../../lib/i18n'
import { relativeTime, shortDate } from '../../lib/time'
import { Button, Input, Label, Spinner } from '../../components/ui/primitives'
import { Switch } from '../../components/ui/controls'
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { SectionCard } from '../shared/bits'
import { Can } from '../../components/rbac/Can'
import type { MarketLock, MarketLockAvailability } from '../../api/types'

const TRADE_OPTIONS = [
  { id: 'roofing', label: 'Roofing' },
  { id: 'hvac', label: 'HVAC' },
  { id: 'plumbing', label: 'Plumbing' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'landscaping', label: 'Landscaping' },
  { id: 'solar', label: 'Solar' },
]

export function MarketLocksPanel() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['market-locks'],
    queryFn: () => marketLocksApi.list(),
  })

  const [lockOpen, setLockOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<MarketLock | null>(null)

  const cancel = useMutation({
    mutationFn: (id: string) => marketLocksApi.cancel(id),
    onSuccess: () => {
      toast.success('Market lock cancelled')
      setCancelTarget(null)
      qc.invalidateQueries({ queryKey: ['market-locks'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  return (
    <SectionCard
      title="Market locks"
      action={
        <Can action="manage" resource="marketLocks" disable reason="Requires billing or owner role">
          <Button size="sm" onClick={() => setLockOpen(true)}>
            <Lock className="h-4 w-4" /> Lock a market
          </Button>
        </Can>
      }
    >
      {isLoading ? (
        <LoadingState label="Loading market locks…" />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={Lock}
          title="No market locks"
          message="Lock a trade + area to claim exclusive lead delivery in that market."
          action={
            <Can action="manage" resource="marketLocks" disable reason="Requires billing or owner role">
              <Button size="sm" onClick={() => setLockOpen(true)}>
                <Lock className="h-4 w-4" /> Lock a market
              </Button>
            </Can>
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {data.map((lock) => (
            <LockRow key={lock.id} lock={lock} onCancel={() => setCancelTarget(lock)} />
          ))}
        </ul>
      )}

      <LockMarketDialog open={lockOpen} onOpenChange={setLockOpen} />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(v) => !v && setCancelTarget(null)}
        title="Cancel market lock?"
        message={
          cancelTarget
            ? `Release the exclusive lock on ${cancelTarget.trade} in ${cancelTarget.area}. This market will become available to other clients.`
            : ''
        }
        confirmLabel="Cancel lock"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancelTarget && cancel.mutate(cancelTarget.id)}
      />
    </SectionCard>
  )
}

function LockRow({ lock, onCancel }: { lock: MarketLock; onCancel: () => void }) {
  const qc = useQueryClient()
  const toggleRenew = useMutation({
    mutationFn: () =>
      // No dedicated endpoint for auto-renew; re-buy keeps the lock and is a no-op demo toggle.
      Promise.resolve(),
    onSuccess: () => {
      toast.success(lock.auto_renew ? 'Auto-renew off (demo)' : 'Auto-renew on (demo)')
      qc.invalidateQueries({ queryKey: ['market-locks'] })
    },
  })
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-blue-50 text-[var(--color-primary)]">
          <MapPin className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold capitalize text-[var(--color-text)]">
            {lock.trade} · {lock.area}
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
            Expires {relativeTime(lock.expires_at)} ({shortDate(lock.expires_at)})
            {lock.client_name ? ` · ${lock.client_name}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Can action="manage" resource="marketLocks" disable reason="Requires billing or owner role">
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
            Auto-renew
            <Switch checked={lock.auto_renew} onCheckedChange={() => toggleRenew.mutate()} />
          </label>
        </Can>
        <Can action="manage" resource="marketLocks" disable reason="Requires billing or owner role">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </Can>
      </div>
    </li>
  )
}

function LockMarketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const [trade, setTrade] = useState('roofing')
  const [area, setArea] = useState('')

  const availability = useQuery<MarketLockAvailability>({
    queryKey: ['market-lock-availability', trade, area.trim()],
    queryFn: () => marketLocksApi.availability(trade, area.trim()),
    enabled: open && area.trim().length > 1,
  })

  const buy = useMutation({
    mutationFn: () => marketLocksApi.buy({ trade, area: area.trim() }),
    onSuccess: () => {
      toast.success('Market locked')
      onOpenChange(false)
      setArea('')
      qc.invalidateQueries({ queryKey: ['market-locks'] })
      qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const avail = availability.data

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Lock a market"
      description="Claim exclusive lead delivery for a trade in a specific city or area."
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="lock-trade">Trade</Label>
          <select
            id="lock-trade"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus-visible:outline-none"
          >
            {TRADE_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="lock-area">City / area</Label>
          <Input
            id="lock-area"
            placeholder="e.g. Austin, TX"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
        </div>

        {area.trim().length > 1 && (
          <div className="rounded-[12px] border border-[var(--color-border)] p-4">
            {availability.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Spinner className="h-4 w-4" /> Checking availability…
              </div>
            ) : availability.isError || !avail ? (
              <ErrorState message="Couldn’t check availability." onRetry={() => availability.refetch()} />
            ) : avail.available ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--c-verified)]">Available</p>
                  <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
                    Capitalize on exclusive delivery in this market.
                  </p>
                </div>
                <span className="text-[18px] font-bold tabular-nums text-[var(--color-text)]">
                  {formatMoney(avail.price_cents)}
                  <span className="ml-1 text-[12px] font-normal text-[var(--color-text-muted)]">/mo</span>
                </span>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-[var(--c-unverified)]">Unavailable</p>
                <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
                  {avail.locked_by ? `Locked by ${avail.locked_by}. ` : 'This market is currently locked. '}
                  {avail.locked_until ? `Available again ${shortDate(avail.locked_until)}.` : ''}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Can action="manage" resource="marketLocks" disable reason="Requires billing or owner role">
            <Button
              loading={buy.isPending}
              disabled={!avail?.available || area.trim().length < 2}
              onClick={() => buy.mutate()}
            >
              Purchase lock
            </Button>
          </Can>
        </div>
      </div>
    </Dialog>
  )
}
