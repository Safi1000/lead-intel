/** Typed endpoint modules (§2 api/). Components never call axios directly. */
import { api } from './client'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { DEFAULT_FLAGS } from '../config/featureFlags'
import { clearActingOrg, loadActingOrg } from '../lib/actingOrg'
import type { Client, TemplateColumn, User } from './types'
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

// ===== Supabase-backed core (auth, orgs, users, templates, leads) =====

/** Org the signed-in user effectively operates in (SA → entered org; others → own org). */
function effectiveOrgId(): string | null {
  const s = useAuthStore.getState()
  const isSA = s.role === 'superadmin' || s.role === 'admin'
  return isSA ? s.actingOrgId : (s.user?.org_id ?? null)
}

interface ProfileRow {
  id: string
  name: string
  email: string
  role: Role
  org_id: string | null
  status: 'active' | 'disabled'
  permissions: PermissionOverrides
  timezone: string
  tos_accepted_at: string | null
  created_by: string | null
  created_at: string
  org?: { id?: string; name?: string } | null
}

const toUser = (p: ProfileRow): User => ({ id: p.id, name: p.name, email: p.email, role: p.role, org_id: p.org_id, timezone: p.timezone, tos_accepted_at: p.tos_accepted_at })
const toManagedUser = (p: ProfileRow): ManagedUser => ({ id: p.id, name: p.name, email: p.email, role: p.role, org_id: p.org_id, org_name: p.org?.name ?? null, status: p.status, permissions: p.permissions, created_at: p.created_at, created_by: p.created_by })

async function fetchProfile(id: string): Promise<ProfileRow | null> {
  const { data } = await supabase.from('profiles').select('*, org:orgs(id,name)').eq('id', id).single()
  return (data as ProfileRow) ?? null
}

/** Invoke the privileged `admin` edge function; surface its error message. */
async function invokeAdmin<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin', { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* ignore */ } }
    throw new Error(msg)
  }
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as { error: string }).error)
  return data as T
}

// ---- Auth ----
export const authApi = {
  login: async (body: { email: string; password: string }): Promise<AuthResponse> => {
    clearActingOrg()
    const { data, error } = await supabase.auth.signInWithPassword({ email: body.email.trim(), password: body.password })
    if (error || !data.session || !data.user) throw new Error(error?.message ?? 'Invalid email or password.')
    const profile = await fetchProfile(data.user.id)
    if (!profile) { await supabase.auth.signOut(); throw new Error('No profile is linked to this account.') }
    if (profile.status === 'disabled') { await supabase.auth.signOut(); throw new Error('This account has been disabled.') }
    return { access_token: data.session.access_token, user: toUser(profile) }
  },
  me: async (): Promise<MeResponse> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    const profile = await fetchProfile(user.id)
    if (!profile) throw new Error('No profile')
    const isSA = profile.role === 'superadmin' || profile.role === 'admin'
    let client: Client
    let acting_org_id: string | null
    if (isSA) {
      const acting = loadActingOrg()
      acting_org_id = acting?.id ?? null
      client = acting ? { id: acting.id, name: acting.name, plan: 'growth', credits_remaining: null } : { id: '*', name: 'All organizations', plan: 'scale', credits_remaining: null }
    } else {
      acting_org_id = profile.org_id
      client = { id: profile.org_id ?? '*', name: profile.org?.name ?? 'Organization', plan: 'growth', credits_remaining: null }
    }
    return { user: toUser(profile), client, role: profile.role, feature_flags: DEFAULT_FLAGS, permissions: profile.permissions, acting_org_id, tos_accepted_at: profile.tos_accepted_at }
  },
  logout: async () => { clearActingOrg(); await supabase.auth.signOut() },
  forgotPassword: async (body: { email: string }) => { await supabase.auth.resetPasswordForEmail(body.email.trim()) },
  resetPassword: async (body: { token: string; password: string }) => { await supabase.auth.updateUser({ password: body.password }) },
  acceptTos: async (): Promise<{ tos_accepted_at: string }> => {
    const { data, error } = await supabase.rpc('accept_tos')
    if (error) throw new Error(error.message)
    return { tos_accepted_at: data as string }
  },
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
  list: async (): Promise<Org[]> => {
    const { data: orgs, error } = await supabase.from('orgs').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    const { data: profs } = await supabase.from('profiles').select('org_id, role')
    return (orgs ?? []).map((o) => ({
      ...o,
      user_count: (profs ?? []).filter((p) => p.org_id === o.id).length,
      manager_count: (profs ?? []).filter((p) => p.org_id === o.id && p.role === 'manager').length,
    }))
  },
  create: async (name: string): Promise<Org> => {
    const { data, error } = await supabase.from('orgs').insert({ name: name.trim() }).select().single()
    if (error) throw new Error(error.message)
    return data as Org
  },
  remove: (id: string) => invokeAdmin({ action: 'delete_org', id }),
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
  list: async (): Promise<ManagedUser[]> => {
    const org = effectiveOrgId()
    let q = supabase.from('profiles').select('*, org:orgs(id,name)').neq('role', 'superadmin').order('created_at', { ascending: false })
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data as ProfileRow[]).map(toManagedUser)
  },
  create: (body: CreateUserBody) => invokeAdmin<ManagedUser>({ action: 'create_user', ...body, org_id: body.org_id ?? effectiveOrgId() }),
  update: (id: string, body: Partial<{ name: string; role: Role; permissions: PermissionOverrides; status: 'active' | 'disabled' }>) =>
    invokeAdmin({ action: 'update_user', id, ...body }),
  resetPassword: (id: string, password: string) => invokeAdmin({ action: 'reset_password', id, password }),
  remove: (id: string) => invokeAdmin({ action: 'delete_user', id }),
}

