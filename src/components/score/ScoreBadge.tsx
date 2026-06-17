import { Flame } from 'lucide-react'
import { cn } from '../../lib/utils'

/** Pure score components (§score/). No data — safe to reuse in tables and headers. */

type Band = { color: string; tint: string }

function band(score: number): Band {
  if (score >= 70) return { color: 'var(--score-hot)', tint: 'rgba(225, 29, 72, 0.12)' }
  if (score >= 40) return { color: 'var(--score-warm)', tint: 'rgba(245, 158, 11, 0.12)' }
  return { color: 'var(--score-cold)', tint: 'rgba(100, 116, 139, 0.12)' }
}

export function ScoreBadge({ score, hot }: { score: number | null; hot?: boolean }) {
  if (score == null) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium text-[var(--color-text-muted)]">
        —
      </span>
    )
  }
  const { color, tint } = band(score)
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium"
      style={{ backgroundColor: tint, color }}
    >
      {hot && <Flame className="h-3 w-3" aria-hidden />}
      <span className="font-data tabular-nums font-bold">{Math.round(score)}</span>
    </span>
  )
}

export function HotFlag({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold', className)}
      style={{ backgroundColor: 'rgba(225, 29, 72, 0.12)', color: 'var(--score-hot)' }}
    >
      <Flame className="h-3 w-3" aria-hidden /> Hot
    </span>
  )
}
