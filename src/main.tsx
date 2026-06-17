import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './styles/globals.css'
import { Providers } from './app/providers'
import { router } from './app/router'
import { startMockServer } from './mocks/browser'

async function bootstrap() {
  // The backend is mocked with MSW (§17) so the full MVP is demoable.
  await startMockServer()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  )
}

void bootstrap()
