import { Card } from '../../components/ui/primitives'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import { HOLIDAY_CALENDAR, type Holiday } from './pace'

const REGION_STYLE: Record<Holiday['region'], string> = {
  US: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  CA: 'bg-red-500/10 text-red-600 dark:text-red-400',
  'US+CA': 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]',
}

const utc = (d: string) => new Date(`${d}T00:00:00Z`)
const longDate = (d: string) => utc(d).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', timeZone: 'UTC' })
const monShort = (d: string) => utc(d).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })

/** §8 Holiday calendar — US + Canada national holidays excluded from the pace working-days denominator. */
export function HolidaysPage() {
  const today = new Date().toISOString().slice(0, 10)
  const year = HOLIDAY_CALENDAR[0]?.date.slice(0, 4) ?? ''

  return (
    <div className="reveal max-w-2xl">
      <PageHeader title="Holiday calendar" subtitle={`US + Canada national holidays for ${year}, excluded from pace targets.`} />

      <Card className="mb-4 p-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        These national holidays are removed from the working-days denominator, so pace-to-target isn't
        penalised on days the US / Canada market is closed. Per-state holidays aren't tracked, and Pakistan
        holidays affect attendance KPIs only — never the pace math.
      </Card>

      <Card className="divide-y divide-[var(--color-border)]">
        {HOLIDAY_CALENDAR.map((h) => {
          const past = h.date < today
          return (
            <div key={h.date} className={cn('flex items-center justify-between gap-3 px-5 py-3 transition-opacity', past && 'opacity-45')}>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] bg-[var(--color-surface-2)]">
                  <span className="text-[16px] font-bold leading-none tabular-nums">{h.date.slice(8)}</span>
                  <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{monShort(h.date)}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-medium">{h.name}</p>
                  <p className="text-[12px] text-[var(--color-text-muted)]">{longDate(h.date)}</p>
                </div>
              </div>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', REGION_STYLE[h.region])}>{h.region}</span>
            </div>
          )
        })}
      </Card>
    </div>
  )
}
