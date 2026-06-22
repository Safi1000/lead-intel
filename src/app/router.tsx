import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { AdminShell } from '../components/layout/AdminShell'
import { RequireAuth, RequireAdmin, RequireTOS, RequireFeature, RequireRole } from './guards'
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
const LeadTemplatesPage = lazy(() => import('../features/templates/Templates').then((m) => ({ default: m.TemplatesPage })))
const UploadPage = lazy(() => import('../features/upload/Upload').then((m) => ({ default: m.UploadPage })))
const LeadQueuePage = lazy(() => import('../features/leadwork/LeadQueue').then((m) => ({ default: m.LeadQueuePage })))
const ManualLeadDetailPage = lazy(() => import('../features/leadwork/ManualLeadDetail').then((m) => ({ default: m.ManualLeadDetailPage })))
const OrganizationsPage = lazy(() => import('../features/admin/Organizations').then((m) => ({ default: m.OrganizationsPage })))
const UsersPage = lazy(() => import('../features/admin/Users').then((m) => ({ default: m.UsersPage })))
// Lazy-loaded P2/P3 + admin route bundles (code-split, §F-9)
const UsagePage = lazy(() => import('../features/runs/Usage').then((m) => ({ default: m.UsagePage })))
const MarketMapPage = lazy(() => import('../features/market-map/MarketMap').then((m) => ({ default: m.MarketMapPage })))
const AssistantPage = lazy(() => import('../features/ai/Assistant').then((m) => ({ default: m.AssistantPage })))
const OutreachPage = lazy(() => import('../features/ai/Outreach').then((m) => ({ default: m.OutreachPage })))
const CampaignsPage = lazy(() => import('../features/campaigns/Campaigns').then((m) => ({ default: m.CampaignsPage })))
const NewCampaignPage = lazy(() => import('../features/campaigns/Campaigns').then((m) => ({ default: m.NewCampaignPage })))
const CampaignDetailPage = lazy(() => import('../features/campaigns/Campaigns').then((m) => ({ default: m.CampaignDetailPage })))
const TemplatesPage = lazy(() => import('../features/campaigns/Templates').then((m) => ({ default: m.TemplatesPage })))
const InboxPage = lazy(() => import('../features/inbox/Inbox').then((m) => ({ default: m.InboxPage })))
const ResellerPage = lazy(() => import('../features/reseller/Reseller').then((m) => ({ default: m.ResellerPage })))
// Settings tabs (lazy)
const BillingSettingsPage = lazy(() => import('../features/billing/Billing').then((m) => ({ default: m.BillingSettingsPage })))
const IntegrationsSettingsPage = lazy(() => import('../features/settings/Integrations').then((m) => ({ default: m.IntegrationsSettingsPage })))
const WebhooksSettingsPage = lazy(() => import('../features/settings/Webhooks').then((m) => ({ default: m.WebhooksSettingsPage })))
const ApiKeysSettingsPage = lazy(() => import('../features/settings/ApiKeys').then((m) => ({ default: m.ApiKeysSettingsPage })))
const ApiDocsPage = lazy(() => import('../features/settings/ApiDocs').then((m) => ({ default: m.ApiDocsPage })))
const AIProvidersSettingsPage = lazy(() => import('../features/settings/AIProviders').then((m) => ({ default: m.AIProvidersSettingsPage })))
const BrandingSettingsPage = lazy(() => import('../features/settings/Branding').then((m) => ({ default: m.BrandingSettingsPage })))
// Admin (lazy)
const AdminClientsPage = lazy(() => import('../features/admin/AdminClients').then((m) => ({ default: m.AdminClientsPage })))
const AdminClientDetailPage = lazy(() => import('../features/admin/AdminClients').then((m) => ({ default: m.AdminClientDetailPage })))
const AdminAuditPage = lazy(() => import('../features/admin/AdminAudit').then((m) => ({ default: m.AdminAuditPage })))

const L = (el: React.ReactNode) => <Suspense fallback={<LoadingState />}>{el}</Suspense>

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
              { index: true, element: <Navigate to="/home" replace /> },
              { path: 'home', element: <WorkHomePage /> },
              // Shared lead queue + detail (all tenant roles can view):
              { path: 'leads', element: L(<LeadQueuePage />) },
              { path: 'leads/manual/:id', element: L(<ManualLeadDetailPage />) },
              // Manual lead workflow (generators + managers):
              {
                element: <RequireRole roles={['manager', 'lead_generator']} />,
                children: [
                  { path: 'templates', element: L(<LeadTemplatesPage />) },
                  { path: 'upload', element: L(<UploadPage />) },
                ],
              },
              // User management (SSA + managers) and org management (SSA only):
              {
                element: <RequireRole roles={['superadmin', 'admin', 'manager']} />,
                children: [{ path: 'users', element: L(<UsersPage />) }],
              },
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
