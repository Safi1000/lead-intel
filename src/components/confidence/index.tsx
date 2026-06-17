import * as React from 'react'
import { ExternalLink, Copy, Check } from 'lucide-react'
import { CONFIDENCE, type ConfidenceStatus } from '../../config/constants'
import { cn } from '../../lib/utils'
import { Tooltip } from '../ui/controls'
import type { LeadField } from '../../api/types'

/** 8px dot for dense table cells. Color + aria-label (never color-only). */
export function ConfidenceDot({
  status,
  className,
}: {
  status: ConfidenceStatus
  className?: string
}) {
  const meta = CONFIDENCE[status]
  return (
    <span
      role="img"
      aria-label={meta.label}
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', meta.dotClass, className)}
    />
  )
}

/** Pill with dot + text label for detail views. */
export function ConfidenceBadge({ status }: { status: ConfidenceStatus }) {
  const meta = CONFIDENCE[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium',
        meta.badgeClass,
      )}
    >
      <ConfidenceDot status={status} />
      {meta.label}
    </span>
  )
}

/** Source link → opens URL in new tab, or shows source name as tooltip. */
export function SourceLink({
  source,
  url,
}: {
  source: string | null
  url?: string | null
}) {
  if (!source) return null
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[12px] text-[var(--color-primary)] hover:underline"
      >
        {source}
        <ExternalLink className="h-3 w-3" />
      </a>
    )
  }
  return (
    <Tooltip content={`Source: ${source}`}>
      <span className="cursor-help text-[12px] text-[var(--color-text-muted)] underline decoration-dotted">
        {source}
      </span>
    </Tooltip>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      aria-label="Copy"
      className="rounded p-1 text-[var(--color-text-muted)] hover:bg-slate-100 hover:text-[var(--color-text)]"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

/** Field row: label, value (or explicit "Not found"), badge, source, copy. */
export function FieldRow({
  label,
  field,
  href,
}: {
  label: string
  field: LeadField
  href?: string
}) {
  const missing = field.status === 'missing'
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--color-border)] py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {missing ? (
          <Tooltip content={field.reason ?? undefined}>
            <span className="text-sm italic text-[var(--color-text-muted)]">Not found</span>
          </Tooltip>
        ) : href ? (
          <a href={href} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
            {field.value}
          </a>
        ) : (
          <span className="text-sm font-medium text-[var(--color-text)]">{field.value}</span>
        )}
        {!missing && field.value && <CopyButton value={field.value} />}
        <ConfidenceBadge status={field.confidence} />
        <SourceLink source={field.source} url={field.source_url} />
      </div>
    </div>
  )
}

/** Cell renderer for the lead table: value + dot, muted "—" when missing. */
export function FieldCell({ field }: { field: LeadField }) {
  if (field.status === 'missing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
        <ConfidenceDot status="missing" />—
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <ConfidenceDot status={field.confidence} />
      <span className="truncate">{field.value}</span>
    </span>
  )
}

const LEGEND: ConfidenceStatus[] = ['verified', 'probable', 'unverified', 'missing']
export function ConfidenceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--color-text-secondary)]">
      {LEGEND.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <ConfidenceDot status={s} />
          {CONFIDENCE[s].label}
        </span>
      ))}
    </div>
  )
}

/** Map a confidence status to the row left-border color token. */
export function rowBorderColor(status: ConfidenceStatus): string {
  return {
    verified: 'var(--c-verified)',
    probable: 'var(--c-probable)',
    unverified: 'var(--c-unverified)',
    missing: 'var(--c-missing)',
  }[status]
}
