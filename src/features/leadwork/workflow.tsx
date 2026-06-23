/** Shared metadata + transition logic for the manual lead workflow. */
import { Flame, Snowflake } from 'lucide-react'
import type { LeadStatus, ManualLead, Role } from '../../api/types'

export const STATUS_META: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-slate-100 text-slate-600' },
  with_setter: { label: 'With setter', className: 'bg-blue-50 text-blue-700' },
  with_closer: { label: 'With closer', className: 'bg-violet-50 text-violet-700' },
  open: { label: 'Open', className: 'bg-amber-50 text-amber-700' },
  closed: { label: 'Closed', className: 'bg-green-50 text-green-700' },
  returned: { label: 'Returned', className: 'bg-orange-50 text-orange-700' },
}

export const STATUS_ORDER: LeadStatus[] = ['new', 'with_setter', 'with_closer', 'open', 'returned', 'closed']

export const TEMP_META: Record<'warm' | 'cold', { label: string; className: string; icon: typeof Flame }> = {
  warm: { label: 'Warm', className: 'bg-red-50 text-red-600', icon: Flame },
  cold: { label: 'Cold', className: 'bg-sky-50 text-sky-600', icon: Snowflake },
}

export type LeadPatch = Partial<{ status: LeadStatus; setter: string | null; closer: string | null }>

export interface WorkflowAction {
  key: string
  label: string
  variant: 'primary' | 'outline' | 'danger'
  patch: LeadPatch
}

export const isManagerRole = (role: Role | null) => role === 'manager' || role === 'admin' || role === 'superadmin'

/**
 * Status-changing actions available to `role` on `lead`.
 * Distribution is manager-driven: setters/closers receive leads via assignment,
 * they don't self-claim from a pool.
 */
export function actionsFor(role: Role | null, lead: ManualLead): WorkflowAction[] {
  const manager = isManagerRole(role)
  const out: WorkflowAction[] = []

  // Closer lane — works leads a manager routed to them.
  if (role === 'closer' || manager) {
    if (lead.status === 'with_closer') {
      out.push({ key: 'take', label: 'Take lead', variant: 'primary', patch: { status: 'open' } })
    }
    if (lead.status === 'with_closer' || lead.status === 'open') {
      out.push({ key: 'close', label: 'Mark closed', variant: 'primary', patch: { status: 'closed' } })
      out.push({ key: 'return', label: 'Return to setter', variant: 'outline', patch: { status: 'returned' } })
    }
    if (manager && (lead.status === 'closed' || lead.status === 'returned')) {
      out.push({ key: 'reopen', label: 'Re-open', variant: 'outline', patch: { status: 'open' } })
    }
  }

  return out
}

/** Whether `role` can leave remarks on leads. */
export function canWorkLeads(role: Role | null): boolean {
  return role === 'setter' || role === 'closer' || isManagerRole(role)
}

/** Whether `role` can mark leads warm/cold (setters classify; managers may override). */
export function canClassify(role: Role | null): boolean {
  return role === 'setter' || isManagerRole(role)
}
