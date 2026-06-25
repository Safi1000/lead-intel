import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { runsApi } from '../api/endpoints'
import { bookingsApi } from '../api/bookings'
import { useAuthStore } from '../stores/authStore'
import { ACTIVE_RUN_STATUSES, BOOKINGS_SYNC_INTERVAL_MS, POLL_INTERVAL_MS } from '../config/constants'
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

/**
 * Upcoming Calendly meetings for an AE (§Bookings). MVP transport = polling
 * (Free plan has no webhooks); modeled on useRunProgress so a future
 * webhook/WebSocket swap needs zero UI change. Polling pauses while the tab is
 * hidden and refetches on focus to stay cheap and fresh.
 */
export function useBookingsSync(aeId: string | undefined) {
  const [hidden, setHidden] = React.useState(() => typeof document !== 'undefined' && document.hidden)

  React.useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const query = useQuery({
    queryKey: ['bookings', 'upcoming', aeId],
    queryFn: () => bookingsApi.getUpcomingMeetings(aeId as string),
    enabled: Boolean(aeId),
    refetchInterval: hidden ? false : BOOKINGS_SYNC_INTERVAL_MS,
    refetchOnWindowFocus: true,
  })

  return {
    meetings: query.data ?? [],
    lastSyncedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}
