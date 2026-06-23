import type { FeatureFlagKey } from '../../config/featureFlags'
import type { Role } from '../../api/types'

export interface NavItem {
  label: string
  to: string
  icon: string // lucide icon name
  flag?: FeatureFlagKey // gated → shows "Soon" tag when off
  roles?: Role[] // when set, only these roles see the item
  orgContext?: boolean // only show when operating inside an org (SA must have entered one)
  primary?: boolean // highlighted CTA
}

// Phase 1 manual workflow. The org-workspace items only appear when inside an
// org (managers always are; the SA enters via the Organizations list).
const GENERATORS: Role[] = ['superadmin', 'admin', 'manager', 'lead_generator']
const ADMINS: Role[] = ['superadmin', 'admin', 'manager']
const WORKERS_NAV: Role[] = ['superadmin', 'admin', 'manager', 'setter', 'closer']
export const CLIENT_NAV: NavItem[] = [
  { label: 'Home', to: '/home', icon: 'LayoutDashboard', orgContext: true },
  { label: 'Due Today', to: '/today', icon: 'CalendarClock', roles: WORKERS_NAV, orgContext: true },
  { label: 'Leads', to: '/leads', icon: 'Users', orgContext: true },
  { label: 'Templates', to: '/templates', icon: 'FileSpreadsheet', roles: GENERATORS, orgContext: true },
  { label: 'Upload', to: '/upload', icon: 'FileUp', roles: GENERATORS, orgContext: true, primary: true },
  { label: 'Users', to: '/users', icon: 'UserCog', roles: ADMINS, orgContext: true },
  { label: 'Organizations', to: '/organizations', icon: 'Building2', roles: ['superadmin', 'admin'] },
]

export const CLIENT_NAV_BOTTOM: NavItem[] = [
  { label: 'Settings', to: '/settings', icon: 'Settings' },
]

export const ADMIN_NAV: NavItem[] = [
  { label: 'Clients', to: '/admin/clients', icon: 'Building2' },
  { label: 'Audit Log', to: '/admin/audit', icon: 'FileClock' },
]
