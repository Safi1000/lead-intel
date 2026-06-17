/** RBAC permission matrix (§I-4). resource × action → allowed roles. */
import type { Role } from '../api/types'

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'manage'
export type Resource =
  | 'runs'
  | 'leads'
  | 'notes'
  | 'exports'
  | 'billing'
  | 'team'
  | 'integrations'
  | 'apiKeys'
  | 'webhooks'
  | 'marketLocks'
  | 'aiProviders'
  | 'branding'
  | 'campaigns'
  | 'account'
  | 'reseller'

const ALL_CLIENT: Role[] = ['client_owner', 'client_admin', 'client_member', 'client_billing']
const OWNER_ADMIN: Role[] = ['client_owner', 'client_admin']
const BILLING_ROLES: Role[] = ['client_owner', 'client_billing']

const MATRIX: Record<Resource, Partial<Record<Action, Role[]>>> = {
  runs: { view: ALL_CLIENT, create: OWNER_ADMIN, edit: OWNER_ADMIN, delete: OWNER_ADMIN },
  leads: { view: ALL_CLIENT, edit: ALL_CLIENT },
  notes: { view: ALL_CLIENT, create: ALL_CLIENT, edit: ALL_CLIENT, delete: OWNER_ADMIN },
  exports: { view: ALL_CLIENT, create: ALL_CLIENT },
  billing: { view: BILLING_ROLES, manage: BILLING_ROLES },
  team: { view: OWNER_ADMIN, manage: OWNER_ADMIN },
  integrations: { view: OWNER_ADMIN, manage: OWNER_ADMIN },
  apiKeys: { view: OWNER_ADMIN, manage: OWNER_ADMIN },
  webhooks: { view: OWNER_ADMIN, manage: OWNER_ADMIN },
  marketLocks: { view: ALL_CLIENT, manage: BILLING_ROLES },
  aiProviders: { view: OWNER_ADMIN, manage: OWNER_ADMIN },
  branding: { view: OWNER_ADMIN, manage: ['client_owner'] },
  campaigns: { view: ALL_CLIENT, create: OWNER_ADMIN, manage: OWNER_ADMIN },
  account: { view: ALL_CLIENT, manage: ['client_owner'] },
  reseller: { view: ['client_owner'], manage: ['client_owner'] },
}

export function can(role: Role | null, action: Action, resource: Resource): boolean {
  if (!role) return false
  if (role === 'superadmin' || role === 'admin') return true
  const allowed = MATRIX[resource]?.[action]
  return allowed ? allowed.includes(role) : false
}

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  client_owner: 'Owner',
  client_admin: 'Admin',
  client_member: 'Member',
  client_billing: 'Billing',
}

export const ROLE_CAPABILITIES: Record<Role, string> = {
  superadmin: 'Full internal platform access.',
  admin: 'Internal monitoring, overrides, audit.',
  client_owner: 'Everything, including billing, team, and account ownership.',
  client_admin: 'All features except ownership transfer and account closure.',
  client_member: 'View runs/leads, add notes & tags, export.',
  client_billing: 'Billing and invoices only, plus read access.',
}
