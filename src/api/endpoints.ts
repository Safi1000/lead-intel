/** Typed endpoint modules (§2 api/). Components never call axios directly. */
import { api } from './client'
import type {
  AdminClient,
  AIProviderConfig,
  ApiKey,
  ApiKeyUsage,
  AssistantResult,
  AuditEntry,
  AuthResponse,
  Batch,
  BatchReport,
  BillingState,
  Campaign,
  Conversation,
  CostSummary,
  ChatMessage,
  ErrorLogItem,
  EstimateResponse,
  ExportJob,
  ImportResult,
  Integration,
  LeadDetail,
  LeadRemark,
  LeadRow,
  LeadStatus,
  LeadTemplate,
  ManagedUser,
  ManualLead,
  Org,
  PermissionOverrides,
  Role,
  Temperature,
  MarketLock,
  MarketLockAvailability,
  MarketSummary,
  MeResponse,
  NotificationItem,
  NotificationPrefs,
  OutreachResult,
  Paginated,
  PredictiveSignals,
  ProfileSettings,
  RevenueSummary,
  Run,
  RunBuilderDraft,
  RunConfig,
  SubClient,
  TeamMember,
  Trade,
  UsageSummary,
  WaTemplate,
  Webhook,
  WebhookDelivery,
} from './types'

