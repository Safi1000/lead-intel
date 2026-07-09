/** Shared metadata + helpers for the manual lead workflow (status pipeline). */
import type { LeadStage, Role } from '../../api/types'
import { LEAD_STAGES } from '../../api/types'

export const STAGE_ORDER: LeadStage[] = LEAD_STAGES

/** Colour-coded chip styling per pipeline stage (Feature 1). */
export const STAGE_META: Record<LeadStage, { label: string; className: string; dot: string }> = {
  New: { label: 'New', className: 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]', dot: 'bg-slate-400' },
  Contacted: { label: 'Contacted', className: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] dark:text-[var(--color-primary)]', dot: 'bg-[var(--color-primary)]' },
  Interested: { label: 'Interested', className: 'bg-violet-500/10 text-violet-700 dark:text-violet-400', dot: 'bg-violet-500' },
  Booked: { label: 'Booked', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  Voicemail: { label: 'Voicemail', className: 'bg-orange-500/10 text-orange-700 dark:text-orange-400', dot: 'bg-orange-500' },
  'Follow-up': { label: 'Follow-up', className: 'bg-teal-500/10 text-teal-700 dark:text-teal-400', dot: 'bg-teal-500' },
}

export const isManagerRole = (role: Role | null) => role === 'manager' || role === 'admin' || role === 'superadmin' || role === 'owner'

/** Whether `role` can work leads: edit stage, log activity, leave remarks. */
export function canWorkLeads(role: Role | null): boolean {
  return role === 'setter' || role === 'closer' || isManagerRole(role)
}

/**
 * Stage options a `role` may set on a lead.
 * Setters/managers drive the full pipeline; closers update the outcome after the call.
 */
export function stageOptionsFor(_role: Role | null, _current: LeadStage): LeadStage[] {
  return STAGE_ORDER
}

/** A follow-up date strictly before today is overdue. */
export function isOverdue(date: string | null): boolean {
  if (!date) return false
  return date < new Date().toISOString().slice(0, 10)
}

export function isDueToday(date: string | null): boolean {
  if (!date) return false
  return date === new Date().toISOString().slice(0, 10)
}
