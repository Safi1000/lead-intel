import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './styles/globals.css'
import { Providers } from './app/providers'
import { router } from './app/router'
import { startMockServer } from './mocks/browser'

async function bootstrap() {
  if (import.meta.env.DEV) {
    // Dev only: MSW mocks the legacy demo API so the full MVP is demoable.
    await startMockServer()
  } else if ('serviceWorker' in navigator) {
    // Production has a real backend (Supabase + serverless). Remove any stale
    // MSW service worker (the build was previously always-on) — it was breaking
    // the cross-origin Cal.com embed. Unregistering only takes effect once the
    // page is no longer controlled, so reload once (guarded) to drop it.
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      if (regs.length) {
        await Promise.all(regs.map((r) => r.unregister()))
        if (navigator.serviceWorker.controller && !sessionStorage.getItem('li-sw-cleared')) {
          sessionStorage.setItem('li-sw-cleared', '1')
          window.location.reload()
          return
        }
      }
    } catch {
      /* ignore */
    }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  )
}

void bootstrap()
