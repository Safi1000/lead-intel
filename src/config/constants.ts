/** Platform constants (§2 config/constants.ts). */

export const POLL_INTERVAL_MS = 5000 // live run progress polling (§8, §18-D)
export const SEARCH_DEBOUNCE_MS = 300
export const LEAD_PAGE_SIZE = 100 // keep page size <= 100 (§10)

export interface TradeDef {
  id: string
  label: string
  enabled: boolean // MVP=Roofing only (§18-E)
  icon: string
}

export const TRADES: TradeDef[] = [
  { id: 'roofing', label: 'Roofing', enabled: true, icon: 'Home' },
  { id: 'hvac', label: 'HVAC', enabled: false, icon: 'Wind' },
  { id: 'plumbing', label: 'Plumbing', enabled: false, icon: 'Wrench' },
  { id: 'electrical', label: 'Electrical', enabled: false, icon: 'Zap' },
  { id: 'landscaping', label: 'Landscaping', enabled: false, icon: 'Trees' },
  { id: 'painting', label: 'Painting', enabled: false, icon: 'Paintbrush' },
]

export const RUN_STAGES = [
  'Discovery',
  'Owner ID',
  'Contact discovery',
  'Verification',
  'Scoring',
  'Packaging',
] as const
export type RunStage = (typeof RUN_STAGES)[number]

export type ConfidenceStatus = 'verified' | 'probable' | 'unverified' | 'missing'

export interface ConfidenceMeta {
  label: string
  dotClass: string
  badgeClass: string
  hollow: boolean
}

/** Confidence map (§3.2). Color is never the only signal — label always shown. */
export const CONFIDENCE: Record<ConfidenceStatus, ConfidenceMeta> = {
  verified: {
    label: 'Verified',
    dotClass: 'bg-[var(--c-verified)]',
    badgeClass: 'bg-[var(--c-verified-bg)] text-[var(--c-verified-text)]',
    hollow: false,
  },
  probable: {
    label: 'Probable',
    dotClass: 'bg-[var(--c-probable)]',
    badgeClass: 'bg-[var(--c-probable-bg)] text-[var(--c-probable-text)]',
    hollow: false,
  },
  unverified: {
    label: 'Unverified',
    dotClass: 'bg-[var(--c-unverified)]',
    badgeClass: 'bg-[var(--c-unverified-bg)] text-[var(--c-unverified-text)]',
    hollow: false,
  },
  missing: {
    label: 'Not found',
    dotClass: 'border border-[var(--c-missing)] bg-transparent',
    badgeClass: 'bg-[var(--c-missing-bg)] text-[var(--c-missing-text)]',
    hollow: true,
  },
}

export const RUN_STATUSES = [
  'queued',
  'running',
  'paused',
  'completed',
  'partial',
  'failed',
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_STATUS_META: Record<
  RunStatus,
  { label: string; className: string }
> = {
  queued: { label: 'Queued', className: 'bg-slate-100 text-slate-600' },
  running: { label: 'Running', className: 'bg-blue-50 text-blue-700' },
  paused: { label: 'Paused', className: 'bg-amber-50 text-amber-700' },
  completed: { label: 'Completed', className: 'bg-green-50 text-green-700' },
  partial: { label: 'Partial', className: 'bg-amber-50 text-amber-700' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-700' },
}

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['queued', 'running', 'paused']
