import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Building2, ChevronDown, LogOut, Menu, Moon, Settings, Sun, User as UserIcon } from 'lucide-react'
import { authApi } from '../../api/endpoints'
import { useAuthStore } from '../../stores/authStore'
import { useUIStore } from '../../stores/uiStore'
import { queryClient } from '../../app/providers'
import { NotificationBell } from './NotificationBell'
import { ConnectionChip } from '../../realtime/realtime'
import {
  DropdownMenu,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
} from '../ui/controls'

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { user, client, role, actingOrgId } = useAuthStore()
  const exitOrgAction = useAuthStore((s) => s.exitOrg)
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const clear = useAuthStore((s) => s.clear)
  const navigate = useNavigate()
  const isSA = role === 'superadmin' || role === 'admin'
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      clear()
      navigate('/login')
    },
  })
  const onExitOrg = () => {
    exitOrgAction()
    queryClient.invalidateQueries()
    navigate('/organizations')
  }

  const initials = (user?.name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenMobileNav}
          className="rounded-md p-2 text-[var(--color-text-secondary)] hover:bg-slate-100 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-[15px] font-semibold lg:hidden">LeadIntel</span>
        {isSA && actingOrgId && (
          <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 pl-3 pr-1 text-[13px]">
            <Building2 className="h-3.5 w-3.5 text-[var(--color-primary)]" />
            <span className="font-medium">{client?.name}</span>
            <button
              onClick={onExitOrg}
              className="rounded-full px-2 py-0.5 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-slate-200"
            >
              Exit
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <ConnectionChip />
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="rounded-full p-2 text-[var(--color-text-secondary)] hover:bg-slate-100"
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>
        <NotificationBell />
        <DropdownMenu>
          <DropdownTrigger asChild>
            <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)] text-[13px] font-semibold text-white">
                {initials}
              </span>
              <ChevronDown className="h-4 w-4 text-[var(--color-text-muted)]" />
            </button>
          </DropdownTrigger>
          <DropdownContent>
            <div className="px-2.5 py-2">
              <p className="text-sm font-semibold">{user?.name}</p>
              <p className="text-[12px] text-[var(--color-text-muted)]">{client?.name}</p>
            </div>
            <DropdownSeparator />
            <DropdownItem onSelect={() => navigate('/settings/profile')}>
              <UserIcon className="h-4 w-4" /> Profile
            </DropdownItem>
            <DropdownItem onSelect={() => navigate('/settings')}>
              <Settings className="h-4 w-4" /> Settings
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem destructive onSelect={() => logout.mutate()}>
              <LogOut className="h-4 w-4" /> Log out
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