// ---- Auth ----
export const authApi = {
  login: (body: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', body).then((r) => r.data),
  me: () => api.get<MeResponse>('/auth/me').then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  forgotPassword: (body: { email: string }) =>
    api.post('/auth/forgot-password', body).then((r) => r.data),
  resetPassword: (body: { token: string; password: string }) =>
    api.post('/auth/reset-password', body).then((r) => r.data),
  acceptTos: () =>
    api.post<{ tos_accepted_at: string }>('/auth/accept-tos').then((r) => r.data),
}

// ---- Runs ----
export interface RunFilters {
  status?: string
  trade?: string
  search?: string
  page?: number
  page_size?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export const runsApi = {
  estimate: (body: RunConfig) =>
    api.post<EstimateResponse>('/runs/estimate', body).then((r) => r.data),
  create: (body: RunConfig) =>
    api.post<{ run: Run }>('/runs', body).then((r) => r.data.run),
  list: (params: RunFilters) =>
    api.get<Paginated<Run>>('/runs', { params }).then((r) => r.data),
  get: (id: string) => api.get<Run>(`/runs/${id}`).then((r) => r.data),
  cancel: (id: string) => api.post<Run>(`/runs/${id}/cancel`).then((r) => r.data),
  rerun: (id: string, mode: 'full' | 'failed') =>
    api.post<{ run: Run }>(`/runs/${id}/rerun`, { mode }).then((r) => r.data.run),
}

// ---- Leads ----
export interface LeadFilters {
  search?: string
  has_owner_phone?: boolean
  has_email?: boolean
  confidence?: string
  page?: number
  page_size?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export const leadsApi = {
  listForRun: (runId: string, params: LeadFilters) =>
    api
      .get<Paginated<LeadRow>>(`/runs/${runId}/leads`, { params })
      .then((r) => r.data),
  get: (id: string) => api.get<LeadDetail>(`/leads/${id}`).then((r) => r.data),
  update: (id: string, body: { notes?: string; tags?: string[] }) =>
    api.patch<LeadDetail>(`/leads/${id}`, body).then((r) => r.data),
}

// ---- Organizations (SSA) ----
export const orgsApi = {
  list: () => api.get<Org[]>('/orgs').then((r) => r.data),
  create: (name: string) => api.post<Org>('/orgs', { name }).then((r) => r.data),
  remove: (id: string) => api.delete(`/orgs/${id}`).then((r) => r.data),
}

// ---- User management (SSA / manager) ----
export interface CreateUserBody {
  name: string
  email: string
  password: string
  role: Role
  org_id: string | null
  permissions?: PermissionOverrides
}
export const usersApi = {
  list: (orgId?: string) => api.get<ManagedUser[]>('/users', { params: orgId ? { org_id: orgId } : undefined }).then((r) => r.data),
  create: (body: CreateUserBody) => api.post<ManagedUser>('/users', body).then((r) => r.data),
  update: (id: string, body: Partial<{ name: string; role: Role; permissions: PermissionOverrides; status: 'active' | 'disabled'; org_id: string | null }>) =>
    api.patch<ManagedUser>(`/users/${id}`, body).then((r) => r.data),
  resetPassword: (id: string, password: string) => api.post(`/users/${id}/reset-password`, { password }).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
}

// ---- Templates (manual upload) ----
export const templatesApi = {
  list: () => api.get<LeadTemplate[]>('/templates').then((r) => r.data),
  get: (id: string) => api.get<LeadTemplate>(`/templates/${id}`).then((r) => r.data),
  create: (body: { name: string; columns: { name: string; required: boolean }[] }) =>
    api.post<LeadTemplate>('/templates', body).then((r) => r.data),
  update: (id: string, body: { name: string; columns: { name: string; required: boolean }[] }) =>
    api.put<LeadTemplate>(`/templates/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/templates/${id}`).then((r) => r.data),
  import: (id: string, body: { headers: string[]; rows: Record<string, string>[] }) =>
    api.post<ImportResult>(`/templates/${id}/import`, body).then((r) => r.data),
}

// ---- Manual leads (shared-pool workflow) ----
export const manualLeadsApi = {
  list: (params?: { status?: LeadStatus; search?: string }) =>
    api.get<Paginated<ManualLead>>('/leads', { params }).then((r) => r.data),
  get: (id: string) => api.get<ManualLead>(`/leads/manual/${id}`).then((r) => r.data),
  update: (id: string, body: Partial<{ status: LeadStatus; temperature: Temperature; setter: string | null; closer: string | null }>) =>
    api.patch<ManualLead>(`/leads/manual/${id}`, body).then((r) => r.data),
  addRemark: (id: string, body: { text: string; author: string; author_role: Role }) =>
    api.post<LeadRemark>(`/leads/manual/${id}/remarks`, body).then((r) => r.data),
}

// ---- Batches / reports / exports ----
export const batchesApi = {
  list: () => api.get<Paginated<Batch>>('/batches').then((r) => r.data),
  report: (id: string) =>
    api.get<BatchReport>(`/batches/${id}/report`).then((r) => r.data),
}

export const exportsApi = {
  list: () => api.get<Paginated<ExportJob>>('/exports').then((r) => r.data),
  create: (body: {
    run_id?: string
    batch_id?: string
    format: 'csv' | 'xlsx'
    columns?: string[]
    confidence_filter?: string
  }) => api.post<ExportJob>('/exports', body).then((r) => r.data),
  get: (id: string) => api.get<ExportJob>(`/exports/${id}`).then((r) => r.data),
}

// ---- Settings ----
export const settingsApi = {
  getProfile: () =>
    api.get<ProfileSettings>('/settings/profile').then((r) => r.data),
  updateProfile: (body: Partial<ProfileSettings>) =>
    api.patch<ProfileSettings>('/settings/profile', body).then((r) => r.data),
  changePassword: (body: { current: string; next: string }) =>
    api.post('/settings/profile/password', body).then((r) => r.data),
  getNotifications: () =>
    api.get<NotificationPrefs>('/settings/notifications').then((r) => r.data),
  updateNotifications: (body: NotificationPrefs) =>
    api.patch<NotificationPrefs>('/settings/notifications', body).then((r) => r.data),
}

// ---- Notifications (bell) ----
export const notificationsApi = {
  list: () =>
    api.get<Paginated<NotificationItem>>('/notifications').then((r) => r.data),
  markRead: (id: string) =>
    api.post(`/notifications/${id}/read`).then((r) => r.data),
}

// ---- Admin ----
export const adminApi = {
  runs: (params: RunFilters) =>
    api.get<Paginated<Run>>('/admin/runs', { params }).then((r) => r.data),
  run: (id: string) => api.get<Run>(`/admin/runs/${id}`).then((r) => r.data),
  override: (id: string, body: { action: string; reason: string }) =>
    api.post<Run>(`/admin/runs/${id}/override`, body).then((r) => r.data),
  costs: (groupBy: 'run' | 'client') =>
    api.get<CostSummary>('/admin/costs', { params: { group_by: groupBy } }).then((r) => r.data),
  errors: () =>
    api.get<Paginated<ErrorLogItem>>('/admin/errors').then((r) => r.data),
  clients: () => api.get<Paginated<AdminClient>>('/admin/clients').then((r) => r.data),
  client: (id: string) => api.get<AdminClient>(`/admin/clients/${id}`).then((r) => r.data),
  suspendClient: (id: string, reason: string) =>
    api.post(`/admin/clients/${id}/suspend`, { reason }).then((r) => r.data),
  audit: () => api.get<Paginated<AuditEntry>>('/admin/audit').then((r) => r.data),
  marketLocks: () => api.get<Paginated<MarketLock>>('/admin/market-locks').then((r) => r.data),
  releaseLock: (id: string, reason: string) =>
    api.post(`/admin/market-locks/${id}/release`, { reason }).then((r) => r.data),
}

// ============== Phase 2 / Phase 3 ==============

export const tradesApi = {
  list: (country = 'US') =>
    api.get<Trade[]>('/trades', { params: { country } }).then((r) => r.data),
}

export const teamApi = {
  list: () => api.get<TeamMember[]>('/team').then((r) => r.data),
  invite: (body: { email: string; role: string }) =>
    api.post<TeamMember>('/team/invites', body).then((r) => r.data),
  resend: (id: string) => api.post(`/team/invites/${id}/resend`).then((r) => r.data),
  setRole: (id: string, role: string) =>
    api.patch(`/team/${id}/role`, { role }).then((r) => r.data),
  remove: (id: string) => api.delete(`/team/${id}`).then((r) => r.data),
}

export const billingApi = {
  get: () => api.get<BillingState>('/billing').then((r) => r.data),
  buyCredits: (amount: number) =>
    api.post<BillingState>('/billing/credits', { amount }).then((r) => r.data),
  changeTier: (tier: string) =>
    api.post<BillingState>('/billing/subscription', { tier }).then((r) => r.data),
}

export const marketLocksApi = {
  list: () => api.get<MarketLock[]>('/market-locks').then((r) => r.data),
  availability: (trade: string, area: string) =>
    api.get<MarketLockAvailability>('/market-locks/availability', { params: { trade, area } }).then((r) => r.data),
  buy: (body: { trade: string; area: string }) =>
    api.post<MarketLock>('/market-locks', body).then((r) => r.data),
  cancel: (id: string) => api.delete(`/market-locks/${id}`).then((r) => r.data),
}

export const usageApi = {
  get: (params?: { trade?: string }) =>
    api.get<UsageSummary>('/usage', { params }).then((r) => r.data),
}

export const marketMapApi = {
  get: (params: { trade?: string; city?: string }) =>
    api.get<{ zips: { zip: string; covered: boolean; leads: number; fill: number; locked?: boolean }[] }>('/market-map', { params }).then((r) => r.data),
}

export const integrationsApi = {
  list: () => api.get<Integration[]>('/integrations').then((r) => r.data),
  connect: (provider: string) =>
    api.post<Integration>(`/integrations/${provider}/connect`).then((r) => r.data),
  disconnect: (provider: string) =>
    api.delete(`/integrations/${provider}`).then((r) => r.data),
  setMapping: (provider: string, field_map: Record<string, string>) =>
    api.put(`/integrations/${provider}/mapping`, { field_map }).then((r) => r.data),
  test: (provider: string) =>
    api.post<{ created: number; updated: number; skipped: number }>(`/integrations/${provider}/test`).then((r) => r.data),
}

export const webhooksApi = {
  list: () => api.get<Webhook[]>('/webhooks').then((r) => r.data),
  create: (body: { url: string; events: string[] }) =>
    api.post<Webhook>('/webhooks', body).then((r) => r.data),
  update: (id: string, body: Partial<Webhook>) =>
    api.put<Webhook>(`/webhooks/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/webhooks/${id}`).then((r) => r.data),
  test: (id: string) =>
    api.post<{ status: number; body: string }>(`/webhooks/${id}/test`).then((r) => r.data),
  deliveries: (id: string) =>
    api.get<WebhookDelivery[]>(`/webhooks/${id}/deliveries`).then((r) => r.data),
}

export const apiKeysApi = {
  list: () => api.get<ApiKey[]>('/settings/api-keys').then((r) => r.data),
  create: (body: { name: string; scopes: string[]; rate_limit: number }) =>
    api.post<{ key: ApiKey; secret: string }>('/settings/api-keys', body).then((r) => r.data),
  revoke: (id: string) => api.delete(`/settings/api-keys/${id}`).then((r) => r.data),
  usage: (id: string) => api.get<ApiKeyUsage>(`/settings/api-keys/${id}/usage`).then((r) => r.data),
}

export const aiProvidersApi = {
  get: () => api.get<AIProviderConfig>('/settings/ai-providers').then((r) => r.data),
  update: (body: AIProviderConfig) =>
    api.put<AIProviderConfig>('/settings/ai-providers', body).then((r) => r.data),
}

export const aiApi = {
  outreachAngle: (leadId: string) =>
    api.post<OutreachResult>(`/ai/outreach-angle/${leadId}`).then((r) => r.data),
  outreach: (leadId: string, channel: string, tone: string) =>
    api.post<OutreachResult>(`/ai/outreach/${leadId}`, { channel, tone }).then((r) => r.data),
  sequence: (leadId: string) =>
    api.post<{ steps: { channel: string; delay: string; text: string }[] }>(`/ai/sequence/${leadId}`).then((r) => r.data),
  marketSummary: (runId: string) =>
    api.get<MarketSummary>(`/runs/${runId}/market-summary`).then((r) => r.data),
  predictive: (leadId: string) =>
    api.get<PredictiveSignals>(`/leads/${leadId}/predictive`).then((r) => r.data),
  assistant: (message: string) =>
    api.post<AssistantResult>('/ai/assistant/query', { message }).then((r) => r.data),
  runBuilder: (text: string) =>
    api.post<RunBuilderDraft>('/ai/run-builder/parse', { text }).then((r) => r.data),
}

export const campaignsApi = {
  list: () => api.get<Campaign[]>('/campaigns').then((r) => r.data),
  get: (id: string) => api.get<Campaign>(`/campaigns/${id}`).then((r) => r.data),
  create: (body: { name: string; template: string }) =>
    api.post<Campaign>('/campaigns', body).then((r) => r.data),
  templates: () => api.get<WaTemplate[]>('/campaigns/templates').then((r) => r.data),
  createTemplate: (body: { name: string; category: string; body: string }) =>
    api.post<WaTemplate>('/campaigns/templates', body).then((r) => r.data),
  submitTemplate: (id: string) =>
    api.post<WaTemplate>(`/campaigns/templates/${id}/submit`).then((r) => r.data),
}

export const inboxApi = {
  list: () => api.get<Conversation[]>('/inbox').then((r) => r.data),
  conversation: (id: string) =>
    api.get<{ conversation: Conversation; messages: ChatMessage[] }>(`/inbox/${id}`).then((r) => r.data),
  reply: (id: string, text: string) =>
    api.post<ChatMessage>(`/inbox/${id}/reply`, { text }).then((r) => r.data),
  suggest: (id: string) =>
    api.post<{ suggestions: string[] }>(`/inbox/${id}/suggest-replies`).then((r) => r.data),
}

export const resellerApi = {
  subClients: () => api.get<SubClient[]>('/reseller/sub-clients').then((r) => r.data),
  create: (name: string) => api.post<SubClient>('/reseller/sub-clients', { name }).then((r) => r.data),
  revenue: () => api.get<RevenueSummary>('/reseller/revenue').then((r) => r.data),
}
