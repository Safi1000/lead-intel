import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { AdminShell } from '../components/layout/AdminShell'
import { RequireAuth, RequireAdmin, RequireTOS, RequireFeature } from './guards'
import { RouteErrorBoundary, NotFoundPage, ForbiddenPage, MaintenancePage } from '../features/misc/ErrorPages'
import { LegalPage } from '../features/misc/Legal'
import { LoginPage } from '../features/auth/Login'
import { ForgotPasswordPage } from '../features/auth/ForgotPassword'
import { ResetPasswordPage } from '../features/auth/ResetPassword'
import { ComingSoon } from '../features/shared/ComingSoon'
// Client features
import { HomePage } from '../features/runs/Home'
import { NewRunPage } from '../features/runs/NewRun'
import { RunDetailPage } from '../features/runs/RunDetail'
import { RunHistoryPage } from '../features/runs/RunHistory'
import { LeadListPage } from '../features/leads/LeadList'
import { LeadDetailPage } from '../features/leads/LeadDetail'
import { ExportsPage } from '../features/exports/Exports'
import { BatchesPage, FillRateReportPage } from '../features/batches/Batches'
import { SettingsLayout, SettingsGate } from '../features/settings/Settings'
import { ProfileSettingsPage } from '../features/settings/Profile'
import { NotificationsSettingsPage } from '../features/settings/Notifications'
// Admin
import { AdminRunsPage } from '../features/admin/AdminRuns'
import { AdminRunDetailPage } from '../features/admin/AdminRunDetail'
import { AdminCostsPage, AdminErrorsPage } from '../features/admin/AdminCostsErrors'

export const router = createBrowserRouter([
  // ---- Public / auth ----
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/signup', element: <ComingSoon title="Self-serve sign-up" description="Account creation is admin-provisioned in MVP; self-serve sign-up arrives in Phase 2." /> },
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
              { path: 'home', element: <HomePage /> },
              { path: 'runs/new', element: <NewRunPage /> },
              { path: 'runs', element: <RunHistoryPage /> },
              { path: 'runs/:runId', element: <RunDetailPage /> },
              { path: 'runs/:runId/leads', element: <LeadListPage /> },
              { path: 'leads/:leadId', element: <LeadDetailPage /> },
              { path: 'batches', element: <BatchesPage /> },
              { path: 'batches/:batchId/report', element: <FillRateReportPage /> },
              { path: 'exports', element: <ExportsPage /> },
              // P2/P3 feature-gated routes
              { element: <RequireFeature flag="marketMap" title="Market coverage map" />, children: [{ path: 'market-map', element: <div /> }] },
              { element: <RequireFeature flag="usage" title="Usage dashboard" />, children: [{ path: 'usage', element: <div /> }] },
              { element: <RequireFeature flag="assistant" title="AI assistant" />, children: [{ path: 'assistant', element: <div /> }] },
              { element: <RequireFeature flag="outreach" title="Outreach drafts" />, children: [{ path: 'outreach', element: <div /> }] },
              { element: <RequireFeature flag="campaigns" title="WhatsApp campaigns" />, children: [{ path: 'campaigns', element: <div /> }] },
              { element: <RequireFeature flag="inbox" title="Response inbox" />, children: [{ path: 'inbox', element: <div /> }] },
              // Settings (tabbed)
              {
                path: 'settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <Navigate to="/settings/profile" replace /> },
                  { path: 'profile', element: <ProfileSettingsPage /> },
                  { path: 'notifications', element: <NotificationsSettingsPage /> },
                  { element: <SettingsGate flag="apiKeys" title="API Keys" />, children: [{ path: 'api-keys', element: <div /> }] },
                  { element: <SettingsGate flag="webhooks" title="Webhooks" />, children: [{ path: 'webhooks', element: <div /> }] },
                  { element: <SettingsGate flag="team" title="Team & Roles" />, children: [{ path: 'team', element: <div /> }] },
                  { element: <SettingsGate flag="billing" title="Billing & Plan" />, children: [{ path: 'billing', element: <div /> }] },
                  { element: <SettingsGate flag="integrations" title="Integrations" />, children: [{ path: 'integrations', element: <div /> }] },
                  { element: <SettingsGate flag="aiProviders" title="AI Providers" />, children: [{ path: 'ai-providers', element: <div /> }] },
                  { element: <SettingsGate flag="branding" title="White-label Branding" phase="Phase 3" />, children: [{ path: 'branding', element: <div /> }] },
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
              { index: true, element: <Navigate to="/admin/runs" replace /> },
              { path: 'runs', element: <AdminRunsPage /> },
              { path: 'runs/:runId', element: <AdminRunDetailPage /> },
              { path: 'costs', element: <AdminCostsPage /> },
              { path: 'errors', element: <AdminErrorsPage /> },
              { element: <RequireFeature flag="billing" title="Client accounts" />, children: [{ path: 'clients', element: <div /> }, { path: 'clients/:clientId', element: <div /> }] },
              { element: <RequireFeature flag="marketMap" title="Market lock management" />, children: [{ path: 'market-locks', element: <div /> }] },
              { element: <RequireFeature flag="resellers" title="Reseller management" />, children: [{ path: 'resellers', element: <div /> }] },
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
])
