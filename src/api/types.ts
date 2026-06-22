/** Shared DTOs — mirror the API contract (§17). */
import type { ConfidenceStatus, RunStage, RunStatus } from '../config/constants'
import type { FeatureFlags } from '../config/featureFlags'

export type Role =
  // Internal platform staff
  | 'superadmin'
  | 'admin'
  // Tenant roles (manual lead-handling workflow)
  | 'manager' // tenant admin: manages users, oversees everything
  | 'lead_generator' // uploads leads via templates
  | 'setter' // tests/calls leads, leaves remarks, sets warm/cold
  | 'closer' // closes/keeps-open/returns leads, sets warm/cold

export interface User {
  id: string
  name: string
  email: string
  role: Role
  org_id: string | null // null = SSA (cross-org)
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

/** Explicit per-user permission overrides layered on top of the role matrix. */
export interface PermissionOverrides {
  granted: string[] // "resource:action" keys force-allowed
  denied: string[] // "resource:action" keys force-denied
}

export interface MeResponse {
  user: User
  client: Client // the user's org (synthetic "All organizations" for SSA)
  role: Role
  feature_flags: FeatureFlags
  permissions: PermissionOverrides
  /** Org the user is operating in: their own org, or the org an SA has entered. null = SA on the org list. */
  acting_org_id: string | null
  tos_accepted_at: string | null
}

// ---- Organizations & user management ----
export interface Org {
  id: string
  name: string
  created_at: string
  user_count?: number
  manager_count?: number
}

export interface ManagedUser {
  id: string
  name: string
  email: string
  role: Role
  org_id: string | null
  org_name?: string | null
  status: 'active' | 'disabled'
  permissions: PermissionOverrides
  created_at: string
  created_by?: string | null
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
  hot: boolean // [P2] high-value (poor online presence)
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
  // P2-4 enhanced enrichment
  linkedin?: LeadField
  tech_stack?: string[]
  sentiment?: { score: number; themes: string[] } | null
  business_age?: LeadField
  // P3-6 add-ons (gated by entitlement)
  property?: { roof_age?: string; last_permit?: string; storm_activity?: string } | null
  competitors?: { name: string; rating: number }[]
  domain_signals?: { expiry?: string; ssl?: string; last_update?: string } | null
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

// ============== Phase 2 / Phase 3 DTOs ==============

export interface Trade {
  id: string
  label: string
  enabled: boolean
  icon: string
  signal_hint: string
  expected_fill: number
}

// --- Team / RBAC ---
export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  status: 'active' | 'invited'
  last_active?: string | null
}

// --- Billing / market locks ---
export interface PlanTier {
  id: string
  name: string
  price_cents: number
  included_credits: number
  features: string[]
  current?: boolean
}
export interface Invoice {
  id: string
  number: string
  date: string
  amount_cents: number
  status: 'paid' | 'open' | 'void'
}
export interface PaymentMethod {
  id: string
  brand: string
  last4: string
  exp: string
  default: boolean
}
export interface BillingState {
  plan: string
  tier: string
  currency: 'USD' | 'CAD' | 'GBP'
  balance_credits: number
  included_credits: number
  used_credits: number
  payment_methods: PaymentMethod[]
  invoices: Invoice[]
  tiers: PlanTier[]
}
export interface MarketLock {
  id: string
  trade: string
  area: string
  expires_at: string
  auto_renew: boolean
  client_name?: string
}
export interface MarketLockAvailability {
  available: boolean
  price_cents: number
  locked_until?: string | null
  locked_by?: string | null
}

// --- Usage ---
export interface UsagePoint {
  date: string
  credits: number
  leads: number
  fill: number
}
export interface UsageSummary {
  series: UsagePoint[]
  total_credits: number
  total_leads: number
  by_trade: { trade: string; leads: number; credits: number }[]
}

// --- Integrations / webhooks ---
export interface Integration {
  provider: string
  status: 'connected' | 'disconnected' | 'expired'
  account_name?: string | null
  connected_at?: string | null
  mapping?: Record<string, string>
}
export interface Webhook {
  id: string
  url: string
  events: string[]
  enabled: boolean
  secret: string
  last_delivery?: { status: number; at: string } | null
}
export interface WebhookDelivery {
  id: string
  event: string
  status: number
  at: string
  duration_ms: number
}

// --- API keys ---
export interface ApiKey {
  id: string
  name: string
  masked: string
  scopes: string[]
  rate_limit: number
  created_at: string
  last_used?: string | null
}
export interface ApiKeyUsage {
  series: { date: string; calls: number; errors: number }[]
  total_calls: number
  total_429: number
}

// --- AI providers ---
export type AITask = 'scoring' | 'copy' | 'summary'
export interface AIProviderConfig {
  assignments: Record<AITask, string>
  byo_keys: Record<string, { present: boolean; valid: boolean }>
  batch_open_source: boolean
}

// --- AI generation ---
export interface OutreachResult {
  channel: string
  tone: string
  text: string
  provider: string
}
export interface MarketSummary {
  run_id: string
  narrative: string
  stats: { label: string; value: number }[]
  provider: string
}
export interface PredictiveSignals {
  best_windows: { day: string; window: string; confidence: number }[]
  seasonal: string
}
export interface AssistantResult {
  answer: string
  provider: string
  table?: LeadRow[]
}
export interface RunBuilderDraft {
  trade: string
  city: string
  include_owner_phone: boolean
  confidence: number
}

// --- Campaigns / WhatsApp / inbox ---
export interface WaTemplate {
  id: string
  name: string
  category: string
  language: string
  body: string
  status: 'approved' | 'pending' | 'rejected'
  reject_reason?: string | null
}
export interface Campaign {
  id: string
  name: string
  template: string
  audience_size: number
  status: 'draft' | 'scheduled' | 'sending' | 'sent'
  delivered: number
  read: number
  replied: number
  created_at: string
}
export interface Conversation {
  id: string
  lead_id: string
  business_name: string
  last_message: string
  unread: number
  updated_at: string
  assignee?: string | null
  resolved: boolean
}
export interface ChatMessage {
  id: string
  direction: 'in' | 'out'
  text: string
  at: string
  status?: 'sent' | 'delivered' | 'read'
}

// --- Reseller / white-label ---
export interface SubClient {
  id: string
  name: string
  plan: string
  leads_delivered: number
  fill: number
  status: 'active' | 'suspended'
}
export interface RevenueSummary {
  commission_cents: number
  pending_cents: number
  statements: { period: string; amount_cents: number; status: string }[]
}

// --- Admin ---
export interface AdminClient {
  id: string
  name: string
  plan: string
  status: 'active' | 'suspended' | 'deleting'
  leads_delivered: number
  spend_cents: number
  created_at: string
  retention_days?: number | null
}
export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  resource: string
  client: string
  reason?: string | null
}

