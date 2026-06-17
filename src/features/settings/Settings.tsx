import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../stores/authStore'
import { PageHeader } from '../shared/bits'
import { ComingSoon } from '../shared/ComingSoon'
import type { FeatureFlagKey } from '../../config/featureFlags'

interface Tab {
  to: string
  label: string
  flag?: FeatureFlagKey
  phase?: string
}
const TABS: Tab[] = [
  { to: '/settings/profile', label: 'Profile' },
  { to: '/settings/notifications', label: 'Notifications' },
  { to: '/settings/api-keys', label: 'API Keys', flag: 'apiKeys' },
  { to: '/settings/webhooks', label: 'Webhooks', flag: 'webhooks' },
  { to: '/settings/team', label: 'Team', flag: 'team' },
  { to: '/settings/billing', label: 'Billing', flag: 'billing' },
  { to: '/settings/integrations', label: 'Integrations', flag: 'integrations' },
  { to: '/settings/ai-providers', label: 'AI Providers', flag: 'aiProviders' },
  { to: '/settings/branding', label: 'Branding', flag: 'branding', phase: 'Phase 3' },
]

export function SettingsLayout() {
  const flags = useAuthStore((s) => s.flags)
  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your profile, notifications, and integrations." />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
        {TABS.map((t) => {
          const soon = t.flag && !flags[t.flag]
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn('flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors', isActive ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]')
              }
            >
              {t.label}
              {soon && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Soon</span>}
            </NavLink>
          )
        })}
      </div>
      <Outlet />
    </div>
  )
}

/** Gated settings tab → ComingSoon when its flag is off. */
export function SettingsGate({ flag, title, phase }: { flag: FeatureFlagKey; title: string; phase?: string }) {
  const on = useAuthStore((s) => s.flags[flag])
  if (on) return <Outlet />
  return <ComingSoon title={title} phase={phase ?? 'Phase 2'} />
}
