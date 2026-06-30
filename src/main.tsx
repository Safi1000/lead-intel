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
    // Production has a real backend (Supabase + serverless). Make sure no stale
    // MSW service worker (the build was previously always-on) keeps intercepting
    // requests — that was breaking the cross-origin Cal.com embed.
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
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
