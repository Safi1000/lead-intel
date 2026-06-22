import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { CLIENT_NAV, CLIENT_NAV_BOTTOM, type NavItem } from './nav'
import { Icon } from './icon'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { cn } from '../../lib/utils'

function NavRow({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const flagOn = useAuthStore((s) => (item.flag ? s.flags[item.flag] : true))
  const soon = item.flag && !flagOn
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors',
          item.primary
            ? 'mb-1 bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'
            : isActive
              ? 'bg-blue-50 text-[var(--color-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-slate-100 hover:text-[var(--color-text)]',
        )
      }
    >
      <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && (
        <span className="flex flex-1 items-center justify-between">
          {item.label}
          {soon && (
            <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
              Soon
            </span>
          )}
        </span>
      )}
    </NavLink>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggle = useUIStore((s) => s.toggleSidebar)
  const role = useAuthStore((s) => s.role)

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-all',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className={cn('flex h-14 items-center gap-2 border-b border-[var(--color-border)] px-4', collapsed && 'justify-center px-0')}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary)] text-sm font-bold text-white">
          Li
        </div>
        {!collapsed && <span className="text-[15px] font-bold tracking-tight">LeadIntel</span>}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {CLIENT_NAV.filter((item) => !item.roles || (role !== null && item.roles.includes(role))).map((item) => (
          <NavRow key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-[var(--color-border)] p-3">
        {CLIENT_NAV_BOTTOM.map((item) => (
          <NavRow key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
        <button
          onClick={toggle}
          className={cn(
            'hidden w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-slate-100 lg:flex',
            collapsed && 'justify-center',
          )}
        >
          {collapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  )
}
