import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import * as RD from '@radix-ui/react-dialog'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

/** Client AppShell (§4.2): sidebar + topbar + mobile drawer + FAB. */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--color-bg)]">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile off-canvas drawer */}
      <RD.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" />
          <RD.Content className="fixed inset-y-0 left-0 z-50 w-64 lg:hidden">
            <div className="relative h-full">
              <RD.Close className="absolute right-2 top-3 z-10 rounded-md p-2 text-[var(--color-text-secondary)] hover:bg-slate-100">
                <X className="h-5 w-5" />
              </RD.Close>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </RD.Content>
        </RD.Portal>
      </RD.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile New Run FAB */}
      <Link
        to="/runs/new"
        className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-lg lg:hidden"
        aria-label="New run"
      >
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  )
}
