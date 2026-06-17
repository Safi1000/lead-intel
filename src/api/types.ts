/** Shared DTOs — mirror the API contract (§17). */
import type { ConfidenceStatus, RunStage, RunStatus } from '../config/constants'
import type { FeatureFlags } from '../config/featureFlags'

export type Role =
  | 'superadmin'
  | 'admin'
  | 'client_owner'
  | 'client_admin'
  | 'client_member'
  | 'client_billing'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  avatar_url?: string | null
  timezone: string
  tos_accepted_at: string | null
}

export interface Client {
  id: string
  name: string
  plan: 'starter' | 'growth' | 'scale'
  credits_remaining: number | null
}

export interface MeResponse {
  user: User
  client: Client
  role: Role
  feature_flags: FeatureFlags
  tos_accepted_at: string | null
}

export interface AuthResponse {
  access_token: string
  refresh_token?: string
  user: User
}

/** Every lead field carries provenance + confidence (§17). */
export interface LeadField {
  value: string | null
  source: string | null
  source_url?: string | null
  confidence: ConfidenceStatus // includes 'missing' for absent values
  status: 'present' | 'missing'
  checked_at?: string | null
  reason?: string | null // why missing/unverified, shown in tooltip
}

export interface RunOptions {
  include_owner_phone: boolean
  max_leads?: number | null
  refresh_stale?: boolean
  ai_scoring?: boolean // [P2]
}

export interface RunLocation {
  city?: string
  zips?: string[]
}

export interface RunConfig {
  trade: string
  locations: RunLocation
  options: RunOptions
}

export interface StageProgress {
  stage: RunStage
  status: 'pending' | 'running' | 'done' | 'failed'
  pct: number
}

export interface FillRate {
  owner_email: number
  owner_phone: number
  business_phone: number
  business_email: number
  website: number
  social: number
  ads: number
  overall: number
}

export interface Run {
  id: string
  client_id: string
  client_name?: string
  trade: string
  location_label: string
  status: RunStatus
  progress: number // 0..1
  stages: StageProgress[]
  leads_found: number
  leads_enriched: number
  eta_seconds: number | null
  fill_rate: FillRate | null
  cost_cents: number | null
  created_at: string
  started_at?: string | null
  completed_at?: string | null
  started_by: string
  error_reason?: string | null
  failed_stages?: RunStage[]
}

export interface EstimateBreakdownItem {
  label: string
  cost_cents: number
}

export interface EstimateResponse {
  breakdown: EstimateBreakdownItem[]
  total_cents: number
  per_lead_cents: number
  est_leads: number
  est_eta_seconds: number
}

/** Compact lead row for the Lead List table. */
export interface LeadRow {
  id: string
  run_id: string
  business_name: string
  owner_name: LeadField
  business_phone: LeadField
  owner_phone: LeadField
  email: LeadField
  website_live: boolean | null
  ad_activity: 'active' | 'none' | null
  socials: string[]
  score: number | null // [P2]
  tags: string[] // [P2]
  /** Worst confidence among critical fields — drives row left-border. */
  row_confidence: ConfidenceStatus
}

export interface LeadDetail extends LeadRow {
  address: LeadField
  zip: LeadField
  owner_email: LeadField
  website: LeadField
  website_history?: string | null
  wayback_url?: string | null
  ad_link?: string | null
  marketing_signals?: {
    posting_frequency?: string
    last_post_at?: string | null
    review_sentiment?: string
  } | null
  ai_insight?: {
    outreach_angle?: string
    opener?: string
    score_rationale?: string
  } | null
  notes?: string | null
  sources: { field: string; source: string; source_url?: string | null; confidence: ConfidenceStatus }[]
}

export interface Batch {
  id: string
  run_id: string
  trade: string
  location_label: string
  lead_count: number
  fill_rate: number
  delivered_to: string
  delivered_at: string
  status: 'delivered' | 'pending'
  deduped_count: number
}

export interface BatchReport {
  batch: Batch
  per_field: { field: string; fill: number }[]
  confidence_distribution: Record<ConfidenceStatus, number>
  cost_cents: number | null
}

export interface ExportJob {
  id: string
  status: 'queued' | 'processing' | 'ready' | 'failed'
  format: 'csv' | 'xlsx'
  download_url: string | null
  created_at: string
  row_count: number
  label: string
}

export interface Paginated<T> {
  data: T[]
  page: number
  page_size: number
  total: number
}

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> }
}

export interface NotificationItem {
  id: string
  type: 'batch_ready' | 'hot_lead' | 'run_failed' | 'summary'
  title: string
  body: string
  created_at: string
  read: boolean
  link?: string
}

export interface NotificationPrefs {
  batch_ready: { email: boolean; whatsapp: boolean }
  hot_lead: { email: boolean; whatsapp: boolean }
  run_failed: { email: boolean; whatsapp: boolean }
  weekly_summary: { email: boolean; whatsapp: boolean }
}

export interface ProfileSettings {
  name: string
  email: string
  timezone: string
  language: string
  avatar_url?: string | null
}

export interface CostRow {
  group: string // run id or client name
  label: string
  api_breakdown: { api: string; cost_cents: number; calls: number }[]
  total_cents: number
}

export interface CostSummary {
  rows: CostRow[]
  monthly_total_cents: number
  monthly_ceiling_cents: number
  near_cap: { api: string; pct: number }[]
}

export interface ErrorLogItem {
  id: string
  created_at: string
  run_id: string | null
  client_name: string
  source: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  resolved: boolean
}
