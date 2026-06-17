import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
import { p2p3Handlers } from './p2p3'

export const worker = setupWorker(...handlers, ...p2p3Handlers)

/** Start MSW. Always on in this build — the backend is mocked (§17). */
export async function startMockServer() {
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
  })
}
