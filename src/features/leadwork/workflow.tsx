/** Shared metadata + helpers for the manual lead workflow (status pipeline). */
import type { LeadStage, Role } from '../../api/types'
import { LEAD_STAGES } from '../../api/types'

export const STAGE_ORDER: LeadStage[] = LEAD_STAGES

/** Colour-coded chip styling per pipeline stage (Feature 1). */
export const STAGE_META: Record<LeadStage, { label: string; className: string; dot: string }> = {
  New: { label: 'New', className: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  Contacted: { label: 'Contacted', className: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  Interested: { label: 'Interested', className: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
  Booked: { label: 'Booked', className: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  'Not Now': { label: 'Not Now', className: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  Won: { label: 'Won', className: 'bg-green-50 text-green-700', dot: 'bg-green-500' },
  Lost: { label: 'Lost', className: 'bg-red-50 text-red-600', dot: 'bg-red-500' },
}

export const isManagerRole = (role: Role | null) => role === 'manager' || role === 'admin' || role === 'superadmin'

/** Whether `role` can work leads: edit stage, log activity, leave remarks. */
export function canWorkLeads(role: Role | null): boolean {
  return role === 'setter' || role === 'closer' || isManagerRole(role)
}

/**
 * Stage options a `role` may set on a lead.
 * Setters/managers drive the full pipeline; closers update the outcome after the call.
 */
export function stageOptionsFor(role: Role | null, current: LeadStage): LeadStage[] {
  if (role === 'closer') {
    const allowed: LeadStage[] = ['Booked', 'Won', 'Lost', 'Not Now']
    return allowed.includes(current) ? allowed : [current, ...allowed]
  }
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
