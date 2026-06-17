import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware className combiner used by every UI primitive. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** USD money formatter (§18-8). Never hardcode currency formatting elsewhere. */
export function formatMoney(
  cents: number | null | undefined,
  opts: { fromCents?: boolean } = {},
): string {
  if (cents == null) return '—'
  const value = opts.fromCents === false ? cents : cents / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio == null) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max)
}
