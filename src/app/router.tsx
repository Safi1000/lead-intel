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
const LeadQueuePage = lazyPage(() => import('../features/leadwork/LeadQueue').then((m) => ({ default: m.LeadQueuePage })))
const ManualLeadDetailPage = lazyPage(() => import('../features/leadwork/ManualLeadDetail').then((m) => ({ default: m.ManualLeadDetailPage })))
const MeetingsPage = lazyPage(() => import('../features/bookings/Meetings').then((m) => ({ default: m.MeetingsPage })))
const NewBookingPage = lazyPage(() => import('../features/bookings/NewBooking').then((m) => ({ default: m.NewBookingPage })))
const OrganizationsPage = lazyPage(() => import('../features/admin/Organizations').then((m) => ({ default: m.OrganizationsPage })))
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
                  { path: 'home', element: <WorkHomePage /> },
                  { path: 'today', element: L(<DueTodayPage />) },
                  { path: 'leads', element: L(<BatchesPage />) },
                  { path: 'leads/batch/:batchId', element: L(<LeadQueuePage />) },
                  { path: 'leads/manual/:id', element: L(<ManualLeadDetailPage />) },
                  {
                    element: <RequirePermission resource="templates" action="view" />,
                    children: [{ path: 'templates', element: L(<LeadTemplatesPage />) }],
                  },
                  {
                    element: <RequirePermission resource="upload" action="create" />,
                    children: [{ path: 'upload', element: L(<UploadPage />) }],
                  },
                  {
                    element: <RequirePermission resource="users" action="manage" />,
                    children: [{ path: 'users', element: L(<UsersPage />) }],
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
