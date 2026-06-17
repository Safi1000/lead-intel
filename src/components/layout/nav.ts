import type { FeatureFlagKey } from '../../config/featureFlags'

export interface NavItem {
  label: string
  to: string
  icon: string // lucide icon name
  flag?: FeatureFlagKey // gated → shows "Soon" tag when off
  primary?: boolean // highlighted CTA
}

export const CLIENT_NAV: NavItem[] = [
  { label: 'Home', to: '/home', icon: 'LayoutDashboard' },
  { label: 'New Run', to: '/runs/new', icon: 'Plus', primary: true },
  { label: 'Runs', to: '/runs', icon: 'Workflow' },
  { label: 'Batches', to: '/batches', icon: 'Boxes' },
  { label: 'Exports', to: '/exports', icon: 'Download' },
  { label: 'Market Map', to: '/market-map', icon: 'Map', flag: 'marketMap' },
  { label: 'Usage', to: '/usage', icon: 'Gauge', flag: 'usage' },
  { label: 'Assistant', to: '/assistant', icon: 'Bot', flag: 'assistant' },
  { label: 'Campaigns', to: '/campaigns', icon: 'MessageSquare', flag: 'campaigns' },
]

export const CLIENT_NAV_BOTTOM: NavItem[] = [
  { label: 'Settings', to: '/settings', icon: 'Settings' },
]

export const ADMIN_NAV: NavItem[] = [
  { label: 'Run Monitoring', to: '/admin/runs', icon: 'Activity' },
  { label: 'Cost Tracking', to: '/admin/costs', icon: 'DollarSign' },
  { label: 'Error Log', to: '/admin/errors', icon: 'AlertTriangle' },
  { label: 'Clients', to: '/admin/clients', icon: 'Building2', flag: 'billing' },
  { label: 'Market Locks', to: '/admin/market-locks', icon: 'Lock', flag: 'marketMap' },
  { label: 'Resellers', to: '/admin/resellers', icon: 'Network', flag: 'resellers' },
]
