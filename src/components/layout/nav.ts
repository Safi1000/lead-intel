import type { FeatureFlagKey } from '../../config/featureFlags'
import type { Role } from '../../api/types'
import type { Action, Resource } from '../../config/permissions'

export interface NavItem {
  label: string
  to: string
  icon: string // lucide icon name
  section?: string // sidebar group heading
  flag?: FeatureFlagKey // gated → shows "Soon" tag when off
  roles?: Role[] // when set, only these roles see the item
  perm?: { resource: Resource; action: Action } // when set, gated by the permission system (honors per-user overrides)
  orgContext?: boolean // only show when operating inside an org (SA must have entered one)
  primary?: boolean // highlighted CTA
}

// Order in which sidebar groups render.
export const NAV_SECTIONS = ['Overview', 'Work', 'Sales', 'Sourcing', 'Operations', 'Admin'] as const

const WORKERS_NAV: Role[] = ['superadmin', 'admin', 'manager', 'setter', 'closer', 'owner']
const OVERSEERS: Role[] = ['superadmin', 'manager', 'owner']
const OWNER: Role[] = ['superadmin', 'owner'] // §2: scrape + all-managers/teams views are owner-only

export const CLIENT_NAV: NavItem[] = [
  // Overview
  { label: 'Home', to: '/home', icon: 'LayoutDashboard', section: 'Overview', orgContext: true },
  { label: 'Cockpit', to: '/cockpit', icon: 'Gauge', section: 'Overview', roles: OWNER, orgContext: true },
  { label: 'Console', to: '/console', icon: 'LayoutGrid', section: 'Overview', roles: OVERSEERS, orgContext: true },
  // Work
  { label: 'Leads', to: '/leads', icon: 'Users', section: 'Work', orgContext: true },
  { label: 'Due Today', to: '/today', icon: 'CalendarClock', section: 'Work', roles: WORKERS_NAV, orgContext: true },
  { label: 'Meetings', to: '/bookings', icon: 'CalendarCheck', section: 'Work', flag: 'bookings', perm: { resource: 'bookings', action: 'view' }, orgContext: true },
  // Sales
  { label: 'Performance', to: '/performance', icon: 'BarChart3', section: 'Sales', roles: ['superadmin', 'admin', 'manager', 'setter', 'owner'], orgContext: true },
  { label: 'Deals', to: '/deals', icon: 'CircleDollarSign', section: 'Sales', roles: ['superadmin', 'admin', 'manager', 'closer', 'owner'], orgContext: true },
  // Sourcing
  { label: 'Sourcing', to: '/sourcing', icon: 'Zap', section: 'Sourcing', roles: OWNER, orgContext: true },
  { label: 'Import', to: '/import', icon: 'FileUp', section: 'Sourcing', perm: { resource: 'upload', action: 'create' }, orgContext: true },
  // Operations
  { label: 'Playbook', to: '/playbook', icon: 'FileText', section: 'Operations', roles: WORKERS_NAV, orgContext: true },
  { label: 'Activity', to: '/activity', icon: 'Activity', section: 'Operations', roles: OVERSEERS, orgContext: true },
  // Admin
  { label: 'People', to: '/people', icon: 'UserCog', section: 'Admin', perm: { resource: 'users', action: 'manage' }, orgContext: true },
  { label: 'Organizations', to: '/organizations', icon: 'Building2', section: 'Admin', roles: ['superadmin', 'admin'] },
  { label: 'Provider', to: '/provider', icon: 'Globe', section: 'Admin', roles: ['superadmin'] },
  // Client portal (external — clients see only this)
  { label: 'My Results', to: '/portal', icon: 'LayoutDashboard', roles: ['client'] },
]

export const CLIENT_NAV_BOTTOM: NavItem[] = [
  { label: 'Settings', to: '/settings', icon: 'Settings' },
]

export const ADMIN_NAV: NavItem[] = [
  { label: 'Clients', to: '/admin/clients', icon: 'Building2' },
  { label: 'Audit Log', to: '/admin/audit', icon: 'FileClock' },
]
