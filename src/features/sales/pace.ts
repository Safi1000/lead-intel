/**
 * Pace engine (§8). Pace-to-target = attained vs expected-by-now, weighted by working days elapsed.
 * Denominator excludes weekends + national holidays for the target markets (US + Canada, national
 * only — not per-state, per Safi). Mid-period target changes prorate FORWARD from the change.
 *
 * Dates are handled as YYYY-MM-DD in the target market's calendar (not the rep's PKT clock — pace is
 * about the market's working days, per §8). Callers pass plain date strings.
 */

/** A single statutory holiday excluded from the pace working-days denominator. */
export interface Holiday { date: string; name: string; region: 'US' | 'CA' | 'US+CA' }

/** Combined US-federal + Canada-national statutory holidays (single source of truth — drives both the
 *  pace math and the Holidays screen). Extend per year as needed. */
export const HOLIDAY_CALENDAR: Holiday[] = [
  { date: '2026-01-01', name: "New Year's Day", region: 'US+CA' },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day', region: 'US' },
  { date: '2026-02-16', name: "Presidents' Day", region: 'US' },
  { date: '2026-04-03', name: 'Good Friday', region: 'CA' },
  { date: '2026-05-18', name: 'Victoria Day', region: 'CA' },
  { date: '2026-05-25', name: 'Memorial Day', region: 'US' },
  { date: '2026-06-19', name: 'Juneteenth', region: 'US' },
  { date: '2026-07-01', name: 'Canada Day', region: 'CA' },
  { date: '2026-07-03', name: 'Independence Day (observed)', region: 'US' },
  { date: '2026-09-07', name: 'Labor / Labour Day', region: 'US+CA' },
  { date: '2026-09-30', name: 'Truth & Reconciliation', region: 'CA' },
  { date: '2026-10-12', name: 'Columbus Day (US) / Thanksgiving (CA)', region: 'US+CA' },
  { date: '2026-11-11', name: 'Veterans Day (US) / Remembrance Day (CA)', region: 'US+CA' },
  { date: '2026-11-26', name: 'Thanksgiving (US)', region: 'US' },
  { date: '2026-12-25', name: 'Christmas', region: 'US+CA' },
  { date: '2026-12-26', name: 'Boxing Day', region: 'CA' },
]

const HOLIDAYS: Record<number, string[]> = HOLIDAY_CALENDAR.reduce((acc, h) => {
  const y = Number(h.date.slice(0, 4))
  ;(acc[y] ??= []).push(h.date)
  return acc
}, {} as Record<number, string[]>)

function holidaySet(year: number): Set<string> {
  return new Set(HOLIDAYS[year] ?? [])
}

/** Parse YYYY-MM-DD to a UTC date (avoids TZ drift in day math). */
function parse(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Mon–Fri and not a US/CA national holiday. */
export function isWorkingDay(iso: string): boolean {
  const d = parse(iso)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  if (dow === 0 || dow === 6) return false
  return !holidaySet(d.getUTCFullYear()).has(fmt(d))
}

/** Count working days in [startISO, endISO] inclusive. */
export function workingDaysBetween(startISO: string, endISO: string): number {
  let count = 0
  const end = parse(endISO)
  for (let d = parse(startISO); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (isWorkingDay(fmt(d))) count++
  }
  return count
}

/** First and last calendar day of the month containing `iso`. */
export function monthPeriod(iso: string): { start: string; end: string } {
  const d = parse(iso)
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  return { start: fmt(new Date(Date.UTC(y, m, 1))), end: fmt(new Date(Date.UTC(y, m + 1, 0))) }
}

/** The target value in effect on a given day, given the change history (earliest first). */
function activeValue(dayISO: string, changes: Array<{ at: string; value: number }>): number {
  let v = changes[0]?.value ?? 0
  for (const c of changes) { if (c.at.slice(0, 10) <= dayISO) v = c.value; else break }
  return v
}

/**
 * Expected attainment by `asOf`, prorated forward across any mid-period target changes.
 * `changes` must be sorted earliest-first and include the initial target as the first entry.
 */
export function paceExpected(
  changes: Array<{ at: string; value: number }>,
  periodStart: string,
  periodEnd: string,
  asOf: string,
): number {
  const totalWD = workingDaysBetween(periodStart, periodEnd)
  if (totalWD === 0 || changes.length === 0) return 0
  const end = parse(asOf) < parse(periodEnd) ? asOf : periodEnd
  let sum = 0
  for (let d = parse(periodStart); d <= parse(end); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = fmt(d)
    if (isWorkingDay(day)) sum += activeValue(day, changes)
  }
  return sum / totalWD
}

/** Convenience: single fixed target (no mid-period change). */
export function expectedByNow(targetValue: number, periodStart: string, periodEnd: string, asOf: string): number {
  return paceExpected([{ at: periodStart, value: targetValue }], periodStart, periodEnd, asOf)
}

export type PaceStatus = 'on_pace' | 'slipping' | 'behind'
/** Green if ≥100% of expected, amber if ≥85%, else red. */
export function paceStatus(attained: number, expected: number): PaceStatus {
  if (expected <= 0) return 'on_pace'
  const ratio = attained / expected
  return ratio >= 1 ? 'on_pace' : ratio >= 0.85 ? 'slipping' : 'behind'
}
/** Blended dot = worse of the two metrics (§8: can't hide a missed count behind revenue). */
export function blendedStatus(a: PaceStatus, b: PaceStatus): PaceStatus {
  const rank: Record<PaceStatus, number> = { behind: 0, slipping: 1, on_pace: 2 }
  return rank[a] <= rank[b] ? a : b
}
