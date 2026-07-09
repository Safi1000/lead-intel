import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

// A stale client (e.g. after a redeploy with new chunk hashes) can fail to fetch
// a lazily-imported chunk — "Failed to fetch dynamically imported module". When
// that happens, reload once to pick up the fresh index + assets.
const CHUNK_RELOAD_KEY = 'li-chunk-reload'
function lazyPage<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory()
      .then((m) => {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY)
        return m
      })
      .catch((err: unknown) => {
        if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
          window.location.reload()
          return new Promise<{ default: T }>(() => {}) // hang until the reload happens
        }
        throw err
      }),
  )
}
import { AppShell } from '../components/layout/AppShell'
import { AdminShell } from '../components/layout/AdminShell'
import { RequireAuth, RequireAdmin, RequireTOS, RequireFeature, RequireRole, RequireOrgContext, RequirePermission } from './guards'
import { RouteErrorBoundary, NotFoundPage, ForbiddenPage, MaintenancePage } from '../features/misc/ErrorPages'
import { LegalPage } from '../features/misc/Legal'
import { LoginPage } from '../features/auth/Login'
import { ForgotPasswordPage } from '../features/auth/ForgotPassword'
import { ResetPasswordPage } from '../features/auth/ResetPassword'
import { LoadingState } from '../components/feedback'
// Eager core client features
import { WorkHomePage } from '../features/leadwork/Dashboard'
import { LeadListPage } from '../features/leads/LeadList'
import { LeadDetailPage } from '../features/leads/LeadDetail'
import { SettingsLayout, SettingsGate } from '../features/settings/Settings'
import { ProfileSettingsPage } from '../features/settings/Profile'
import { NotificationsSettingsPage } from '../features/settings/Notifications'

