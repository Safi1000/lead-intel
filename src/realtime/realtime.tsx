import * as React from 'react'
import { Radio, WifiOff } from 'lucide-react'
import { cn } from '../lib/utils'

/**
 * Real-time transport abstraction (§I-1). In this MSW build it simulates a
 * WebSocket: connection lifecycle + a channel pub/sub. The public API
 * (status + subscribe) matches a real socket so swapping the transport
 * later needs no UI change. Polling remains the automatic fallback for
 * data that already uses TanStack Query.
 */
type Status = 'connecting' | 'live' | 'reconnecting' | 'offline'
type Handler = (payload: unknown) => void

interface RealtimeCtx {
  status: Status
  subscribe: (channel: string, handler: Handler) => () => void
  publish: (channel: string, payload: unknown) => void
}

const Ctx = React.createContext<RealtimeCtx | null>(null)

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>('connecting')
  const handlers = React.useRef(new Map<string, Set<Handler>>())

  React.useEffect(() => {
    const t = setTimeout(() => setStatus('live'), 600)
    const onOffline = () => setStatus('offline')
    const onOnline = () => setStatus('live')
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      clearTimeout(t)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const subscribe = React.useCallback((channel: string, handler: Handler) => {
    if (!handlers.current.has(channel)) handlers.current.set(channel, new Set())
    handlers.current.get(channel)!.add(handler)
    return () => handlers.current.get(channel)?.delete(handler)
  }, [])

  const publish = React.useCallback((channel: string, payload: unknown) => {
    handlers.current.get(channel)?.forEach((h) => h(payload))
  }, [])

  return <Ctx.Provider value={{ status, subscribe, publish }}>{children}</Ctx.Provider>
}

export function useRealtimeStatus(): Status {
  return React.useContext(Ctx)?.status ?? 'offline'
}

/** Subscribe to a channel; handler fires on each message. */
export function useRealtime(channel: string | null, handler: Handler) {
  const ctx = React.useContext(Ctx)
  const ref = React.useRef(handler)
  ref.current = handler
  React.useEffect(() => {
    if (!ctx || !channel) return
    return ctx.subscribe(channel, (p) => ref.current(p))
  }, [ctx, channel])
}

export function usePublish() {
  return React.useContext(Ctx)?.publish ?? (() => {})
}

export function ConnectionChip() {
  const status = useRealtimeStatus()
  const map = {
    connecting: { label: 'Connecting', dot: 'bg-amber-400', icon: Radio },
    live: { label: 'Live', dot: 'bg-[var(--color-signal)] pulse-signal', icon: Radio },
    reconnecting: { label: 'Reconnecting', dot: 'bg-amber-400 animate-pulse', icon: Radio },
    offline: { label: 'Offline', dot: 'bg-slate-400', icon: WifiOff },
  }[status]
  const Icon = map.icon
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] sm:inline-flex"
      aria-live="polite"
      title={`Real-time: ${map.label}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', map.dot)} />
      <Icon className="h-3 w-3" /> {map.label}
    </span>
  )
}
