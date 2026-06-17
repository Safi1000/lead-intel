import * as React from 'react'
import { useAuthStore } from '../../stores/authStore'
import { can, type Action, type Resource } from '../../config/permissions'
import { Tooltip } from '../ui/controls'

/** Hook form of the RBAC check (§I-4). */
export function useCan(action: Action, resource: Resource): boolean {
  const role = useAuthStore((s) => s.role)
  return can(role, action, resource)
}

/**
 * <Can> guard. Default: hide when unauthorized (destructive/billing).
 * Set `disable` to render children disabled with a "requires role" tooltip
 * (informational-but-restricted actions).
 */
export function Can({
  action,
  resource,
  children,
  fallback = null,
  disable,
  reason = 'You don’t have permission for this action.',
}: {
  action: Action
  resource: Resource
  children: React.ReactNode
  fallback?: React.ReactNode
  disable?: boolean
  reason?: string
}) {
  const allowed = useCan(action, resource)
  if (allowed) return <>{children}</>
  if (disable) {
    return (
      <Tooltip content={reason}>
        <span className="inline-flex cursor-not-allowed opacity-50 [&_*]:pointer-events-none">{children}</span>
      </Tooltip>
    )
  }
  return <>{fallback}</>
}
