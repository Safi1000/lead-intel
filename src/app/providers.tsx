import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { authApi } from '../api/endpoints'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import { RealtimeProvider } from '../realtime/realtime'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

const SESSION_KEY = 'li_session'
export function markSession() {
  sessionStorage.setItem(SESSION_KEY, '1')
}
export function clearSessionFlag() {
  sessionStorage.removeItem(SESSION_KEY)
}

/** Restore session on load if previously authenticated (§5.4). */
function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const setSession = useAuthStore((s) => s.setSession)
  const clear = useAuthStore((s) => s.clear)

  React.useEffect(() => {
    // Apply persisted theme
    const theme = useUIStore.getState().theme
    document.documentElement.classList.toggle('dark', theme === 'dark')

    let mounted = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        clear()
        return
      }
      authApi
        .me()
        .then((me) => {
          if (mounted)
            setSession({
              user: me.user,
              client: me.client,
              role: me.role,
              flags: me.feature_flags,
              permissions: me.permissions,
              actingOrgId: me.acting_org_id,
              tosAcceptedAt: me.tos_accepted_at,
            })
        })
        .catch(() => clear())
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) clear()
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [setSession, clear])

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <SessionBootstrap>{children}</SessionBootstrap>
      </RealtimeProvider>
      <Toaster richColors position="top-right" closeButton />
    </QueryClientProvider>
  )
}