// ---- Templates (manual upload) ----
const withIds = (cols: { name: string; required: boolean }[]): TemplateColumn[] =>
  cols.map((c) => ({ id: crypto.randomUUID(), name: c.name, required: c.required }))
const mapTemplate = (t: Record<string, unknown>, lead_count = 0): LeadTemplate => ({
  id: t.id as string, name: t.name as string, org_id: (t.org_id as string) ?? null,
  columns: (t.columns as TemplateColumn[]) ?? [], created_by: (t.created_by as string) ?? '',
  created_at: t.created_at as string, updated_at: t.updated_at as string, lead_count,
})
function leadDisplayName(data: Record<string, string>, cols: TemplateColumn[]): string {
  const preferred = cols.find((c) => /name|business|company|contact/i.test(c.name))
  const key = preferred?.name ?? cols[0]?.name
  return (key && data[key]) || 'Untitled lead'
}

export const templatesApi = {
  list: async (): Promise<LeadTemplate[]> => {
    const org = effectiveOrgId()
    let q = supabase.from('templates').select('*').order('created_at', { ascending: false })
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const tpls = data ?? []
    const counts: Record<string, number> = {}
    if (tpls.length) {
      let lq = supabase.from('leads').select('template_id')
      if (org) lq = lq.eq('org_id', org)
      const { data: leadRows } = await lq
      for (const r of leadRows ?? []) if (r.template_id) counts[r.template_id] = (counts[r.template_id] ?? 0) + 1
    }
    return tpls.map((t) => mapTemplate(t, counts[t.id as string] ?? 0))
  },
  get: async (id: string): Promise<LeadTemplate> => {
    const { data, error } = await supabase.from('templates').select('*').eq('id', id).single()
    if (error || !data) throw new Error('Template not found.')
    return mapTemplate(data)
  },
  create: async (body: { name: string; columns: { name: string; required: boolean }[] }): Promise<LeadTemplate> => {
    const created_by = useAuthStore.getState().user?.name ?? null
    const { data, error } = await supabase.from('templates').insert({ name: body.name, columns: withIds(body.columns), org_id: effectiveOrgId(), created_by }).select().single()
    if (error) throw new Error(error.message)
    return mapTemplate(data)
  },
  update: async (id: string, body: { name: string; columns: { name: string; required: boolean }[] }): Promise<LeadTemplate> => {
    const { data, error } = await supabase.from('templates').update({ name: body.name, columns: withIds(body.columns), updated_at: new Date().toISOString() }).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    return mapTemplate(data)
  },
  remove: async (id: string) => { const { error } = await supabase.from('templates').delete().eq('id', id); if (error) throw new Error(error.message) },
  import: async (id: string, body: { headers: string[]; rows: Record<string, string>[] }): Promise<ImportResult> => {
    const { data: t, error } = await supabase.from('templates').select('*').eq('id', id).single()
    if (error || !t) throw new Error('Template not found.')
    const cols = (t.columns as TemplateColumn[]) ?? []
    const missing = cols.filter((c) => c.required && !body.headers.includes(c.name))
    if (missing.length) throw new Error(`Sheet is missing required column(s): ${missing.map((c) => `"${c.name}"`).join(', ')}. Header match is case-sensitive.`)
    const org = effectiveOrgId()
    const rejected: { row: number; reason: string }[] = []
    const toInsert: Record<string, unknown>[] = []
    body.rows.forEach((row, idx) => {
      const rowNo = idx + 1
      const data: Record<string, string> = {}
      for (const c of cols) data[c.name] = (row[c.name] ?? '').toString().trim()
      const emptyReq = cols.filter((c) => c.required && !data[c.name])
      if (emptyReq.length) { rejected.push({ row: rowNo, reason: `Empty required value(s): ${emptyReq.map((c) => c.name).join(', ')}` }); return }
      if (cols.every((c) => !data[c.name])) { rejected.push({ row: rowNo, reason: 'Blank row' }); return }
      toInsert.push({ org_id: org, template_id: t.id, template_name: t.name, data, display_name: leadDisplayName(data, cols), status: 'new' })
    })
    if (toInsert.length) { const { error: iErr } = await supabase.from('leads').insert(toInsert); if (iErr) throw new Error(iErr.message) }
    return { template_id: t.id as string, total_rows: body.rows.length, imported: toInsert.length, rejected }
  },
}

