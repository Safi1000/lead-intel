import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore, isAdminRole } from '../stores/authStore'
import type { Role } from '../api/types'
import type { FeatureFlagKey } from '../config/featureFlags'
import { ComingSoon } from '../features/shared/ComingSoon'
import { LoadingState } from '../components/feedback'

/** RequireAuth — redirect to /login preserving returnTo (§4.3). */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()
  if (status === 'unknown') return <LoadingState label="Restoring session…" />
  if (status !== 'authenticated') {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />
  }
  return <Outlet />
}

/** RequireTOS — force ToS acceptance gate before any app route (§4.3). */
export function RequireTOS() {
  const tos = useAuthStore((s) => s.tosAcceptedAt)
  if (!tos) return <Navigate to="/terms?gate=1" replace />
  return <Outlet />
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const role = useAuthStore((s) => s.role)
  if (!role || !roles.includes(role)) return <Navigate to="/403" replace />
  return <Outlet />
}

export function RequireAdmin() {
  const role = useAuthStore((s) => s.role)
  if (!isAdminRole(role)) return <Navigate to="/403" replace />
  return <Outlet />
}

/** Org-workspace routes require an org context. The SA must enter one first. */
export function RequireOrgContext() {
  const role = useAuthStore((s) => s.role)
  const actingOrgId = useAuthStore((s) => s.actingOrgId)
  const isSA = role === 'superadmin' || role === 'admin'
  if (isSA && !actingOrgId) return <Navigate to="/organizations" replace />
  return <Outlet />
}

/** RequireFeature — render Coming-Soon shell if flag off, never a dead link. */
export function RequireFeature({ flag, title }: { flag: FeatureFlagKey; title: string }) {
  const on = useAuthStore((s) => s.flags[flag])
  if (!on) return <ComingSoon title={title} />
  return <Outlet />
}