// Phase 1 manual-workflow screens (code-split)
const LeadTemplatesPage = lazyPage(() => import('../features/templates/Templates').then((m) => ({ default: m.TemplatesPage })))
const UploadPage = lazyPage(() => import('../features/upload/Upload').then((m) => ({ default: m.UploadPage })))
const BatchesPage = lazyPage(() => import('../features/leadwork/Batches').then((m) => ({ default: m.BatchesPage })))
const DueTodayPage = lazyPage(() => import('../features/leadwork/DueToday').then((m) => ({ default: m.DueTodayPage })))
const ActivityPage = lazyPage(() => import('../features/leadwork/Activity').then((m) => ({ default: m.ActivityPage })))
const PerformancePage = lazyPage(() => import('../features/sales/Performance').then((m) => ({ default: m.PerformancePage })))
const TargetsPage = lazyPage(() => import('../features/sales/Targets').then((m) => ({ default: m.TargetsPage })))
const LeadQueuePage = lazyPage(() => import('../features/leadwork/LeadQueue').then((m) => ({ default: m.LeadQueuePage })))
const ManualLeadDetailPage = lazyPage(() => import('../features/leadwork/ManualLeadDetail').then((m) => ({ default: m.ManualLeadDetailPage })))
const AuditReportPage = lazyPage(() => import('../features/leadwork/AuditReport').then((m) => ({ default: m.AuditReportPage })))
const TeamsPage = lazyPage(() => import('../features/leadwork/Teams').then((m) => ({ default: m.TeamsPage })))
const DealsPage = lazyPage(() => import('../features/sales/Deals').then((m) => ({ default: m.DealsPage })))
const ConsolePage = lazyPage(() => import('../features/leadwork/Console').then((m) => ({ default: m.ConsolePage })))
const ScriptsPage = lazyPage(() => import('../features/leadwork/Scripts').then((m) => ({ default: m.ScriptsPage })))
const ProviderPage = lazyPage(() => import('../features/provider/Provider').then((m) => ({ default: m.ProviderPage })))
const PortalPage = lazyPage(() => import('../features/portal/Portal').then((m) => ({ default: m.PortalPage })))
const CockpitPage = lazyPage(() => import('../features/sales/Cockpit').then((m) => ({ default: m.CockpitPage })))
const AuditLogPage = lazyPage(() => import('../features/leadwork/AuditLog').then((m) => ({ default: m.AuditLogPage })))
const HolidaysPage = lazyPage(() => import('../features/sales/Holidays').then((m) => ({ default: m.HolidaysPage })))
const SearchPage = lazyPage(() => import('../features/leadwork/Search').then((m) => ({ default: m.SearchPage })))
const CreditsPage = lazyPage(() => import('../features/sales/Credits').then((m) => ({ default: m.CreditsPage })))
const CadencesPage = lazyPage(() => import('../features/leadwork/Cadences').then((m) => ({ default: m.CadencesPage })))
const MeetingsPage = lazyPage(() => import('../features/bookings/Meetings').then((m) => ({ default: m.MeetingsPage })))
const NewBookingPage = lazyPage(() => import('../features/bookings/NewBooking').then((m) => ({ default: m.NewBookingPage })))
const ProgressPage = lazyPage(() => import('../features/progress/Progress').then((m) => ({ default: m.ProgressPage })))
const PerformanceHub = lazyPage(() => import('../features/shared/Hubs').then((m) => ({ default: m.PerformanceHub })))
const ActivityHub = lazyPage(() => import('../features/shared/Hubs').then((m) => ({ default: m.ActivityHub })))
const PlaybookHub = lazyPage(() => import('../features/shared/Hubs').then((m) => ({ default: m.PlaybookHub })))
const PeopleHub = lazyPage(() => import('../features/shared/Hubs').then((m) => ({ default: m.PeopleHub })))
const ImportHub = lazyPage(() => import('../features/shared/Hubs').then((m) => ({ default: m.ImportHub })))
const GoalsSettingsPage = lazyPage(() => import('../features/settings/Goals').then((m) => ({ default: m.GoalsSettingsPage })))
const OrganizationsPage = lazyPage(() => import('../features/admin/Organizations').then((m) => ({ default: m.OrganizationsPage })))
const SourcingWorkspace = lazyPage(() => import('../features/pipeline/Pipeline').then((m) => ({ default: m.SourcingWorkspace })))
const SourcingLimitSettings = lazyPage(() => import('../features/pipeline/SourcingProfile').then((m) => ({ default: m.SourcingSettingsPage })))
const UsersPage = lazyPage(() => import('../features/admin/Users').then((m) => ({ default: m.UsersPage })))
// Lazy-loaded P2/P3 + admin route bundles (code-split, §F-9)
const UsagePage = lazyPage(() => import('../features/runs/Usage').then((m) => ({ default: m.UsagePage })))
const MarketMapPage = lazyPage(() => import('../features/market-map/MarketMap').then((m) => ({ default: m.MarketMapPage })))
const AssistantPage = lazyPage(() => import('../features/ai/Assistant').then((m) => ({ default: m.AssistantPage })))
const OutreachPage = lazyPage(() => import('../features/ai/Outreach').then((m) => ({ default: m.OutreachPage })))
const CampaignsPage = lazyPage(() => import('../features/campaigns/Campaigns').then((m) => ({ default: m.CampaignsPage })))
const NewCampaignPage = lazyPage(() => import('../features/campaigns/Campaigns').then((m) => ({ default: m.NewCampaignPage })))
const CampaignDetailPage = lazyPage(() => import('../features/campaigns/Campaigns').then((m) => ({ default: m.CampaignDetailPage })))
const TemplatesPage = lazyPage(() => import('../features/campaigns/Templates').then((m) => ({ default: m.TemplatesPage })))
const InboxPage = lazyPage(() => import('../features/inbox/Inbox').then((m) => ({ default: m.InboxPage })))
const ResellerPage = lazyPage(() => import('../features/reseller/Reseller').then((m) => ({ default: m.ResellerPage })))
// Settings tabs (lazy)
const BillingSettingsPage = lazyPage(() => import('../features/billing/Billing').then((m) => ({ default: m.BillingSettingsPage })))
const IntegrationsSettingsPage = lazyPage(() => import('../features/settings/Integrations').then((m) => ({ default: m.IntegrationsSettingsPage })))
const WebhooksSettingsPage = lazyPage(() => import('../features/settings/Webhooks').then((m) => ({ default: m.WebhooksSettingsPage })))
const ApiKeysSettingsPage = lazyPage(() => import('../features/settings/ApiKeys').then((m) => ({ default: m.ApiKeysSettingsPage })))
const ApiDocsPage = lazyPage(() => import('../features/settings/ApiDocs').then((m) => ({ default: m.ApiDocsPage })))
const AIProvidersSettingsPage = lazyPage(() => import('../features/settings/AIProviders').then((m) => ({ default: m.AIProvidersSettingsPage })))
const BrandingSettingsPage = lazyPage(() => import('../features/settings/Branding').then((m) => ({ default: m.BrandingSettingsPage })))
// Admin (lazy)
const AdminClientsPage = lazyPage(() => import('../features/admin/AdminClients').then((m) => ({ default: m.AdminClientsPage })))
const AdminClientDetailPage = lazyPage(() => import('../features/admin/AdminClients').then((m) => ({ default: m.AdminClientDetailPage })))
const AdminAuditPage = lazyPage(() => import('../features/admin/AdminAudit').then((m) => ({ default: m.AdminAuditPage })))

