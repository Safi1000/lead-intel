import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { runsApi } from '../api/endpoints'
import { useAuthStore } from '../stores/authStore'
import { ACTIVE_RUN_STATUSES, POLL_INTERVAL_MS } from '../config/constants'
import type { FeatureFlagKey } from '../config/featureFlags'

export function useAuth() {
  return useAuthStore()
}

/** Feature flag gate (§18-7). */
export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  return useAuthStore((s) => s.flags[flag])
}

export function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/**
 * Live run progress (§8, §18-D). MVP transport = polling; abstracted so a
 * Phase-2 WebSocket/SSE swap needs no UI change.
 */
export function useRunProgress(runId: string | undefined, admin = false) {
  return useQuery({
    queryKey: ['run', runId, admin],
    queryFn: () => runsApi.get(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ACTIVE_RUN_STATUSES.includes(status) ? POLL_INTERVAL_MS : false
    },
  })
}
