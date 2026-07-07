import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { RUN_STATUS_META, type RunStatus } from '../../config/constants'
import { cn } from '../../lib/utils'
import { formatPercent } from '../../lib/utils'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-[var(--color-text)]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status]
  const pulse = status === 'running' || status === 'queued'
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium', meta.className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', pulse && 'animate-pulse')} />
      {meta.label}
    </span>
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  )
}

export function FillChip({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[var(--color-text-muted)]">—</span>
  const tone = value >= 0.7 ? 'bg-green-500/10 text-green-700 dark:text-green-400' : value >= 0.4 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums', tone)}>{formatPercent(value)}</span>
}

export function StatCard({
  label,
  value,
  delta,
  to,
  hint,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  delta?: number
  to?: string
  hint?: string
  icon?: LucideIcon
}) {
  const inner = (
    <div className={cn('lift group relative overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5', to && 'cursor-pointer')}>
      {/* soft cobalt glow in the corner — intensifies on hover */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[var(--color-primary)]/10 opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-text-muted)]">{label}</p>
          <div className="mt-2.5 flex items-end gap-2">
            <span className="font-display text-[30px] font-bold leading-none tabular-nums text-[var(--color-text)]">{value}</span>
            {delta != null && (
              <span className={cn('mb-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold',
                delta >= 0 ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400')}>
                {delta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {Math.abs(delta)}%
              </span>
            )}
          </div>
          {hint && <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)]">{hint}</p>}
        </div>
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-primary)]/20 transition-colors group-hover:bg-[var(--color-primary)]/15">
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
      </div>
      {/* gradient underline that sweeps in on hover */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-signal)] transition-transform duration-300 group-hover:scale-x-100" />
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <h2 className="text-[16px] font-semibold text-[var(--color-text)]">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}
