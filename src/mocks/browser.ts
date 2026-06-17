import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/** Start MSW. Always on in this build — the backend is mocked (§17). */
export async function startMockServer() {
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
  })
}
