import * as React from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { Button, Skeleton, Spinner } from '../ui/primitives'
import { cn } from '../../lib/utils'

/** The states quartet (§18-1): Loading / Empty / Error used on every data view. */

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-[var(--color-text-muted)]', className)}>
      <Spinner />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  message: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
        <Icon className="h-6 w-6 text-[var(--color-text-muted)]" />
      </div>
      <div>
        <h3 className="text-[16px] font-semibold text-[var(--color-text)]">{title}</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--color-text-secondary)]">{message}</p>
      </div>
      {action}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
        <AlertTriangle className="h-6 w-6 text-[var(--c-unverified)]" />
      </div>
      <div>
        <h3 className="text-[16px] font-semibold text-[var(--color-text)]">{title}</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--color-text-secondary)]">
          {message ?? 'We couldn’t load this. Please try again.'}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      )}
    </div>
  )
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-[var(--color-border)]">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-6' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="space-y-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}
