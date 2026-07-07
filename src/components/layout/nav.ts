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

export const CLIENT_NAV: NavItem[] = [
  // Overview
  { label: 'Home', to: '/home', icon: 'LayoutDashboard', section: 'Overview', orgContext: true },
  { label: 'Cockpit', to: '/cockpit', icon: 'Gauge', section: 'Overview', roles: OVERSEERS, orgContext: true },
  { label: 'Console', to: '/console', icon: 'LayoutGrid', section: 'Overview', roles: OVERSEERS, orgContext: true },
  // Work
  { label: 'Leads', to: '/leads', icon: 'Users', section: 'Work', orgContext: true },
  { label: 'Due Today', to: '/today', icon: 'CalendarClock', section: 'Work', roles: WORKERS_NAV, orgContext: true },
  { label: 'Progress', to: '/progress', icon: 'Target', section: 'Work', roles: ['superadmin', 'admin', 'manager', 'setter', 'owner'], orgContext: true },
  { label: 'Meetings', to: '/bookings', icon: 'CalendarCheck', section: 'Work', flag: 'bookings', perm: { resource: 'bookings', action: 'view' }, orgContext: true },
  { label: 'Book a meeting', to: '/bookings/new', icon: 'CalendarPlus', section: 'Work', flag: 'bookings', perm: { resource: 'bookings', action: 'create' }, orgContext: true },
  // Sales
  { label: 'Performance', to: '/performance', icon: 'BarChart3', section: 'Sales', roles: OVERSEERS, orgContext: true },
  { label: 'Targets', to: '/targets', icon: 'Crosshair', section: 'Sales', roles: OVERSEERS, orgContext: true },
  { label: 'Holidays', to: '/holidays', icon: 'CalendarDays', section: 'Sales', roles: OVERSEERS, orgContext: true },
  { label: 'Deals', to: '/deals', icon: 'CircleDollarSign', section: 'Sales', roles: ['superadmin', 'admin', 'manager', 'closer', 'owner'], orgContext: true },
  { label: 'Teams', to: '/teams', icon: 'Users2', section: 'Sales', roles: OVERSEERS, orgContext: true },
  // Sourcing
  { label: 'Pipeline', to: '/pipeline', icon: 'Zap', section: 'Sourcing', roles: OVERSEERS, orgContext: true },
  { label: 'Discovery', to: '/discovery', icon: 'Calculator', section: 'Sourcing', roles: OVERSEERS, orgContext: true },
  { label: 'Templates', to: '/templates', icon: 'FileSpreadsheet', section: 'Sourcing', perm: { resource: 'templates', action: 'view' }, orgContext: true },
  { label: 'Upload', to: '/upload', icon: 'FileUp', section: 'Sourcing', perm: { resource: 'upload', action: 'create' }, orgContext: true, primary: true },
  // Operations
  { label: 'Activity', to: '/activity', icon: 'Activity', section: 'Operations', roles: OVERSEERS, orgContext: true },
  { label: 'Audit Log', to: '/audit-log', icon: 'FileClock', section: 'Operations', roles: OVERSEERS, orgContext: true },
  { label: 'Scripts', to: '/scripts', icon: 'FileText', section: 'Operations', roles: WORKERS_NAV, orgContext: true },
  // Admin
  { label: 'Users', to: '/users', icon: 'UserCog', section: 'Admin', perm: { resource: 'users', action: 'manage' }, orgContext: true },
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
