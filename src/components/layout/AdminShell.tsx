import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ArrowLeft, Menu, X } from 'lucide-react'
import { ADMIN_NAV } from './nav'
import { Icon } from './icon'
import { NotificationBell } from './NotificationBell'
import { useAuthStore } from '../../stores/authStore'
import { cn } from '../../lib/utils'

function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {ADMIN_NAV.map((item) => {
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-purple-50 text-[var(--color-admin)]'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white',
              )
            }
          >
            <Icon name={item.icon} className="h-[18px] w-[18px]" />
            <span className="flex flex-1 items-center justify-between">
              {item.label}
              <FlagTag flag={item.flag} />
            </span>
          </NavLink>
        )
      })}
    </nav>
  )
}

function FlagTag({ flag }: { flag?: string }) {
  const on = useAuthStore((s) => (flag ? s.flags[flag as keyof typeof s.flags] : true))
  if (!flag || on) return null
  return (
    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-400">
      Soon
    </span>
  )
}

/** AdminShell (§16): distinct dark/purple chrome + ADMIN badge. */
export function AdminShell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--color-bg)]">
      <aside className="hidden w-64 flex-col bg-slate-900 lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
          <span className="rounded bg-[var(--color-admin)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
            Admin
          </span>
          <span className="text-[15px] font-bold text-white">LeadIntel</span>
        </div>
        <AdminNav />
        <div className="border-t border-white/10 p-3">
          <button
            onClick={() => navigate('/home')}
            className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-[18px] w-[18px]" /> Exit to client app
          </button>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-900">
            <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
              <span className="text-[15px] font-bold text-white">Admin</span>
              <button onClick={() => setOpen(false)} className="p-1 text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <AdminNav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b-2 border-[var(--color-admin)] bg-slate-900 px-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setOpen(true)} className="rounded-md p-2 text-white hover:bg-white/10 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-white">Internal monitoring — all clients</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link to="/home" className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-admin)] text-[13px] font-semibold text-white">
              {(user?.name ?? 'A')[0]}
            </Link>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
