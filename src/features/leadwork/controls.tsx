import { format } from 'date-fns'
import * as RSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import { STAGE_META, isOverdue, isDueToday, stageOptionsFor } from './workflow'
import type { LeadStage } from '../../api/types'

/** Read-only coloured stage chip. */
export function StageBadge({ stage, className }: { stage: LeadStage; className?: string }) {
  const m = STAGE_META[stage]
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium', m.className, className)}><span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} /> {m.label}</span>
}

/** One-click editable stage dropdown (Feature 1) — themed popover with a coloured pill
 * trigger. Falls back to a static chip when disabled. */
export function StageSelect({ stage, role, disabled, onChange }: { stage: LeadStage; role: string | null; disabled?: boolean; onChange: (s: LeadStage) => void }) {
  if (disabled) return <StageBadge stage={stage} />
  const opts = stageOptionsFor(role as never, stage)
  const m = STAGE_META[stage]
  return (
    <RSelect.Root value={stage} onValueChange={(v) => onChange(v as LeadStage)}>
      <RSelect.Trigger
        onClick={(e) => e.stopPropagation()}
        aria-label="Stage"
        className={cn(
          'inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[12px] font-medium outline-none ring-1 ring-inset ring-black/5 transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] data-[state=open]:ring-2 data-[state=open]:ring-[var(--color-primary)]',
          m.className,
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
        <RSelect.Value />
        <RSelect.Icon><ChevronDown className="h-3.5 w-3.5 opacity-70" /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          className="dialog-in z-50 min-w-[9rem] overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]"
        >
          <RSelect.Viewport>
            {opts.map((s) => {
              const sm = STAGE_META[s]
              return (
                <RSelect.Item
                  key={s}
                  value={s}
                  className="relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-2.5 pr-8 text-[13px] text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-surface-2)] data-[state=checked]:font-medium"
                >
                  <span className={cn('h-2 w-2 rounded-full', sm.dot)} />
                  <RSelect.ItemText>{sm.label}</RSelect.ItemText>
                  <RSelect.ItemIndicator className="absolute right-2.5"><Check className="h-4 w-4 text-[var(--color-primary)]" /></RSelect.ItemIndicator>
                </RSelect.Item>
              )
            })}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}

/** Follow-up date cell with overdue (red) / due-today (amber) flagging (Feature 2). */
export function FollowUpCell({ value, disabled, onChange }: { value: string | null; disabled?: boolean; onChange: (d: string | null) => void }) {
  const overdue = isOverdue(value)
  const due = isDueToday(value)
  if (disabled) {
    if (!value) return <span className="text-[var(--color-text-muted)]">—</span>
    return <span className={cn('text-[13px]', overdue ? 'font-medium text-red-600 dark:text-red-400' : due ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-[var(--color-text-secondary)]')}>{format(new Date(value), 'd MMM')}</span>
  }
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      onClick={(e) => e.stopPropagation()}
      className={cn('h-7 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 text-[12px]',
        overdue ? 'border-red-300 text-red-600 dark:text-red-400' : due ? 'border-amber-300 text-amber-700 dark:text-amber-400' : '')}
    />
  )
}