// ============== Phase 1 — Manual lead workflow ==============

/** A column the uploaded Excel sheet must provide. Header match is CASE-SENSITIVE. */
export interface TemplateColumn {
  id: string
  name: string // exact, case-sensitive header expected in the sheet
  required: boolean
}

export interface LeadTemplate {
  id: string
  name: string
  org_id: string | null
  columns: TemplateColumn[]
  created_by: string
  created_at: string
  updated_at: string
  lead_count: number // leads imported against this template
}

/** Lead lifecycle in the shared-pool workflow (generator → setter → closer). */
export type LeadStatus =
  | 'new' // imported, in the unclaimed pool
  | 'with_setter' // a setter is testing/calling
  | 'with_closer' // setter finished → in the closer pool
  | 'open' // closer is keeping it open / working it
  | 'closed' // closer closed (done)
  | 'returned' // closer sent it back to a setter

export type Temperature = 'warm' | 'cold' | null

export interface LeadRemark {
  id: string
  author: string
  author_role: Role
  text: string
  at: string
}

export interface ManualLead {
  id: string
  org_id: string | null
  template_id: string
  template_name: string
  /** Raw imported cell values, keyed by the template's case-sensitive column names. */
  data: Record<string, string>
  display_name: string // best-effort primary label for lists
  status: LeadStatus
  temperature: Temperature
  setter: string | null // claiming setter (name)
  closer: string | null // claiming closer (name)
  remarks: LeadRemark[]
  created_at: string
  updated_at: string
}

/** Result of importing an Excel sheet against a template. */
export interface ImportRejection {
  row: number // 1-based row number in the sheet (excluding header)
  reason: string
}
export interface ImportResult {
  template_id: string
  total_rows: number
  imported: number
  rejected: ImportRejection[]
}
