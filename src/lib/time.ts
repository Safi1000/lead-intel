import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value
}

/** Relative time ("2m ago") for display (§18-9). */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  try {
    return formatDistanceToNowStrict(toDate(value), { addSuffix: true })
  } catch {
    return '—'
  }
}

/** Absolute time, shown on hover. */
export function absoluteTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  try {
    return format(toDate(value), "MMM d, yyyy 'at' h:mm a")
  } catch {
    return '—'
  }
}

export function shortDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  try {
    return format(toDate(value), 'MMM d, yyyy')
  } catch {
    return '—'
  }
}

/** Format seconds remaining as ~hh:mm / ~Nm. */
export function etaLabel(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `~${h}h ${m}m`
  return `~${m}m`
}