const L = (el: React.ReactNode) => <Suspense fallback={<LoadingState />}>{el}</Suspense>

/** Role-based landing: setters start on their daily "Due Today" list (Feature 2). */
function Landing() {
  const role = useAuthStore((s) => s.role)
  return <Navigate to={role === 'setter' ? '/today' : '/home'} replace />
}

/** Performance hub index: overseers see the Team funnel; everyone else lands on Progress. */
function PerfIndex() {
  const role = useAuthStore((s) => s.role)
  const overseer = role === 'superadmin' || role === 'manager' || role === 'owner'
  return overseer ? L(<PerformancePage />) : <Navigate to="/performance/progress" replace />
}

/** Home is role-aware: owners get the Cockpit, managers the Console, everyone else the IC dashboard. */
function HomeDispatch() {
  const role = useAuthStore((s) => s.role)
  if (role === 'owner' || role === 'superadmin') return L(<CockpitPage />)
  if (role === 'manager' || role === 'admin') return L(<ConsolePage />)
  return <WorkHomePage />
}

export const router = createBrowserRouter([
  // ---- Public / auth ----
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  // Self-service signup is disabled — accounts are provisioned by SSA/managers.
  { path: '/signup', element: <Navigate to="/login" replace /> },
  { path: '/signup/verify', element: <Navigate to="/login" replace /> },
  { path: '/accept-invite', element: <Navigate to="/login" replace /> },
  { path: '/terms', element: <LegalPage doc="terms" /> },
  { path: '/privacy', element: <LegalPage doc="privacy" /> },
  { path: '/aup', element: <LegalPage doc="aup" /> },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '/maintenance', element: <MaintenancePage /> },

  // ---- Client app ----
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <RequireTOS />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <Landing /> },
              // Org workspace — requires being inside an org (SA enters via the org list).
              {
                element: <RequireOrgContext />,
                children: [
                  { path: 'home', element: <HomeDispatch /> },
                  { path: 'today', element: L(<DueTodayPage />) },
                  {
                    element: <RequireRole roles={['superadmin', 'manager', 'owner']} />,
                    children: [
                      // Activity hub — live feed + audit log
                      {
                        path: 'activity',
                        element: L(<ActivityHub />),
                        children: [
                          { index: true, element: L(<ActivityPage />) },
                          { path: 'audit', element: L(<AuditLogPage />) },
                        ],
                      },
                    ],
                  },
                  // Playbook hub — Scripts (all) · Sequences (overseers)
                  {
                    path: 'playbook',
                    element: L(<PlaybookHub />),
                    children: [
                      { index: true, element: L(<ScriptsPage />) },
                      {
                        element: <RequireRole roles={['superadmin', 'manager', 'owner']} />,
                        children: [{ path: 'sequences', element: L(<CadencesPage />) }],
                      },
                    ],
                  },
                  // People hub — Users (managers) · Teams (owner)
                  {
                    path: 'people',
                    element: L(<PeopleHub />),
                    children: [
                      { element: <RequirePermission resource="users" action="manage" />, children: [{ index: true, element: L(<UsersPage />) }] },
                      { element: <RequireRole roles={['superadmin', 'owner']} />, children: [{ path: 'teams', element: L(<TeamsPage />) }] },
                    ],
                  },
                  // Performance hub — Team funnel (overseers) · Progress · Targets (overseers)
                  {
                    path: 'performance',
                    element: L(<PerformanceHub />),
                    children: [
                      { index: true, element: <PerfIndex /> },
                      { path: 'progress', element: L(<ProgressPage />) },
                      {
                        element: <RequireRole roles={['superadmin', 'manager', 'owner']} />,
                        children: [{ path: 'targets', element: L(<TargetsPage />) }],
                      },
                    ],
                  },
                  { path: 'deals', element: L(<DealsPage />) },
                  { path: 'search', element: L(<SearchPage />) },
                  // Legacy paths → hubs
                  { path: 'scripts', element: <Navigate to="/playbook" replace /> },
                  { path: 'cadences', element: <Navigate to="/playbook/sequences" replace /> },
                  { path: 'audit-log', element: <Navigate to="/activity/audit" replace /> },
                  { path: 'users', element: <Navigate to="/people" replace /> },
                  { path: 'teams', element: <Navigate to="/people/teams" replace /> },
                  { path: 'progress', element: <Navigate to="/performance/progress" replace /> },
                  { path: 'targets', element: <Navigate to="/performance/targets" replace /> },
                  { path: 'holidays', element: <Navigate to="/settings/holidays" replace /> },
                  { path: 'pipeline', element: <Navigate to="/sourcing" replace /> },
                  { path: 'discovery', element: <Navigate to="/sourcing" replace /> },
                  { path: 'sourcing/profile', element: <Navigate to="/sourcing" replace /> },
                  { path: 'sourcing/discovery', element: <Navigate to="/sourcing" replace /> },
                  { path: 'templates', element: <Navigate to="/import/templates" replace /> },
                  { path: 'upload', element: <Navigate to="/import" replace /> },
                  { path: 'credits', element: <Navigate to="/settings/credits" replace /> },
                  { path: 'cockpit', element: <Navigate to="/home" replace /> },
                  { path: 'console', element: <Navigate to="/home" replace /> },
                  { path: 'leads', element: L(<BatchesPage />) },
                  { path: 'leads/batch/:batchId', element: L(<LeadQueuePage />) },
                  { path: 'leads/manual/:id', element: L(<ManualLeadDetailPage />) },
                  // Import hub — Upload sheets · Templates
                  {
                    path: 'import',
                    element: L(<ImportHub />),
                    children: [
                      { element: <RequirePermission resource="upload" action="create" />, children: [{ index: true, element: L(<UploadPage />) }] },
                      { element: <RequirePermission resource="templates" action="view" />, children: [{ path: 'templates', element: L(<LeadTemplatesPage />) }] },
                    ],
                  },
                  {
                    // §2 matrix: scrape/global pool + "see all managers/teams" = Owner only.
                    element: <RequireRole roles={['superadmin', 'owner']} />,
                    children: [
                      // Unified Sourcing workspace (config + live cost + run + persistent progress)
                      { path: 'sourcing', element: L(<SourcingWorkspace />) },
                    ],
                  },
                  // Bookings (Calendly). Gated by flag, then per-role permission.
                  {
                    element: <RequireFeature flag="bookings" title="Bookings" />,
                    children: [
                      {
                        element: <RequirePermission resource="bookings" action="view" />,
                        children: [{ path: 'bookings', element: L(<MeetingsPage />) }],
                      },
                      {
                        element: <RequirePermission resource="bookings" action="create" />,
                        children: [{ path: 'bookings/new', element: L(<NewBookingPage />) }],
                      },
                    ],
                  },
                ],
              },
              // Organizations list (SA only) — the SA's home base.
              {
                element: <RequireRole roles={['superadmin', 'admin']} />,
                children: [{ path: 'organizations', element: L(<OrganizationsPage />) }],
              },
              // Provider console (Surface 3) — TechxServe god-view across tenants.
              {
                element: <RequireRole roles={['superadmin']} />,
                children: [{ path: 'provider', element: L(<ProviderPage />) }],
              },
              // Client portal (Surface 2) — external customer, read-only results.
              {
                element: <RequireRole roles={['client']} />,
                children: [{ path: 'portal', element: L(<PortalPage />) }],
              },
              // Legacy enrichment screens (kept, no longer linked):
              { path: 'runs/:runId/leads', element: <LeadListPage /> },
              { path: 'leads/:leadId', element: <LeadDetailPage /> },
              // Hidden automation routes → redirect home (re-enabled in later phases):
              { path: 'runs/new', element: <Navigate to="/home" replace /> },
              { path: 'runs', element: <Navigate to="/home" replace /> },
              { path: 'runs/:runId', element: <Navigate to="/home" replace /> },
              { path: 'runs/:runId/market-summary', element: <Navigate to="/home" replace /> },
              { path: 'batches', element: <Navigate to="/home" replace /> },
              { path: 'batches/:batchId/report', element: <Navigate to="/home" replace /> },
              { path: 'exports', element: <Navigate to="/home" replace /> },
              // P2/P3 feature-gated routes (flags now OFF → Coming-Soon shells, hidden from nav)
              { element: <RequireFeature flag="marketMap" title="Market coverage map" />, children: [{ path: 'market-map', element: L(<MarketMapPage />) }] },
              { element: <RequireFeature flag="usage" title="Usage dashboard" />, children: [{ path: 'usage', element: L(<UsagePage />) }] },
              { element: <RequireFeature flag="assistant" title="AI assistant" />, children: [{ path: 'assistant', element: L(<AssistantPage />) }] },
              { element: <RequireFeature flag="outreach" title="Outreach drafts" />, children: [{ path: 'outreach', element: L(<OutreachPage />) }] },
              { element: <RequireFeature flag="campaigns" title="WhatsApp campaigns" />, children: [
                { path: 'campaigns', element: L(<CampaignsPage />) },
                { path: 'campaigns/new', element: L(<NewCampaignPage />) },
                { path: 'campaigns/templates', element: L(<TemplatesPage />) },
                { path: 'campaigns/:id', element: L(<CampaignDetailPage />) },
              ] },
              { element: <RequireFeature flag="inbox" title="Response inbox" />, children: [{ path: 'inbox', element: L(<InboxPage />) }] },
              { element: <RequireFeature flag="resellers" title="Reseller" />, children: [{ path: 'reseller', element: L(<ResellerPage />) }] },
              // Settings (tabbed)
              {
                path: 'settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <Navigate to="/settings/profile" replace /> },
                  { path: 'profile', element: <ProfileSettingsPage /> },
                  {
                    element: <RequireRole roles={['superadmin', 'admin', 'manager']} />,
                    children: [{ path: 'goals', element: L(<GoalsSettingsPage />) }],
                  },
                  {
                    element: <RequireRole roles={['superadmin', 'manager', 'owner']} />,
                    children: [{ path: 'holidays', element: L(<HolidaysPage />) }],
                  },
                  {
                    element: <RequireRole roles={['superadmin', 'owner']} />,
                    children: [
                      { path: 'credits', element: L(<CreditsPage />) },
                      { path: 'sourcing', element: L(<SourcingLimitSettings />) },
                    ],
                  },
                  { path: 'notifications', element: <NotificationsSettingsPage /> },
                  { element: <SettingsGate flag="apiKeys" title="API Keys" />, children: [{ path: 'api-keys', element: L(<ApiKeysSettingsPage />) }, { path: 'api-keys/docs', element: L(<ApiDocsPage />) }] },
                  { element: <SettingsGate flag="webhooks" title="Webhooks" />, children: [{ path: 'webhooks', element: L(<WebhooksSettingsPage />) }] },
                  { element: <SettingsGate flag="billing" title="Billing & Plan" />, children: [{ path: 'billing', element: L(<BillingSettingsPage />) }] },
                  { element: <SettingsGate flag="integrations" title="Integrations" />, children: [{ path: 'integrations', element: L(<IntegrationsSettingsPage />) }] },
                  { element: <SettingsGate flag="aiProviders" title="AI Providers" />, children: [{ path: 'ai-providers', element: L(<AIProvidersSettingsPage />) }] },
                  { element: <SettingsGate flag="branding" title="White-label Branding" phase="Phase 3" />, children: [{ path: 'branding', element: L(<BrandingSettingsPage />) }] },
                ],
              },
            ],
          },
        ],
      },
      // Standalone print page (auth required, no app shell) — the client-facing white-label audit PDF.
      { path: 'leads/manual/:id/audit', element: L(<AuditReportPage />) },
    ],
  },

  // ---- Admin app ----
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <RequireAdmin />,
        children: [
          {
            path: 'admin',
            element: <AdminShell />,
            children: [
              { index: true, element: <Navigate to="/admin/clients" replace /> },
              { path: 'clients', element: L(<AdminClientsPage />) },
              { path: 'clients/:clientId', element: L(<AdminClientDetailPage />) },
              { path: 'audit', element: L(<AdminAuditPage />) },
              // Hidden automation admin routes → redirect (re-enabled in later phases):
              { path: 'runs', element: <Navigate to="/admin/clients" replace /> },
              { path: 'costs', element: <Navigate to="/admin/clients" replace /> },
              { path: 'errors', element: <Navigate to="/admin/clients" replace /> },
              { path: 'market-locks', element: <Navigate to="/admin/clients" replace /> },
              { path: 'resellers', element: <Navigate to="/admin/clients" replace /> },
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
])
