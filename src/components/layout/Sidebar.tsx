import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeft, ChevronDown } from 'lucide-react'
import { CLIENT_NAV, CLIENT_NAV_BOTTOM, NAV_SECTIONS, type NavItem } from './nav'
import { Icon } from './icon'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { can } from '../../config/permissions'
import { cn } from '../../lib/utils'

function NavRow({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const flagOn = useAuthStore((s) => (item.flag ? s.flags[item.flag] : true))
  const soon = item.flag && !flagOn
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] font-medium transition-all duration-150',
          collapsed && 'justify-center px-0',
          item.primary
            ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)] shadow-sm hover:bg-[var(--color-primary-hover)]'
            : isActive
              ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && !item.primary && !collapsed && (
            <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-primary)]" />
          )}
          <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && (
            <span className="flex flex-1 items-center justify-between">
              {item.label}
              {soon && (
                <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
                  Soon
                </span>
              )}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggle = useUIStore((s) => s.toggleSidebar)
  const collapsedSections = useUIStore((s) => s.collapsedSections)
  const toggleSection = useUIStore((s) => s.toggleSection)
  const role = useAuthStore((s) => s.role)
  const permissions = useAuthStore((s) => s.permissions)
  const inOrg = useAuthStore((s) => s.actingOrgId) != null

  const visible = CLIENT_NAV.filter((item) => {
    if (role === 'client') return item.roles?.includes('client') ?? false
    if (item.orgContext && !inOrg) return false
    if (item.perm) return can(role, item.perm.action, item.perm.resource, permissions)
    if (item.roles && !(role !== null && item.roles.includes(role))) return false
    return true
  })

  const ungrouped = visible.filter((i) => !i.section)
  const groups = NAV_SECTIONS.map((s) => ({ section: s, items: visible.filter((i) => i.section === s) })).filter((g) => g.items.length)

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-all duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className={cn('flex h-14 items-center gap-2.5 border-b border-[var(--color-border)] px-4', collapsed && 'justify-center px-0')}>
        <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[var(--color-primary)] text-sm font-bold text-[var(--color-primary-fg)] shadow-sm">Li</div>
        {!collapsed && <span className="font-display text-[15px] font-bold tracking-tight">LeadIntel</span>}
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3">
        {ungrouped.length > 0 && (
          <div className="space-y-0.5">
            {ungrouped.map((item) => <NavRow key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}
          </div>
        )}
        {groups.map((g) => {
          const secCollapsed = collapsedSections.includes(g.section)
          return (
            <div key={g.section} className="mt-4 first:mt-0">
              {!collapsed && (
                <button
                  onClick={() => toggleSection(g.section)}
                  className="flex w-full items-center justify-between px-3 pb-1.5 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
                >
                  {g.section}
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', secCollapsed && '-rotate-90')} />
                </button>
              )}
              {collapsed && <div className="mx-auto mb-2 h-px w-6 bg-[var(--color-border)]" />}
              {(collapsed || !secCollapsed) && (
                <div className="space-y-0.5">
                  {g.items.map((item) => <NavRow key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="space-y-0.5 border-t border-[var(--color-border)] p-3">
        {CLIENT_NAV_BOTTOM.map((item) => <NavRow key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}
        <button
          onClick={toggle}
          className={cn(
            'hidden w-full items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] lg:flex',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  )
}
