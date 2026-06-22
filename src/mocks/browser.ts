import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
import { p2p3Handlers } from './p2p3'
import { leadworkHandlers } from './leadwork'
import { accountsHandlers } from './accountsHandlers'

export const worker = setupWorker(...handlers, ...p2p3Handlers, ...leadworkHandlers, ...accountsHandlers)

/** Start MSW. Always on in this build — the backend is mocked (§17). */
export async function startMockServer() {
  const registration = await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
  })

  // On the very first visit to a fresh deploy the worker activates but does not
  // yet *control* this page, so /api/* requests escape to the network (404 on
  // hosts like Vercel that have no real backend). Reload once so the page that
  // issues the requests is guaranteed to be controlled by the mock worker.
  if (registration && !navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      // Fallback in case the controllerchange event never fires.
      setTimeout(resolve, 1000)
    })
    if (!navigator.serviceWorker.controller) {
      window.location.reload()
    }
  }
}
