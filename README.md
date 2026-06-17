# LeadIntel — Lead Intelligence Platform (Frontend)

Production frontend for the **Lead Intelligence Platform** — a multi-tenant SaaS that discovers,
enriches, and delivers verified owner-level B2B lead data for US local-service trades.

Two role-separated frontends live in one codebase:

- **Client Dashboard** — agencies/trades launch enrichment runs and consume leads.
- **Admin Panel** — internal staff monitor runs, costs, and errors across all clients.

The full MVP runs entirely against an in-browser **mock API (MSW)** — no backend required to demo it.

## Demo

- **Client login:** any email (e.g. `demo@techexcel.io`) + any 4+ char password.
- **Admin panel:** sign in with an email containing `admin` (e.g. `admin@techexcel.io`).

End-to-end flow: log in → launch a Roofing run → watch live progress → browse/filter leads
(virtualized 5k-row table) → open a lead → export CSV → view the fill-rate report. Admins can
monitor that run, see its cost, override it, and re-run it.

## Stack

React 18+ · TypeScript (strict) · Vite · Tailwind CSS · Radix UI · React Router · TanStack
Query/Table/Virtual · Zustand · React Hook Form + Zod · Axios · Recharts · MSW · sonner · lucide.

## Scripts

```bash
npm install
npm run dev      # local dev (MSW mock API auto-starts)
npm run build    # typecheck + production build
npm run preview  # preview the production build
```

## Architecture

```
src/
  api/          typed client + endpoint modules + DTOs (mirror the API contract)
  app/          router, providers, route guards
  components/   ui primitives, confidence system, feedback states, layout shells
  config/       feature flags (MVP/P2/P3 gates), constants (trades, confidence map)
  features/     auth, runs, leads, exports, batches, settings, admin
  hooks/        useAuth, useFeatureFlag, useDebounce, useRunProgress (polling, swappable to WS)
  mocks/        MSW handlers + stateful in-memory data (runs "progress" live)
  stores/       zustand auth + UI stores
```

### Key decisions

- **Confidence system** — four visually distinct states (Verified / Probable / Unverified /
  Missing). Color is never the only signal: every indicator pairs with a text label + icon.
- **Feature flags** — every Phase 2/3 route is reserved and renders a Coming-Soon shell when its
  flag is off, so navigation never dead-ends.
- **Live progress** — MVP polls every 5s via `useRunProgress`, abstracted so a Phase-2
  WebSocket/SSE swap needs no UI change.
- **States quartet** — every data view implements Loading / Empty / Error / Success.

Built as a self-contained, demoable MVP with the full information architecture scaffolded for
Phase 2 and Phase 3.
