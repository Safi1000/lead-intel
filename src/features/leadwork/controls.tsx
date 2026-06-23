import { format } from 'date-fns'
import { cn } from '../../lib/utils'
import { STAGE_META, isOverdue, isDueToday, stageOptionsFor } from './workflow'
import type { LeadStage } from '../../api/types'

/** Read-only coloured stage chip. */
export function StageBadge({ stage, className }: { stage: LeadStage; className?: string }) {
  const m = STAGE_META[stage]
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium', m.className, className)}><span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} /> {m.label}</span>
}

/** One-click editable stage dropdown (Feature 1). Falls back to a chip when disabled. */
export function StageSelect({ stage, role, disabled, onChange }: { stage: LeadStage; role: string | null; disabled?: boolean; onChange: (s: LeadStage) => void }) {
  if (disabled) return <StageBadge stage={stage} />
  const opts = stageOptionsFor(role as never, stage)
  const m = STAGE_META[stage]
  return (
    <select
      value={stage}
      onChange={(e) => onChange(e.target.value as LeadStage)}
      onClick={(e) => e.stopPropagation()}
      className={cn('h-7 cursor-pointer rounded-full border-0 px-2.5 text-[12px] font-medium outline-none ring-1 ring-inset ring-black/5 focus:ring-2 focus:ring-[var(--color-primary)]', m.className)}
    >
      {opts.map((s) => <option key={s} value={s} className="bg-white text-[var(--color-text)]">{STAGE_META[s].label}</option>)}
    </select>
  )
}

/** Follow-up date cell with overdue (red) / due-today (amber) flagging (Feature 2). */
export function FollowUpCell({ value, disabled, onChange }: { value: string | null; disabled?: boolean; onChange: (d: string | null) => void }) {
  const overdue = isOverdue(value)
  const due = isDueToday(value)
  if (disabled) {
    if (!value) return <span className="text-[var(--color-text-muted)]">—</span>
    return <span className={cn('text-[13px]', overdue ? 'font-medium text-red-600' : due ? 'font-medium text-amber-600' : 'text-[var(--color-text-secondary)]')}>{format(new Date(value), 'd MMM')}</span>
  }
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      onClick={(e) => e.stopPropagation()}
      className={cn('h-7 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 text-[12px]',
        overdue ? 'border-red-300 text-red-600' : due ? 'border-amber-300 text-amber-700' : '')}
    />
  )
}
