/** RBAC permission matrix. resource × action → allowed roles. */
import type { PermissionOverrides, Role } from '../api/types'

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'manage'
export type Resource =
  | 'templates' // lead-upload templates
  | 'upload' // manual lead import
  | 'leads' // the shared lead queue
  | 'users' // team / user management
  | 'account' // tenant account settings
  // Legacy resources referenced only by hidden (flag-gated) pages. Kept in the
  // type so those screens compile; intentionally absent from MATRIX → denied
  // for tenant roles until their phase is re-enabled.
  | 'billing'
  | 'webhooks'
  | 'apiKeys'
  | 'aiProviders'
  | 'branding'
  | 'marketLocks'

const TENANT_ALL: Role[] = ['manager', 'lead_generator', 'setter', 'closer']
const GENERATOR: Role[] = ['manager', 'lead_generator']
const WORKERS: Role[] = ['manager', 'setter', 'closer']

const MATRIX: Partial<Record<Resource, Partial<Record<Action, Role[]>>>> = {
  // Generators (and managers) build templates and upload leads.
  templates: { view: GENERATOR, create: GENERATOR, edit: GENERATOR, delete: ['manager'] },
  upload: { view: GENERATOR, create: GENERATOR },
  // Everyone sees the queue; setters/closers act on leads.
  leads: { view: TENANT_ALL, edit: WORKERS },
  // Only managers manage users and the account.
  users: { view: ['manager'], manage: ['manager'] },
  account: { view: TENANT_ALL, manage: ['manager'] },
}

export const permKey = (resource: Resource, action: Action) => `${resource}:${action}`

/** Effective permission check: SSA all-access, then per-user overrides, then role matrix. */
export function can(role: Role | null, action: Action, resource: Resource, overrides?: PermissionOverrides | null): boolean {
  if (!role) return false
  if (role === 'superadmin' || role === 'admin') return true
  const key = permKey(resource, action)
  if (overrides?.denied?.includes(key)) return false
  if (overrides?.granted?.includes(key)) return true
  const allowed = MATRIX[resource]?.[action]
  if (allowed && allowed.includes(role)) return true
  // Being able to upload leads implies viewing templates (needed to pick one).
  if (resource === 'templates' && action === 'view') return can(role, 'create', 'upload', overrides)
  return false
}

/** Whether the role grants this permission by default (before overrides) — used to seed the toggles UI. */
export function roleGrants(role: Role, action: Action, resource: Resource): boolean {
  if (role === 'superadmin' || role === 'admin') return true
  return MATRIX[resource]?.[action]?.includes(role) ?? false
}

/** Toggle-able permissions shown in the user-management UI. */
export const PERMISSION_CATALOG: { resource: Resource; action: Action; label: string }[] = [
  { resource: 'templates', action: 'create', label: 'Create & edit upload templates' },
  { resource: 'templates', action: 'delete', label: 'Delete templates' },
  { resource: 'upload', action: 'create', label: 'Upload leads' },
  { resource: 'leads', action: 'view', label: 'View the lead queue' },
  { resource: 'leads', action: 'edit', label: 'Work leads (remarks, status, warm/cold)' },
  { resource: 'users', action: 'manage', label: 'Manage users in the org' },
]

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  lead_generator: 'Lead Generator',
  setter: 'Setter',
  closer: 'Closer',
}

export const ROLE_CAPABILITIES: Record<Role, string> = {
  superadmin: 'Full internal platform access.',
  admin: 'Internal monitoring, client oversight, audit.',
  manager: 'Manages users and oversees the full lead pipeline.',
  lead_generator: 'Creates upload templates and imports leads.',
  setter: 'Tests and calls leads, leaves remarks, sets warm/cold.',
  closer: 'Closes, holds, or returns leads; sets warm/cold.',
}
