# LeadIntel — Lead Intelligence Platform (Frontend)

Production frontend for the **Lead Intelligence Platform** — a multi-tenant SaaS that discovers,
enriches, and delivers verified owner-level B2B lead data for US local-service trades.

Two role-separated frontends live in one codebase:

- **Client Dashboard** — agencies/trades launch enrichment runs and consume leads.
- **Admin Panel** — internal staff monitor runs, costs, and errors across all clients.

The full platform (**MVP + Phase 2 + Phase 3**) runs entirely against an in-browser **mock API
(MSW)** — no backend required to demo it. Every reserved route renders a real, working screen
through all four states; there are no Coming-Soon shells.

**Design:** "Signal Intelligence" system — Space Grotesk (display) + JetBrains Mono (data) +
Inter (body), electric-cobalt / mint-cyan identity, orchestrated page-load motion, atmospheric
auth backgrounds.

**Phase 2:** multi-trade, signup + team/RBAC, billing + market locks, usage, enhanced enrichment
(LinkedIn / tech-stack / sentiment / business-age), AI scoring + hot flags + outreach angle +
market summary, pluggable AI providers, WhatsApp notifications, CRM/Sheets/webhook integrations,
market map, notes & tags.

**Phase 3:** generative outreach + sequence builder, conversational assistant + NL run builder,
predictive signals, API marketplace + docs portal, WhatsApp campaigns + templates + response
inbox, enrichment add-ons, multi-country (US/CA/UK), white-label + reseller. Admin gains client
management, audit log, market-lock management, and reseller oversight.

**Shared infrastructure:** real-time transport (WebSocket-style + polling fallback), RBAC
permission matrix (`useCan`/`<Can>`), billing layer, reusable OAuth connector framework, AI
streaming UI kit, white-label theming engine, i18n (currency + postal validation).

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

## Bookings module (Calendly)

A two-screen module that lets setters book meetings for an Account Executive (the **closer** role)
and gives the AE a prep-ready view of upcoming calls.

- **My Upcoming Meetings** (`/bookings`) — visible to **closer (AE) + manager + super admin**.
  Each card shows the meeting time (in the AE's timezone), location, the joined **CRM lead**, and
  the **setter's prep notes**, with a non-blocking warning when no lead matched.
- **Book a meeting** (`/bookings/new`) — visible to **setter + manager**. Embedded Calendly
  scheduling widget + an inline, collapsible **setter guide**. If a lead was opened to start the
  flow (`?leadId=…`), its CRM Lead ID is shown with a copy button to paste into Calendly's custom
  question.

Gated by the `bookings` feature flag and the `bookings:view` / `bookings:create` permissions
(role matrix + per-user overrides, like the rest of the app).

### Free-plan limitation → polling

Calendly's **Free plan has no webhooks and no programmatic booking**. So:

- the Meetings list is kept fresh by **polling** (`useBookingsSync`, default 2 min, mirrors
  `useRunProgress`) — it pauses while the tab is hidden and refetches on focus. The transport is
  abstracted so a future webhook/WebSocket swap needs no UI change;
- booking happens through the **embedded widget**, not an API call. We listen for Calendly's
  `invitee.scheduled` postMessage to confirm and trigger a refetch.

### Demo vs production (the PAT never reaches the browser)

The frontend only ever calls **our** endpoints under `/api/bookings/*`:

- **Demo** (default, `npm run dev`): MSW (`src/mocks/bookings.ts`) answers with stateful fixtures —
  several upcoming meetings across two AEs, a canceled one, an unmatched lead, varied locations and
  timezones. The booking page runs a *simulated* Calendly flow that actually creates a meeting which
  then appears on the AE side after the next poll.
- **Production**: thin Vercel serverless functions (`api/bookings/*`) hold each AE's **Personal
  Access Token** server-side, call Calendly, normalize to our DTOs, and join to CRM leads. The PAT
  is never bundled or sent to the client.

### Per-AE token setup

Each AE has their own Calendly account + PAT. Configure server-side (see `.env.example`):

```
CALENDLY_PAT__AE_NORTH=<token>        # keyed by AE id, uppercased
CALENDLY_AE_AE_NORTH_NAME=Dana Whitfield
CALENDLY_AE_AE_NORTH_URL=https://calendly.com/leadintel-north/30min
```

The Calendly event type must define custom questions: **Setter name · Lead source · CRM Lead ID ·
Short context** — these populate the setter prep block and drive lead matching (by CRM Lead ID
first, falling back to invitee email; never email alone).
