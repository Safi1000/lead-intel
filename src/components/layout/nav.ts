import type { FeatureFlagKey } from '../../config/featureFlags'
import type { Role } from '../../api/types'
import type { Action, Resource } from '../../config/permissions'

export interface NavItem {
  label: string
  to: string
  icon: string // lucide icon name
  flag?: FeatureFlagKey // gated → shows "Soon" tag when off
  roles?: Role[] // when set, only these roles see the item
  perm?: { resource: Resource; action: Action } // when set, gated by the permission system (honors per-user overrides)
  orgContext?: boolean // only show when operating inside an org (SA must have entered one)
  primary?: boolean // highlighted CTA
}

// Phase 1 manual workflow. The org-workspace items only appear when inside an
// org (managers always are; the SA enters via the Organizations list).
const WORKERS_NAV: Role[] = ['superadmin', 'admin', 'manager', 'setter', 'closer']
export const CLIENT_NAV: NavItem[] = [
  { label: 'Home', to: '/home', icon: 'LayoutDashboard', orgContext: true },
  { label: 'Cockpit', to: '/cockpit', icon: 'Gauge', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Console', to: '/console', icon: 'LayoutDashboard', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Due Today', to: '/today', icon: 'CalendarClock', roles: WORKERS_NAV, orgContext: true },
  { label: 'Progress', to: '/progress', icon: 'Target', roles: ['superadmin', 'admin', 'manager', 'setter'], orgContext: true },
  { label: 'Activity', to: '/activity', icon: 'Activity', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Performance', to: '/performance', icon: 'BarChart3', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Targets', to: '/targets', icon: 'Target', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Teams', to: '/teams', icon: 'Users2', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Audit Log', to: '/audit-log', icon: 'FileClock', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Deals', to: '/deals', icon: 'CircleDollarSign', roles: ['superadmin', 'admin', 'manager', 'closer'], orgContext: true },
  { label: 'Scripts', to: '/scripts', icon: 'FileText', roles: WORKERS_NAV, orgContext: true },
  { label: 'Leads', to: '/leads', icon: 'Users', orgContext: true },
  { label: 'Meetings', to: '/bookings', icon: 'CalendarCheck', flag: 'bookings', perm: { resource: 'bookings', action: 'view' }, orgContext: true },
  { label: 'Book a meeting', to: '/bookings/new', icon: 'CalendarPlus', flag: 'bookings', perm: { resource: 'bookings', action: 'create' }, orgContext: true },
  { label: 'Templates', to: '/templates', icon: 'FileSpreadsheet', perm: { resource: 'templates', action: 'view' }, orgContext: true },
  { label: 'Upload', to: '/upload', icon: 'FileUp', perm: { resource: 'upload', action: 'create' }, orgContext: true, primary: true },
  { label: 'Pipeline', to: '/pipeline', icon: 'Zap', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Discovery', to: '/discovery', icon: 'Calculator', roles: ['superadmin', 'manager'], orgContext: true },
  { label: 'Users', to: '/users', icon: 'UserCog', perm: { resource: 'users', action: 'manage' }, orgContext: true },
  { label: 'Organizations', to: '/organizations', icon: 'Building2', roles: ['superadmin', 'admin'] },
  { label: 'Provider', to: '/provider', icon: 'Globe', roles: ['superadmin'] },
  { label: 'My Results', to: '/portal', icon: 'LayoutDashboard', roles: ['client'] },
]

export const CLIENT_NAV_BOTTOM: NavItem[] = [
  { label: 'Settings', to: '/settings', icon: 'Settings' },
]

export const ADMIN_NAV: NavItem[] = [
  { label: 'Clients', to: '/admin/clients', icon: 'Building2' },
  { label: 'Audit Log', to: '/admin/audit', icon: 'FileClock' },
]