// ---- Manual leads (shared-pool workflow) ----
const mapLead = (l: Record<string, unknown>, remarks: LeadRemark[] = []): ManualLead => ({
  id: l.id as string, org_id: (l.org_id as string) ?? null, template_id: (l.template_id as string) ?? '',
  template_name: (l.template_name as string) ?? '', data: (l.data as Record<string, string>) ?? {},
  display_name: (l.display_name as string) ?? 'Untitled lead', status: l.status as ManualLead['status'],
  temperature: (l.temperature as Temperature) ?? null, setter: (l.setter as string) ?? null, closer: (l.closer as string) ?? null,
  remarks, created_at: l.created_at as string, updated_at: l.updated_at as string,
})

export const manualLeadsApi = {
  list: async (params?: { status?: LeadStatus; search?: string }): Promise<Paginated<ManualLead>> => {
    const org = effectiveOrgId()
    let q = supabase.from('leads').select('*').order('updated_at', { ascending: false })
    if (org) q = q.eq('org_id', org)
    if (params?.status) q = q.eq('status', params.status)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    let rows = (data ?? []).map((l) => mapLead(l))
    if (params?.search) {
      const s = params.search.toLowerCase()
      rows = rows.filter((l) => l.display_name.toLowerCase().includes(s) || Object.values(l.data).some((v) => String(v).toLowerCase().includes(s)))
    }
    return { data: rows, page: 1, page_size: rows.length, total: rows.length }
  },
  get: async (id: string): Promise<ManualLead> => {
    const { data, error } = await supabase.from('leads').select('*').eq('id', id).single()
    if (error || !data) throw new Error('Lead not found.')
    const { data: remarks } = await supabase.from('lead_remarks').select('*').eq('lead_id', id).order('at', { ascending: true })
    return mapLead(data, (remarks ?? []) as LeadRemark[])
  },
  update: async (id: string, body: Partial<{ status: LeadStatus; temperature: Temperature; setter: string | null; closer: string | null }>): Promise<ManualLead> => {
    const { data, error } = await supabase.from('leads').update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    return mapLead(data)
  },
  addRemark: async (id: string, body: { text: string; author: string; author_role: Role }): Promise<LeadRemark> => {
    const { data, error } = await supabase.from('lead_remarks').insert({ lead_id: id, author: body.author, author_role: body.author_role, text: body.text }).select().single()
    if (error) throw new Error(error.message)
    await supabase.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', id)
    return data as LeadRemark
  },
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
