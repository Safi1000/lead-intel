import type { FeatureFlagKey } from '../../config/featureFlags'
import type { Role } from '../../api/types'

export interface NavItem {
  label: string
  to: string
  icon: string // lucide icon name
  flag?: FeatureFlagKey // gated → shows "Soon" tag when off
  roles?: Role[] // when set, only these roles see the item
  primary?: boolean // highlighted CTA
}

// Phase 1 manual workflow. Automation/AI/SaaS entries are hidden until later
// phases. The Leads queue + setter/closer workspaces come online as they're built.
const GENERATOR: Role[] = ['manager', 'lead_generator']
export const CLIENT_NAV: NavItem[] = [
  { label: 'Home', to: '/home', icon: 'LayoutDashboard' },
  { label: 'Leads', to: '/leads', icon: 'Users' },
  { label: 'Templates', to: '/templates', icon: 'FileSpreadsheet', roles: GENERATOR },
  { label: 'Upload', to: '/upload', icon: 'FileUp', roles: GENERATOR, primary: true },
  { label: 'Organizations', to: '/organizations', icon: 'Building2', roles: ['superadmin', 'admin'] },
  { label: 'Users', to: '/users', icon: 'UserCog', roles: ['superadmin', 'admin', 'manager'] },
]

export const CLIENT_NAV_BOTTOM: NavItem[] = [
  { label: 'Settings', to: '/settings', icon: 'Settings' },
]

export const ADMIN_NAV: NavItem[] = [
  { label: 'Clients', to: '/admin/clients', icon: 'Building2' },
  { label: 'Audit Log', to: '/admin/audit', icon: 'FileClock' },
]
