import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../stores/authStore'
import { PageHeader } from './bits'
import type { Role } from '../../api/types'

const OVERSEERS: Role[] = ['superadmin', 'manager', 'owner']
const OWNER: Role[] = ['superadmin', 'owner']
const USER_MGRS: Role[] = ['superadmin', 'admin', 'manager', 'owner']

export interface HubTab { to: string; label: string; roles?: Role[]; end?: boolean }

/** A page that groups several related sub-pages under one nav item + a tab bar.
 * Mirrors the Settings layout: title + role-gated tab links + <Outlet/>. */
export function HubLayout({ title, subtitle, tabs }: { title: string; subtitle?: string; tabs: HubTab[] }) {
  const role = useAuthStore((s) => s.role)
  const visible = tabs.filter((t) => !t.roles || (role !== null && t.roles.includes(role)))
  return (
    <div className="reveal">
      <PageHeader title={title} subtitle={subtitle} />
      {visible.length > 1 && (
        <div className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
          {visible.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      )}
      <Outlet />
    </div>
  )
}

/** Activity hub: live team feed + the immutable audit log. */
export function ActivityHub() {
  return (
    <HubLayout
      title="Activity"
      subtitle="What the floor did — live feed and the audit trail."
      tabs={[
        { to: '/activity', label: 'Activity', end: true },
        { to: '/activity/audit', label: 'Audit log' },
      ]}
    />
  )
}

/** Playbook hub: call/email scripts (everyone) + follow-up sequences (overseers). */
export function PlaybookHub() {
  return (
    <HubLayout
      title="Playbook"
      subtitle="Call scripts, email templates and follow-up sequences."
      tabs={[
        { to: '/playbook', label: 'Scripts', end: true },
        { to: '/playbook/sequences', label: 'Sequences', roles: OVERSEERS },
      ]}
    />
  )
}

/** People hub: org users + teams. */
export function PeopleHub() {
  return (
    <HubLayout
      title="People"
      subtitle="Manage the users and teams in this organization."
      tabs={[
        { to: '/people', label: 'Users', end: true, roles: USER_MGRS },
        { to: '/people/teams', label: 'Teams', roles: OWNER },
      ]}
    />
  )
}

/** Import hub: upload sheets + manage the templates they must match. */
export function ImportHub() {
  return (
    <HubLayout
      title="Import leads"
      subtitle="Upload sheets and manage the templates they must match."
      tabs={[
        { to: '/import', label: 'Upload', end: true },
        { to: '/import/templates', label: 'Templates' },
      ]}
    />
  )
}

/** Performance hub: Team funnel · Progress (done counts) · Targets. */
export function PerformanceHub() {
  return (
    <HubLayout
      title="Performance"
      subtitle="Team funnel, per-rep progress and targets."
      tabs={[
        { to: '/performance', label: 'Team', roles: OVERSEERS, end: true },
        { to: '/performance/progress', label: 'Progress' },
        { to: '/performance/targets', label: 'Targets', roles: OVERSEERS },
      ]}
    />
  )
}
