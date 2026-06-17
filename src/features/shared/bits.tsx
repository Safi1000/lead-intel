import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
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
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-200', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  )
}

export function FillChip({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[var(--color-text-muted)]">—</span>
  const tone = value >= 0.7 ? 'bg-green-50 text-green-700' : value >= 0.4 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums', tone)}>{formatPercent(value)}</span>
}

export function StatCard({
  label,
  value,
  delta,
  to,
  hint,
}: {
  label: string
  value: React.ReactNode
  delta?: number
  to?: string
  hint?: string
}) {
  const inner = (
    <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-shadow hover:shadow-md">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-[28px] font-bold tabular-nums leading-none text-[var(--color-text)]">{value}</span>
        {delta != null && (
          <span className={cn('flex items-center gap-0.5 text-[13px] font-medium', delta >= 0 ? 'text-[var(--c-verified)]' : 'text-[var(--c-unverified)]')}>
            {delta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{hint}</p>}
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
