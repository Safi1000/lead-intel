/** Typed endpoint modules (§2 api/). Components never call axios directly. */
import { api } from './client'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { DEFAULT_FLAGS } from '../config/featureFlags'
import { clearActingOrg, loadActingOrg } from '../lib/actingOrg'
import { TIER2_TO_STAGE } from './types'
import type { ActivityType, Attainment, BatchAssignment, Cadence, CadenceEnrollment, CadenceStep, Client, Deal, DispositionEvent, DispositionTier1, DispositionTier2, FloorConfig, LeadActivity, LeadBatch, LeadStage, Script, SourcingLocation, SourcingProfile, TargetRow, Team, TeamMembership, TemplateColumn, User, UserRemark, Vertical } from './types'
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

/** PostgREST caps a single response at 1000 rows; page through until exhausted. */
const PAGE_SIZE = 1000
async function fetchAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await make(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

/** Split an array into chunks of `size` (used to keep insert payloads bounded). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
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

/** Invoke the `send-email` edge function (SMTP send from the user's own mailbox); surface its error. */
async function invokeSendEmail<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('send-email', { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* ignore */ } }
    throw new Error(msg)
  }
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as { error: string }).error)
  return data as T
}

export const emailApi = {
  /** Is sending switched on for this user, and from which address? */
  status: () => invokeSendEmail<{ connected: boolean; email: string | null }>({ action: 'status' }),
  /** Send an email from the user's own mailbox. */
  send: (b: { to: string; subject: string; body: string; leadId?: string }) =>
    invokeSendEmail<{ ok: boolean }>({ action: 'send', ...b }),
}

// ---- Cold leads (scanned but not imported — the raw pool) ----
export interface ColdLeadRow {
  place_id: string; name: string; address: string; phone: string; website: string
  rating: number | null; email: string; email_confidence: string; location: string
  niche_key: string; niche_label: string; website_status: string
}
export interface ColdLeadFacets {
  total: number; withEmail: number; withPhone: number
  locations: Array<{ value: string; count: number }>
  niches: Array<{ key: string; label: string; count: number }>
}
export interface ColdLeadFilters {
  location?: string; niche?: string; hasEmail?: boolean; hasPhone?: boolean; q?: string
  limit?: number; offset?: number; orgId?: string | null
}

async function invokeColdLeads<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('cold-leads', { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* ignore */ } }
    throw new Error(msg)
  }
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as { error: string }).error)
  return data as T
}

export const coldLeadsApi = {
  facets: (orgId?: string | null) => invokeColdLeads<ColdLeadFacets>({ action: 'facets', orgId }),
  list: (f: ColdLeadFilters) => invokeColdLeads<{ rows: ColdLeadRow[]; total: number }>({ action: 'list', ...f }),
  export: (f: ColdLeadFilters) => invokeColdLeads<{ rows: ColdLeadRow[]; total: number }>({ action: 'export', ...f }),
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

// ---- Teams (org → manager → team → rep). RLS keeps everything org-scoped. ----
export const teamsApi = {
  list: async (): Promise<Team[]> => {
    const org = effectiveOrgId()
    let q = supabase.from('teams').select('*').order('created_at')
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as Team[]
  },
  create: async (name: string, managerId?: string | null): Promise<Team> => {
    const { data, error } = await supabase.from('teams').insert({ org_id: effectiveOrgId(), name: name.trim(), manager_id: managerId ?? null }).select().single()
    if (error) throw new Error(error.message)
    return data as Team
  },
  update: async (id: string, body: Partial<{ name: string; manager_id: string | null }>): Promise<void> => {
    const { error } = await supabase.from('teams').update(body).eq('id', id)
    if (error) throw new Error(error.message)
  },
  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('teams').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
  members: async (teamId: string): Promise<TeamMembership[]> => {
    const { data, error } = await supabase.from('team_members').select('*').eq('team_id', teamId)
    if (error) throw new Error(error.message)
    return (data ?? []) as TeamMembership[]
  },
  allMemberships: async (): Promise<TeamMembership[]> => {
    const { data, error } = await supabase.from('team_members').select('*') // RLS scopes to org
    if (error) throw new Error(error.message)
    return (data ?? []) as TeamMembership[]
  },
  addMember: async (teamId: string, userId: string, role: TeamMembership['role_in_team']): Promise<void> => {
    const { error } = await supabase.from('team_members').upsert({ team_id: teamId, user_id: userId, role_in_team: role }, { onConflict: 'team_id,user_id' })
    if (error) throw new Error(error.message)
  },
  removeMember: async (teamId: string, userId: string): Promise<void> => {
    const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId)
    if (error) throw new Error(error.message)
  },
}

// ---- User remarks (manager/SA notes about a user) ----
export const userRemarksApi = {
  list: async (profileId: string): Promise<UserRemark[]> => {
    const { data, error } = await supabase.from('user_remarks').select('*').eq('profile_id', profileId).order('at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as UserRemark[]
  },
  /** Remark counts per user in the current org (one query for the whole list). */
  counts: async (): Promise<Record<string, number>> => {
    const org = effectiveOrgId()
    const rows = await fetchAll<{ profile_id: string }>((from, to) => {
      let q = supabase.from('user_remarks').select('profile_id').range(from, to)
      if (org) q = q.eq('org_id', org)
      return q
    })
    const out: Record<string, number> = {}
    for (const r of rows) out[r.profile_id] = (out[r.profile_id] ?? 0) + 1
    return out
  },
  add: async (profileId: string, text: string): Promise<UserRemark> => {
    const author = useAuthStore.getState().user?.name ?? null
    const author_id = useAuthStore.getState().user?.id ?? null
    const { data, error } = await supabase.from('user_remarks')
      .insert({ profile_id: profileId, org_id: effectiveOrgId(), text: text.trim(), author, author_id })
      .select().single()
    if (error) throw new Error(error.message)
    return data as UserRemark
  },
  remove: async (id: string) => {
    const { error } = await supabase.from('user_remarks').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
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
      const leadRows = await fetchAll<{ template_id: string | null }>((from, to) => {
        let lq = supabase.from('leads').select('template_id').range(from, to)
        if (org) lq = lq.eq('org_id', org)
        return lq
      })
      for (const r of leadRows) if (r.template_id) counts[r.template_id] = (counts[r.template_id] ?? 0) + 1
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
  import: async (id: string, body: { headers: string[]; rows: Record<string, string>[]; file_name?: string }): Promise<ImportResult> => {
    const { data: t, error } = await supabase.from('templates').select('*').eq('id', id).single()
    if (error || !t) throw new Error('Template not found.')
    const cols = (t.columns as TemplateColumn[]) ?? []
    const missing = cols.filter((c) => c.required && !body.headers.includes(c.name))
    if (missing.length) throw new Error(`Sheet is missing required column(s): ${missing.map((c) => `"${c.name}"`).join(', ')}. Header match is case-sensitive.`)
    const org = effectiveOrgId()
    const createdBy = useAuthStore.getState().user?.name ?? null
    const rejected: { row: number; reason: string }[] = []
    const prepared: Record<string, unknown>[] = []
    body.rows.forEach((row, idx) => {
      const rowNo = idx + 1
      const data: Record<string, string> = {}
      for (const c of cols) data[c.name] = (row[c.name] ?? '').toString().trim()
      const emptyReq = cols.filter((c) => c.required && !data[c.name])
      if (emptyReq.length) { rejected.push({ row: rowNo, reason: `Empty required value(s): ${emptyReq.map((c) => c.name).join(', ')}` }); return }
      if (cols.every((c) => !data[c.name])) { rejected.push({ row: rowNo, reason: 'Blank row' }); return }
      prepared.push({ data, display_name: leadDisplayName(data, cols) })
    })

    // One uploaded sheet = one batch.
    const { data: batch, error: bErr } = await supabase.from('batches').insert({
      org_id: org, template_id: t.id, template_name: t.name,
      file_name: body.file_name ?? 'Upload', total_rows: body.rows.length,
      imported_count: prepared.length, rejected_count: rejected.length, created_by: createdBy,
    }).select('id').single()
    if (bErr || !batch) throw new Error(bErr?.message ?? 'Could not create the batch.')

    const toInsert = prepared.map((p) => ({
      org_id: org, batch_id: batch.id, template_id: t.id, template_name: t.name,
      data: p.data, display_name: p.display_name, status: 'new', created_by: createdBy,
    }))
    // Chunk inserts so large sheets stay within request limits.
    for (const part of chunk(toInsert, 500)) {
      const { error: iErr } = await supabase.from('leads').insert(part)
      if (iErr) throw new Error(iErr.message)
    }
    return { template_id: t.id as string, batch_id: batch.id as string, total_rows: body.rows.length, imported: toInsert.length, rejected }
  },
}

// ---- Manual leads (shared-pool workflow) ----
const mapLead = (l: Record<string, unknown>, remarks: LeadRemark[] = []): ManualLead => ({
  id: l.id as string, org_id: (l.org_id as string) ?? null, batch_id: (l.batch_id as string) ?? null,
  setter_id: (l.setter_id as string) ?? null, closer_id: (l.closer_id as string) ?? null,
  template_id: (l.template_id as string) ?? '',
  template_name: (l.template_name as string) ?? '', data: (l.data as Record<string, string>) ?? {},
  display_name: (l.display_name as string) ?? 'Untitled lead', status: l.status as ManualLead['status'],
  stage: (l.stage as ManualLead['stage']) ?? 'New', next_follow_up: (l.next_follow_up as string) ?? null, call_at: (l.call_at as string) ?? null,
  done_at: (l.done_at as string) ?? null, done_by: (l.done_by as string) ?? null,
  temperature: (l.temperature as Temperature) ?? null, setter: (l.setter as string) ?? null, closer: (l.closer as string) ?? null,
  closer_verdict: (l.closer_verdict as 'warm' | 'not_warm') ?? null,
  closer_verdict_by: (l.closer_verdict_by as string) ?? null,
  closer_verdict_at: (l.closer_verdict_at as string) ?? null,
  lifecycle_state: (l.lifecycle_state as ManualLead['lifecycle_state']) ?? null,
  dnc: (l.dnc as boolean) ?? false,
  attempt_count: Number(l.attempt_count ?? 0),
  last_touched_at: (l.last_touched_at as string) ?? null,
  nurture_wake_at: (l.nurture_wake_at as string) ?? null,
  assigned_at: (l.assigned_at as string) ?? null,
  first_touch_at: (l.first_touch_at as string) ?? null,
  last_tier1: (l.last_tier1 as ManualLead['last_tier1']) ?? null,
  last_tier2: (l.last_tier2 as ManualLead['last_tier2']) ?? null,
  team_id: (l.team_id as string) ?? null,
  remarks, created_at: l.created_at as string, updated_at: l.updated_at as string,
})

/** System activity logger — used for automatic entries (stage changes, verdicts, unassignment). */
const logSystemActivity = async (leadId: string, type: ActivityType, note: string) => {
  const author = useAuthStore.getState().user?.name ?? null
  const author_id = useAuthStore.getState().user?.id ?? null
  await supabase.from('lead_activities').insert({ lead_id: leadId, type, note, author, author_id })
}

export const manualLeadsApi = {
  list: async (params?: { status?: LeadStatus; search?: string; batch_id?: string }): Promise<Paginated<ManualLead>> => {
    const org = effectiveOrgId()
    const data = await fetchAll<Record<string, unknown>>((from, to) => {
      let q = supabase.from('leads').select('*').order('updated_at', { ascending: false }).range(from, to)
      if (org) q = q.eq('org_id', org)
      if (params?.batch_id) q = q.eq('batch_id', params.batch_id)
      if (params?.status) q = q.eq('status', params.status)
      return q
    })
    let rows = data.map((l) => mapLead(l))
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
  update: async (id: string, body: Partial<{ status: LeadStatus; stage: LeadStage; next_follow_up: string | null; call_at: string | null; temperature: Temperature; setter: string | null; closer: string | null; team_id: string | null }>): Promise<ManualLead> => {
    // Snapshot old values first so stage/temperature changes land in the activity log with old → new.
    let prev: { stage?: string; temperature?: string | null } = {}
    if (body.stage !== undefined || body.temperature !== undefined) {
      const { data: old } = await supabase.from('leads').select('stage,temperature').eq('id', id).single()
      prev = (old ?? {}) as typeof prev
    }
    const { data, error } = await supabase.from('leads').update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    if (body.stage !== undefined && prev.stage && prev.stage !== body.stage) {
      await logSystemActivity(id, 'Stage Change', `${prev.stage} → ${body.stage}`).catch(() => {})
    }
    if (body.temperature !== undefined && prev.temperature !== body.temperature && body.temperature) {
      await logSystemActivity(id, 'Temperature', `Marked ${body.temperature}`).catch(() => {})
    }
    return mapLead(data)
  },
  /** Closer/manager verdict after handoff: was this "qualified" lead actually warm? */
  setCloserVerdict: async (id: string, verdict: 'warm' | 'not_warm'): Promise<void> => {
    const by = useAuthStore.getState().user?.id ?? null
    const { error } = await supabase.from('leads')
      .update({ closer_verdict: verdict, closer_verdict_by: by, closer_verdict_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error(error.message)
    await logSystemActivity(id, 'Verdict', verdict === 'warm' ? 'Closer confirmed: lead was genuinely warm' : 'Closer flagged: lead was NOT warm (qualified only)').catch(() => {})
  },
  /** Manager/superadmin: pull a lead back from its setter and/or closer.
   * DONE leads are locked to their setter forever (DB trigger enforces; we surface a clear error). */
  unassign: async (id: string, which: 'setter' | 'closer' | 'both'): Promise<void> => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (which === 'setter' || which === 'both') { patch.setter = null; patch.setter_id = null; patch.status = 'new' }
    if (which === 'closer' || which === 'both') { patch.closer = null; patch.closer_id = null }
    const { data, error } = await supabase.from('leads').update(patch).eq('id', id).is('done_at', null).select('id')
    if (error) throw new Error(error.message)
    if ((data ?? []).length === 0) throw new Error('This lead is marked Done — it stays with its setter and cannot be unassigned.')
    await logSystemActivity(id, 'Unassigned', `Lead unassigned (${which}) by manager`).catch(() => {})
  },
  /** Bulk unassign: return the selected leads to the unclaimed pool (clears setter + closer).
   * DONE leads are skipped — they stay with their setter forever. Returns {unassigned, locked}. */
  unassignMany: async (ids: string[]): Promise<{ unassigned: number; locked: number }> => {
    if (ids.length === 0) return { unassigned: 0, locked: 0 }
    const { data, error } = await supabase.from('leads')
      .update({ setter: null, setter_id: null, closer: null, closer_id: null, status: 'new', updated_at: new Date().toISOString() })
      .in('id', ids).is('done_at', null).select('id')
    if (error) throw new Error(error.message)
    const doneIds = (data ?? []).map((r) => r.id as string)
    if (doneIds.length > 0) {
      const author = useAuthStore.getState().user?.name ?? null
      const author_id = useAuthStore.getState().user?.id ?? null
      await supabase.from('lead_activities').insert(
        doneIds.map((lead_id) => ({ lead_id, type: 'Unassigned', note: 'Bulk unassigned by manager', author, author_id })),
      )
    }
    return { unassigned: doneIds.length, locked: ids.length - doneIds.length }
  },
  /** Rep offboarding — move a departing rep's active (not-done) leads to another rep, or to the pool. */
  reassignFrom: async (fromId: string, toId: string | null, which: 'setter' | 'closer' = 'setter'): Promise<number> => {
    const col = which === 'setter' ? 'setter_id' : 'closer_id'
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (which === 'setter') { patch.setter_id = toId; if (!toId) { patch.status = 'new'; patch.lifecycle_state = 'Unassigned' } }
    else patch.closer_id = toId
    const { data, error } = await supabase.from('leads').update(patch).eq(col, fromId).is('done_at', null).select('id')
    if (error) throw new Error(error.message)
    return (data ?? []).length
  },

  /** Mark a lead processed / un-processed (throughput tracking). */
  markDone: async (id: string, done: boolean): Promise<void> => {
    const { error } = await supabase.rpc('mark_lead_done', { p_lead: id, p_done: done })
    if (error) throw new Error(error.message)
  },
  addRemark: async (id: string, body: { text: string; author: string; author_role: Role }): Promise<LeadRemark> => {
    const { data, error } = await supabase.from('lead_remarks').insert({ lead_id: id, author: body.author, author_role: body.author_role, text: body.text }).select().single()
    if (error) throw new Error(error.message)
    await supabase.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', id)
    return data as LeadRemark
  },
  /** Feature 2 — leads whose Next Follow-Up Date is today or earlier (RLS scopes per user). */
  dueToday: async (): Promise<ManualLead[]> => {
    const org = effectiveOrgId()
    const today = new Date().toISOString().slice(0, 10)
    const data = await fetchAll<Record<string, unknown>>((from, to) => {
      let q = supabase.from('leads').select('*').not('next_follow_up', 'is', null).lte('next_follow_up', today)
        .not('stage', 'in', '("Won","Lost")')
        .order('next_follow_up', { ascending: true }).range(from, to)
      if (org) q = q.eq('org_id', org)
      return q
    })
    return data.map((l) => mapLead(l))
  },
}

// ---- Deals (§3/§8) — the money on a lead, for the revenue side of targets + closer KPIs. ----
export const dealsApi = {
  forLead: async (leadId: string): Promise<Deal[]> => {
    const { data, error } = await supabase.from('deals').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Deal[]
  },
  save: async (leadId: string, body: { id?: string; stage: Deal['stage']; value: number | null; currency?: string }): Promise<Deal> => {
    const closer = useAuthStore.getState().user?.id ?? null
    const payload: Record<string, unknown> = {
      lead_id: leadId, org_id: effectiveOrgId(), closer_id: closer,
      stage: body.stage, value: body.value, currency: body.currency ?? 'USD',
      closed_at: body.stage === 'won' || body.stage === 'lost' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    const res = body.id
      ? await supabase.from('deals').update(payload).eq('id', body.id).select().single()
      : await supabase.from('deals').insert(payload).select().single()
    if (res.error) throw new Error(res.error.message)
    return res.data as Deal
  },
  /** All org deals with the lead name, for the pipeline kanban. */
  board: async (): Promise<Array<Deal & { lead_name: string }>> => {
    const org = effectiveOrgId()
    let q = supabase.from('deals').select('*, leads(display_name)')
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q.order('updated_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map((d) => ({ ...(d as Deal), lead_name: (d as { leads?: { display_name?: string } }).leads?.display_name ?? 'Lead' }))
  },
  updateStage: async (id: string, stage: Deal['stage']): Promise<void> => {
    const patch: Record<string, unknown> = { stage, updated_at: new Date().toISOString() }
    if (stage === 'won' || stage === 'lost') patch.closed_at = new Date().toISOString()
    const { error } = await supabase.from('deals').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---- Targets (§8) — blended revenue + closes, versioned; attainment from won deals. ----
export const targetsApi = {
  forPeriod: async (period: string): Promise<TargetRow[]> => {
    const org = effectiveOrgId()
    let q = supabase.from('targets').select('*').eq('period', period).order('set_at', { ascending: true })
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as TargetRow[]
  },
  set: async (level: TargetRow['level'], ownerId: string | null, period: string, revenue: number, closes: number): Promise<void> => {
    const by = useAuthStore.getState().user?.id ?? null
    const { error } = await supabase.from('targets').insert({ org_id: effectiveOrgId(), level, owner_id: ownerId, period, revenue_value: revenue, closes_value: closes, set_by: by })
    if (error) throw new Error(error.message)
  },
  /** Attainment for the period: won-deal totals + per-closer, plus per-setter booked meetings. */
  attainment: async (period: string): Promise<{ org: Attainment; byCloser: Record<string, Attainment>; bySetter: Record<string, number> }> => {
    const org = effectiveOrgId()
    const [y, m] = period.split('-').map(Number)
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString()
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString()
    let q = supabase.from('deals').select('closer_id,value').eq('stage', 'won').gte('closed_at', start).lte('closed_at', end)
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const orgAtt: Attainment = { closes: 0, revenue: 0 }
    const byCloser: Record<string, Attainment> = {}
    for (const d of data ?? []) {
      const val = Number(d.value ?? 0)
      orgAtt.closes++; orgAtt.revenue += val
      const c = d.closer_id as string | null
      if (c) { const a = (byCloser[c] ??= { closes: 0, revenue: 0 }); a.closes++; a.revenue += val }
    }
    // Setter attainment = booked meetings logged this period.
    let dq = supabase.from('disposition_events').select('rep_id').eq('tier2', 'Booked').gte('created_at', start).lte('created_at', end)
    if (org) dq = dq.eq('org_id', org)
    const { data: disp } = await dq
    const bySetter: Record<string, number> = {}
    for (const d of disp ?? []) { const r = d.rep_id as string; bySetter[r] = (bySetter[r] ?? 0) + 1 }
    return { org: orgAtt, byCloser, bySetter }
  },
}

// ---- Floor controls (§6) — editable per org; setter WIP loads for cap enforcement. ----
export const floorConfigApi = {
  get: async (): Promise<FloorConfig> => {
    const org = effectiveOrgId()
    if (!org) return { wip_cap: 40, sla_hours: 4, recycle_attempts: 5 }
    const { data } = await supabase.from('pipeline_config').select('floor_wip_cap,floor_sla_hours,floor_recycle_attempts').eq('org_id', org).maybeSingle()
    return { wip_cap: data?.floor_wip_cap ?? 40, sla_hours: data?.floor_sla_hours ?? 4, recycle_attempts: data?.floor_recycle_attempts ?? 5 }
  },
  update: async (body: FloorConfig): Promise<void> => {
    const org = effectiveOrgId()
    if (!org) throw new Error('No organization selected.')
    const patch = { floor_wip_cap: body.wip_cap, floor_sla_hours: body.sla_hours, floor_recycle_attempts: body.recycle_attempts }
    const { data: existing } = await supabase.from('pipeline_config').select('org_id').eq('org_id', org).maybeSingle()
    const { error } = existing
      ? await supabase.from('pipeline_config').update(patch).eq('org_id', org)
      : await supabase.from('pipeline_config').insert({ org_id: org, ...patch })
    if (error) throw new Error(error.message)
  },
  /** Active (unworked) lead count per setter — Assigned / In Progress, not done. For WIP caps. */
  setterLoads: async (): Promise<Record<string, number>> => {
    const org = effectiveOrgId()
    const rows = await fetchAll<{ setter_id: string | null; lifecycle_state: string | null; done_at: string | null }>((from, to) => {
      let q = supabase.from('leads').select('setter_id,lifecycle_state,done_at').not('setter_id', 'is', null).range(from, to)
      if (org) q = q.eq('org_id', org)
      return q
    })
    const load: Record<string, number> = {}
    for (const r of rows) {
      if (!r.setter_id || r.done_at) continue
      if (r.lifecycle_state === 'Assigned' || r.lifecycle_state === 'In Progress') load[r.setter_id] = (load[r.setter_id] ?? 0) + 1
    }
    return load
  },
}

// ---- Dispositions (§7 tier-1/tier-2). Insert drives lifecycle_state/attempts/dnc via DB trigger;
// we also sync the legacy coarse `stage` so existing stage-based views stay coherent. ----
export const dispositionsApi = {
  list: async (leadId: string): Promise<DispositionEvent[]> => {
    const { data, error } = await supabase.from('disposition_events').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as DispositionEvent[]
  },
  add: async (leadId: string, body: { tier1: DispositionTier1; tier2: DispositionTier2 | null; notes?: string | null; next_action_at?: string | null }): Promise<void> => {
    const rep = useAuthStore.getState().user?.id ?? null
    const { error } = await supabase.from('disposition_events').insert({
      lead_id: leadId, org_id: effectiveOrgId(), rep_id: rep,
      tier1: body.tier1, tier2: body.tier2 ?? null,
      notes: body.notes?.trim() || null, next_action_at: body.next_action_at ?? null,
    })
    if (error) throw new Error(error.message)
    if (body.tier2) {
      const patch: Record<string, unknown> = { stage: TIER2_TO_STAGE[body.tier2], updated_at: new Date().toISOString() }
      if (body.next_action_at && (body.tier2 === 'Callback scheduled' || body.tier2 === 'Nurture / not now')) {
        patch.next_follow_up = body.next_action_at.slice(0, 10)
      }
      await supabase.from('leads').update(patch).eq('id', leadId)
    }
  },
}

// ---- Lead activity log (Feature 3) ----
export const activitiesApi = {
  list: async (leadId: string): Promise<LeadActivity[]> => {
    const { data, error } = await supabase.from('lead_activities').select('*').eq('lead_id', leadId).order('at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as LeadActivity[]
  },
  add: async (leadId: string, body: { type: ActivityType; note?: string | null }): Promise<LeadActivity> => {
    const author = useAuthStore.getState().user?.name ?? null
    const author_id = useAuthStore.getState().user?.id ?? null
    const { data, error } = await supabase.from('lead_activities')
      .insert({ lead_id: leadId, type: body.type, note: body.note ?? null, author, author_id })
      .select().single()
    if (error) throw new Error(error.message)
    await supabase.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', leadId)
    return data as LeadActivity
  },
}

// ---- Org-wide activity feed (Activity page: manager oversight of setter work) ----
export interface ActivityFeedItem {
  id: string
  kind: 'activity' | 'remark'
  lead_id: string
  lead_name: string
  batch_id: string | null
  type: string // ActivityType for activities; 'Remark' for lead_remarks
  note: string | null
  author: string | null
  author_id: string | null // null for remarks (table has no author_id)
  at: string
}

export const activityFeedApi = {
  /** All setter/closer activity across the org since `sinceISO` (activities + remarks, newest first). */
  list: async (sinceISO: string): Promise<ActivityFeedItem[]> => {
    const org = effectiveOrgId()
    let aq = supabase.from('lead_activities')
      .select('id,lead_id,type,note,author,author_id,at,leads!inner(display_name,org_id,batch_id)')
      .gte('at', sinceISO).order('at', { ascending: false }).limit(1000)
    if (org) aq = aq.eq('leads.org_id', org)
    let rq = supabase.from('lead_remarks')
      .select('id,lead_id,author,author_role,text,at,leads!inner(display_name,org_id,batch_id)')
      .gte('at', sinceISO).order('at', { ascending: false }).limit(1000)
    if (org) rq = rq.eq('leads.org_id', org)
    const [a, r] = await Promise.all([aq, rq])
    if (a.error) throw new Error(a.error.message)
    if (r.error) throw new Error(r.error.message)
    type JoinedLead = { display_name: string | null; batch_id: string | null }
    const items: ActivityFeedItem[] = [
      ...(a.data ?? []).map((x) => ({
        id: x.id as string, kind: 'activity' as const, lead_id: x.lead_id as string,
        lead_name: ((x.leads as unknown as JoinedLead)?.display_name) ?? 'Lead',
        batch_id: ((x.leads as unknown as JoinedLead)?.batch_id) ?? null,
        type: x.type as string, note: (x.note as string) ?? null,
        author: (x.author as string) ?? null, author_id: (x.author_id as string) ?? null, at: x.at as string,
      })),
      ...(r.data ?? []).map((x) => ({
        id: x.id as string, kind: 'remark' as const, lead_id: x.lead_id as string,
        lead_name: ((x.leads as unknown as JoinedLead)?.display_name) ?? 'Lead',
        batch_id: ((x.leads as unknown as JoinedLead)?.batch_id) ?? null,
        type: 'Remark', note: (x.text as string) ?? null,
        author: (x.author as string) ?? null, author_id: null, at: x.at as string,
      })),
    ]
    return items.sort((x, y) => y.at.localeCompare(x.at))
  },
  /** Per-setter closer-verdict tallies (setter performance: genuinely-warm vs not-warm handoffs). */
  verdictStats: async (): Promise<Array<{ setter: string; warm: number; not_warm: number }>> => {
    const org = effectiveOrgId()
    let q = supabase.from('leads').select('setter,closer_verdict').not('closer_verdict', 'is', null)
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const by = new Map<string, { warm: number; not_warm: number }>()
    for (const l of data ?? []) {
      const s = (l.setter as string) ?? 'Unassigned'
      const e = by.get(s) ?? { warm: 0, not_warm: 0 }
      if (l.closer_verdict === 'warm') e.warm++
      else e.not_warm++
      by.set(s, e)
    }
    return [...by.entries()].map(([setter, v]) => ({ setter, ...v })).sort((a, b) => (b.warm + b.not_warm) - (a.warm + a.not_warm))
  },
}

// ---- Lead batches (one per uploaded sheet) ----
const mapBatch = (r: Record<string, unknown>): LeadBatch => ({
  id: r.id as string, org_id: (r.org_id as string) ?? null, template_id: (r.template_id as string) ?? null,
  template_name: (r.template_name as string) ?? '', file_name: (r.file_name as string) ?? 'Upload',
  total_rows: Number(r.total_rows ?? 0), imported_count: Number(r.imported_count ?? 0), rejected_count: Number(r.rejected_count ?? 0),
  created_by: (r.created_by as string) ?? null, created_at: r.created_at as string,
  archived_at: (r.archived_at as string) ?? null,
  allocated_manager_id: (r.allocated_manager_id as string) ?? null,
  lead_count: Number(r.lead_count ?? 0),
  assigned_count: Number(r.assigned_count ?? 0), unassigned_count: Number(r.unassigned_count ?? 0),
  new_count: Number(r.new_count ?? 0), contacted_count: Number(r.contacted_count ?? 0),
  interested_count: Number(r.interested_count ?? 0), booked_count: Number(r.booked_count ?? 0),
  notnow_count: Number(r.notnow_count ?? 0), won_count: Number(r.won_count ?? 0), lost_count: Number(r.lost_count ?? 0),
  done_count: Number(r.done_count ?? 0),
})

export const leadBatchesApi = {
  list: async (): Promise<LeadBatch[]> => {
    const org = effectiveOrgId()
    let q = supabase.from('batch_stats').select('*').order('created_at', { ascending: false })
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []).map(mapBatch)
  },
  get: async (id: string): Promise<LeadBatch> => {
    const { data, error } = await supabase.from('batch_stats').select('*').eq('id', id).single()
    if (error || !data) throw new Error('Batch not found.')
    return mapBatch(data)
  },
  /** Archive: hides the batch from active lists; ALL leads, notes and performance history survive. */
  setArchived: async (id: string, archived: boolean): Promise<void> => {
    const { error } = await supabase.from('batches').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id)
    if (error) throw new Error(error.message)
  },
  /** TRUE delete (superadmin only, RLS-enforced): cascades — permanently erases the batch,
   * every lead in it, and all their notes/activities/verdicts. Prefer setArchived. */
  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('batches').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---- Batch assignment (manager → setters/closers) ----
export const assignmentApi = {
  /** §5 owner action — allocate a whole batch to a manager (pull-back is inherent: reclaiming
   *  only clears the allocation; already-assigned leads keep their rep). */
  allocateBatch: async (batchId: string, managerId: string | null): Promise<void> => {
    const { error } = await supabase.from('batches').update({ allocated_manager_id: managerId }).eq('id', batchId)
    if (error) throw new Error(error.message)
  },
  /** Who can currently see this batch. */
  listForBatch: async (batchId: string): Promise<BatchAssignment[]> => {
    const { data, error } = await supabase.from('batch_assignments').select('*').eq('batch_id', batchId)
    if (error) throw new Error(error.message)
    return (data ?? []) as BatchAssignment[]
  },
  /** Grant a setter/closer visibility of a batch (no lead assignment). */
  assignBatch: async (batchId: string, userId: string, role: 'setter' | 'closer') => {
    const org = effectiveOrgId()
    const { error } = await supabase.from('batch_assignments').upsert(
      { batch_id: batchId, user_id: userId, org_id: org, role },
      { onConflict: 'batch_id,user_id' },
    )
    if (error) throw new Error(error.message)
  },
  /** Revoke a user's access to a batch. */
  unassignBatch: async (batchId: string, userId: string) => {
    const { error } = await supabase.from('batch_assignments').delete().eq('batch_id', batchId).eq('user_id', userId)
    if (error) throw new Error(error.message)
  },
  /** Randomly assign `count` still-unassigned leads in a batch to a setter. Returns # assigned. */
  assignLeadsToSetter: async (batchId: string, setterId: string, count: number): Promise<number> => {
    const { data, error } = await supabase.rpc('assign_leads_to_setter', { p_batch: batchId, p_setter: setterId, p_count: count })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  },
  /** Assign SPECIFIC selected leads to a setter (WIP-capped). Returns # actually assigned. */
  assignLeadIdsToSetter: async (setterId: string, leadIds: string[]): Promise<number> => {
    const { data, error } = await supabase.rpc('assign_lead_ids_to_setter', { p_setter: setterId, p_lead_ids: leadIds })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  },
  /** Assign specific (typically warm) leads in a batch to a closer. Returns # assigned. */
  assignLeadsToCloser: async (batchId: string, closerId: string, leadIds: string[]): Promise<number> => {
    const { data, error } = await supabase.rpc('assign_leads_to_closer', { p_batch: batchId, p_closer: closerId, p_lead_ids: leadIds })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  },
}

// ---- Daily goal + lead-throughput progress ----
export interface DoneCounts { today: number; week: number; month: number }
export interface SetterDoneStat { user_id: string; name: string; today: number; week: number; month: number }
export interface Periods { day: string; week: string; month: string } // ISO period starts (client-local)

export const progressApi = {
  /** The org's daily lead goal (0 = unset). */
  getGoal: async (): Promise<number> => {
    const org = effectiveOrgId()
    if (!org) return 0
    const { data, error } = await supabase.rpc('get_daily_lead_goal', { p_org: org })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  },
  setGoal: async (goal: number): Promise<void> => {
    const org = effectiveOrgId()
    if (!org) throw new Error('No organization selected.')
    const { error } = await supabase.rpc('set_daily_lead_goal', { p_org: org, p_goal: Math.max(0, Math.floor(goal)) })
    if (error) throw new Error(error.message)
  },
  /** The signed-in user's own done counts (a setter only ever sees their own). */
  myCounts: async (p: Periods): Promise<DoneCounts> => {
    const { data, error } = await supabase.rpc('my_done_counts', { p_day: p.day, p_week: p.week, p_month: p.month })
    if (error) throw new Error(error.message)
    const row = Array.isArray(data) ? data[0] : data
    return { today: Number(row?.today ?? 0), week: Number(row?.week ?? 0), month: Number(row?.month ?? 0) }
  },
  /** Per-setter done counts (manager/SA only; setters get an empty list). */
  setterStats: async (p: Periods): Promise<SetterDoneStat[]> => {
    const org = effectiveOrgId()
    if (!org) return []
    const { data, error } = await supabase.rpc('setter_done_stats', { p_org: org, p_day: p.day, p_week: p.week, p_month: p.month })
    if (error) throw new Error(error.message)
    return (data ?? []) as SetterDoneStat[]
  },
}

// ---- Per-user workload stats (Users panel) ----
export interface OrgUserStats {
  byUploader: Record<string, { batches: number; leads: number }>
  bySetter: Record<string, { total: number; contacted: number; booked: number; won: number }>
  byCloser: Record<string, { total: number; booked: number; won: number; lost: number }>
  totals: { leads: number; batches: number; new: number; booked: number; won: number; lost: number }
}
type LeadStatRow = { stage: LeadStage; setter: string | null; closer: string | null }

export const statsApi = {
  org: async (): Promise<OrgUserStats> => {
    const empty: OrgUserStats = { byUploader: {}, bySetter: {}, byCloser: {}, totals: { leads: 0, batches: 0, new: 0, booked: 0, won: 0, lost: 0 } }
    const org = effectiveOrgId()
    if (!org) return empty
    const batches = await leadBatchesApi.list()
    const leads = await fetchAll<LeadStatRow>((from, to) =>
      supabase.from('leads').select('stage,setter,closer').eq('org_id', org).range(from, to),
    )
    const out: OrgUserStats = { byUploader: {}, bySetter: {}, byCloser: {}, totals: { ...empty.totals } }
    out.totals.batches = batches.length
    for (const b of batches) {
      if (!b.created_by) continue
      const u = (out.byUploader[b.created_by] ??= { batches: 0, leads: 0 })
      u.batches += 1
      u.leads += b.imported_count
    }
    for (const l of leads) {
      out.totals.leads += 1
      if (l.stage === 'New') out.totals.new += 1
      else if (l.stage === 'Booked') out.totals.booked += 1
      if (l.setter) {
        const s = (out.bySetter[l.setter] ??= { total: 0, contacted: 0, booked: 0, won: 0 })
        s.total += 1
        if (l.stage !== 'New') s.contacted += 1
        if (l.stage === 'Booked') s.booked += 1
      }
      if (l.closer) {
        const c = (out.byCloser[l.closer] ??= { total: 0, booked: 0, won: 0, lost: 0 })
        c.total += 1
        if (l.stage === 'Booked') c.booked += 1
      }
    }
    return out
  },
}

// ---- Disposition-derived KPIs (§8). Built from disposition_events (manual capture) since we don't
// have CloudTalk API on Essentials — so: attempts/connects/booked + rates, no talk-time yet. ----
export interface SetterKpi {
  rep_id: string; name: string
  assigned: number; worked: number
  attempts: number; connects: number; connectRate: number
  conversations: number; booked: number; bookingRate: number
  speedHrs: number; overdue: number
}
export const kpisApi = {
  setterFunnel: async (sinceISO: string): Promise<SetterKpi[]> => {
    const org = effectiveOrgId()
    const { data: disp, error } = await supabase.from('disposition_events').select('rep_id,tier1,tier2').gte('created_at', sinceISO)
    if (error) throw new Error(error.message)
    const leadRows = await fetchAll<{ setter_id: string | null; attempt_count: number; assigned_at: string | null; first_touch_at: string | null; next_follow_up: string | null }>((from, to) => {
      let q = supabase.from('leads').select('setter_id,attempt_count,assigned_at,first_touch_at,next_follow_up').not('setter_id', 'is', null).range(from, to)
      if (org) q = q.eq('org_id', org)
      return q
    })
    const users = await usersApi.list()
    const nameFor = (id: string) => users.find((u) => u.id === id)?.name ?? 'Rep'
    const map = new Map<string, SetterKpi>()
    const speed = new Map<string, { sum: number; n: number }>()
    const get = (id: string) => {
      let k = map.get(id)
      if (!k) { k = { rep_id: id, name: nameFor(id), assigned: 0, worked: 0, attempts: 0, connects: 0, connectRate: 0, conversations: 0, booked: 0, bookingRate: 0, speedHrs: 0, overdue: 0 }; map.set(id, k) }
      return k
    }
    for (const d of disp ?? []) { const k = get(d.rep_id as string); k.attempts++; if (d.tier1 === 'Connected') k.connects++; if (d.tier2) k.conversations++; if (d.tier2 === 'Booked') k.booked++ }
    const today = new Date().toISOString().slice(0, 10)
    for (const l of leadRows) {
      if (!l.setter_id) continue
      const k = get(l.setter_id); k.assigned++
      if ((l.attempt_count ?? 0) > 0) k.worked++
      if (l.assigned_at && l.first_touch_at) { const s = speed.get(l.setter_id) ?? { sum: 0, n: 0 }; s.sum += (new Date(l.first_touch_at).getTime() - new Date(l.assigned_at).getTime()) / 3_600_000; s.n++; speed.set(l.setter_id, s) }
      if (l.next_follow_up && l.next_follow_up < today) k.overdue++
    }
    for (const k of map.values()) {
      k.connectRate = k.attempts ? Math.round((k.connects / k.attempts) * 100) : 0
      k.bookingRate = k.connects ? Math.round((k.booked / k.connects) * 100) : 0
      const s = speed.get(k.rep_id); k.speedHrs = s && s.n ? Math.round((s.sum / s.n) * 10) / 10 : 0
    }
    return [...map.values()].sort((a, b) => b.booked - a.booked || b.connects - a.connects)
  },
  /** Closer $ KPIs from deals: close rate, avg deal, pipeline (open value), sales-cycle days. */
  closerFunnel: async (): Promise<CloserKpi[]> => {
    const org = effectiveOrgId()
    let q = supabase.from('deals').select('closer_id,stage,value,created_at,closed_at')
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const users = await usersApi.list()
    const nameFor = (id: string) => users.find((u) => u.id === id)?.name ?? 'Closer'
    type Acc = { deals: number; won: number; lost: number; proposals: number; revenue: number; cycleSum: number; cycleN: number; pipeline: number }
    const map = new Map<string, Acc>()
    const get = (id: string) => { let k = map.get(id); if (!k) { k = { deals: 0, won: 0, lost: 0, proposals: 0, revenue: 0, cycleSum: 0, cycleN: 0, pipeline: 0 }; map.set(id, k) } return k }
    for (const d of data ?? []) {
      const id = d.closer_id as string | null; if (!id) continue
      const k = get(id); k.deals++
      if (d.stage === 'proposal') k.proposals++
      if (d.stage === 'won') { k.won++; k.revenue += Number(d.value ?? 0); if (d.closed_at) { k.cycleSum += (new Date(d.closed_at as string).getTime() - new Date(d.created_at as string).getTime()) / 86_400_000; k.cycleN++ } }
      else if (d.stage === 'lost') k.lost++
      else k.pipeline += Number(d.value ?? 0)
    }
    return [...map.entries()].map(([id, k]) => ({
      rep_id: id, name: nameFor(id), deals: k.deals, won: k.won, lost: k.lost, proposals: k.proposals,
      closeRate: k.won + k.lost ? Math.round((k.won / (k.won + k.lost)) * 100) : 0,
      revenue: k.revenue, avgDeal: k.won ? Math.round(k.revenue / k.won) : 0, pipeline: k.pipeline,
      cycleDays: k.cycleN ? Math.round(k.cycleSum / k.cycleN) : 0,
    })).sort((a, b) => b.revenue - a.revenue)
  },
  /** Manager-console alert counts: first-touch SLA breaches, overdue callbacks, idle reps. */
  floorAlerts: async (slaHours: number): Promise<{ slaBreaches: number; overdueCallbacks: number; idleReps: number }> => {
    const shiftMs = (a: number, b: number): number => {
      if (b <= a) return 0
      let total = 0
      const day = new Date(a); day.setUTCHours(0, 0, 0, 0)
      for (let t = day.getTime(); t < b; t += 86_400_000) { const ws = t + 14 * 3_600_000, we = t + 21 * 3_600_000; total += Math.max(0, Math.min(b, we) - Math.max(a, ws)) }
      return total
    }
    const org = effectiveOrgId()
    const rows = await fetchAll<{ setter_id: string | null; assigned_at: string | null; first_touch_at: string | null; lifecycle_state: string | null; done_at: string | null; next_follow_up: string | null }>((from, to) => {
      let q = supabase.from('leads').select('setter_id,assigned_at,first_touch_at,lifecycle_state,done_at,next_follow_up').range(from, to)
      if (org) q = q.eq('org_id', org)
      return q
    })
    const now = Date.now(); const slaMs = slaHours * 3_600_000; const today = new Date().toISOString().slice(0, 10)
    const isActive = (s: string | null) => s === 'Assigned' || s === 'In Progress'
    let slaBreaches = 0, overdueCallbacks = 0
    const activeSetters = new Set<string>()
    for (const l of rows) {
      if (l.done_at) continue
      if (l.setter_id && isActive(l.lifecycle_state)) activeSetters.add(l.setter_id)
      if (l.assigned_at && !l.first_touch_at && isActive(l.lifecycle_state) && shiftMs(new Date(l.assigned_at).getTime(), now) > slaMs) slaBreaches++
      if (l.next_follow_up && l.next_follow_up < today && (isActive(l.lifecycle_state) || l.lifecycle_state === 'Nurture')) overdueCallbacks++
    }
    const last = await repActivityApi.last()
    let idleReps = 0
    for (const s of activeSetters) { const t = last[s] ? new Date(last[s]).getTime() : 0; if (now - t > 30 * 60_000) idleReps++ }
    return { slaBreaches, overdueCallbacks, idleReps }
  },
  /** Total delivered leads for the current org (RLS/acting-org scoped) — for spend math. */
  orgLeadCount: async (): Promise<number> => {
    const org = effectiveOrgId()
    let q = supabase.from('leads').select('*', { count: 'exact', head: true })
    if (org) q = q.eq('org_id', org)
    const { count } = await q
    return count ?? 0
  },
}
export interface CloserKpi {
  rep_id: string; name: string
  deals: number; won: number; lost: number; proposals: number; closeRate: number
  revenue: number; avgDeal: number; pipeline: number; cycleDays: number
}

// ---- Multi-tenant sourcing: curated verticals + per-tenant profile + curated metros. ----
export const verticalsApi = {
  list: async (): Promise<Vertical[]> => {
    const { data, error } = await supabase.from('verticals').select('*').eq('active', true).order('label')
    if (error) throw new Error(error.message)
    return (data ?? []) as Vertical[]
  },
}
export const locationsApi = {
  list: async (): Promise<SourcingLocation[]> => {
    const rows = await fetchAll<SourcingLocation>((from, to) =>
      supabase.from('search_locations').select('location,country').eq('active', true).order('location').range(from, to))
    return rows
  },
}
export const sourcingApi = {
  get: async (): Promise<SourcingProfile | null> => {
    const org = effectiveOrgId()
    if (!org) return null
    const { data } = await supabase.from('sourcing_profiles').select('*').eq('org_id', org).maybeSingle()
    return (data as SourcingProfile) ?? null
  },
  save: async (body: Omit<SourcingProfile, 'org_id'>): Promise<void> => {
    const org = effectiveOrgId()
    if (!org) throw new Error('No organization selected.')
    const { error } = await supabase.from('sourcing_profiles').upsert({ org_id: org, ...body, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
    if (error) throw new Error(error.message)
  },
}

// ---- Cadences / sequences (§10). Org-scoped; owner/manager build, executor runs hourly. ----
export const cadencesApi = {
  list: async (): Promise<Cadence[]> => {
    const org = effectiveOrgId()
    let q = supabase.from('cadences').select('*').order('created_at', { ascending: false })
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as Cadence[]
  },
  steps: async (cadenceId: string): Promise<CadenceStep[]> => {
    const { data, error } = await supabase.from('cadence_steps').select('*').eq('cadence_id', cadenceId).order('step_order')
    if (error) throw new Error(error.message)
    return (data ?? []) as CadenceStep[]
  },
  create: async (name: string): Promise<Cadence> => {
    const by = useAuthStore.getState().user?.id ?? null
    const { data, error } = await supabase.from('cadences').insert({ org_id: effectiveOrgId(), name, created_by: by }).select().single()
    if (error) throw new Error(error.message)
    return data as Cadence
  },
  update: async (id: string, body: { name?: string; active?: boolean }): Promise<void> => {
    const { error } = await supabase.from('cadences').update(body).eq('id', id)
    if (error) throw new Error(error.message)
  },
  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('cadences').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
  setSteps: async (cadenceId: string, steps: CadenceStep[]): Promise<void> => {
    await supabase.from('cadence_steps').delete().eq('cadence_id', cadenceId)
    if (steps.length) {
      const rows = steps.map((s, i) => ({ cadence_id: cadenceId, step_order: i + 1, day_offset: s.day_offset, action: s.action, script_id: s.script_id, note: s.note, target_state: s.target_state }))
      const { error } = await supabase.from('cadence_steps').insert(rows)
      if (error) throw new Error(error.message)
    }
  },
  enroll: async (leadId: string, cadenceId: string): Promise<void> => {
    const { error } = await supabase.rpc('enroll_in_cadence', { p_lead: leadId, p_cadence: cadenceId })
    if (error) throw new Error(error.message)
  },
  enrollmentsForLead: async (leadId: string): Promise<Array<CadenceEnrollment & { cadence_name: string }>> => {
    const { data, error } = await supabase.from('cadence_enrollments').select('*, cadences(name)').eq('lead_id', leadId).order('enrolled_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => ({ ...(r as CadenceEnrollment), cadence_name: (r as { cadences?: { name?: string } }).cadences?.name ?? 'Cadence' }))
  },
  stop: async (enrollmentId: string): Promise<void> => {
    const { error } = await supabase.from('cadence_enrollments').update({ status: 'stopped', next_run_at: null }).eq('id', enrollmentId)
    if (error) throw new Error(error.message)
  },
}

// ---- Scripts / email templates (§10). Org-scoped read; managers write. ----
export const scriptsApi = {
  list: async (): Promise<Script[]> => {
    const org = effectiveOrgId()
    let q = supabase.from('scripts').select('*').order('updated_at', { ascending: false })
    if (org) q = q.eq('org_id', org)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as Script[]
  },
  save: async (body: { id?: string; kind: 'call' | 'email'; name: string; body: string }): Promise<void> => {
    const by = useAuthStore.getState().user?.id ?? null
    const payload = { org_id: effectiveOrgId(), kind: body.kind, name: body.name, body: body.body, updated_at: new Date().toISOString() }
    const res = body.id
      ? await supabase.from('scripts').update(payload).eq('id', body.id)
      : await supabase.from('scripts').insert({ ...payload, created_by: by })
    if (res.error) throw new Error(res.error.message)
  },
  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('scripts').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---- Provider console (Surface 3, superadmin) + client portal (Surface 2) + billing (§13). ----
export interface ProviderRow {
  org_id: string; org_name: string; leads_total: number; delivered_30d: number; booked: number
  plan: string; price_per_lead: number; monthly_fee: number; credits_remaining: number; metered: boolean
}
export const providerApi = {
  overview: async (): Promise<ProviderRow[]> => {
    const { data, error } = await supabase.rpc('provider_overview')
    if (error) throw new Error(error.message)
    return (data ?? []) as ProviderRow[]
  },
  setBilling: async (orgId: string, body: { plan: string; price_per_lead: number; monthly_fee: number; credits_remaining: number; metered: boolean }): Promise<void> => {
    const { error } = await supabase.from('org_billing').upsert({ org_id: orgId, ...body, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
    if (error) throw new Error(error.message)
  },
}
// Org credit balance for the current tenant (top-bar chip). Reads org_billing (RLS: org members).
export const orgCreditsApi = {
  mine: async (): Promise<number | null> => {
    const org = effectiveOrgId()
    if (!org) return null
    const { data } = await supabase.from('org_billing').select('credits_remaining').eq('org_id', org).maybeSingle()
    return data ? Number(data.credits_remaining) : null
  },
}

export const portalApi = {
  summary: async (): Promise<{ delivered: number; booked: number; won: number; revenue: number; recent: Array<{ id: string; name: string; city: string; booked: boolean }> }> => {
    const { data: leads } = await supabase.from('leads').select('id,display_name,data,lifecycle_state,created_at').order('created_at', { ascending: false }).limit(2000)
    const rows = leads ?? []
    const recent = rows.slice(0, 50).map((l) => {
      const d = (l.data ?? {}) as Record<string, string>
      return { id: l.id as string, name: (l.display_name as string) ?? 'Lead', city: d.City ?? d.city ?? '', booked: l.lifecycle_state === 'Booked' }
    })
    const { data: deals } = await supabase.from('deals').select('value').eq('stage', 'won')
    return {
      delivered: rows.length,
      booked: rows.filter((l) => l.lifecycle_state === 'Booked').length,
      won: deals?.length ?? 0,
      revenue: (deals ?? []).reduce((s, d) => s + Number(d.value ?? 0), 0),
      recent,
    }
  },
}

/** Latest disposition timestamp per rep (for the idle-rep alert). */
export const repActivityApi = {
  last: async (): Promise<Record<string, string>> => {
    const { data, error } = await supabase.from('disposition_events').select('rep_id,created_at').order('created_at', { ascending: false }).limit(500)
    if (error) throw new Error(error.message)
    const last: Record<string, string> = {}
    for (const d of data ?? []) { const r = d.rep_id as string; if (!last[r]) last[r] = d.created_at as string }
    return last
  },
}

// ---- Batches / reports / exports (legacy enrichment, MSW) ----
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
const DEFAULT_NOTIF_PREFS: NotificationPrefs = {
  batch_ready: { email: false, whatsapp: false },
  hot_lead: { email: false, whatsapp: false },
  run_failed: { email: false, whatsapp: false },
  weekly_summary: { email: false, whatsapp: false },
}

export const settingsApi = {
  /** Read the signed-in user's profile from Supabase. */
  getProfile: async (): Promise<ProfileSettings> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    const profile = await fetchProfile(user.id)
    if (!profile) throw new Error('No profile is linked to this account.')
    return { name: profile.name, email: profile.email, timezone: profile.timezone || 'UTC', language: 'en', avatar_url: null }
  },
  /** Update name/timezone (RPC); changing email triggers Supabase re-verification. */
  updateProfile: async (body: Partial<ProfileSettings>): Promise<ProfileSettings> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    const { error } = await supabase.rpc('update_my_profile', { p_name: body.name ?? '', p_timezone: body.timezone ?? '' })
    if (error) throw new Error(error.message)
    if (body.email && body.email !== user.email) {
      const { error: e2 } = await supabase.auth.updateUser({ email: body.email })
      if (e2) throw new Error(e2.message)
    }
    const profile = await fetchProfile(user.id)
    return { name: profile?.name ?? body.name ?? '', email: body.email ?? profile?.email ?? user.email ?? '', timezone: profile?.timezone ?? body.timezone ?? 'UTC', language: body.language ?? 'en', avatar_url: null }
  },
  changePassword: async (body: { current: string; next: string }): Promise<{ ok: true }> => {
    const { error } = await supabase.auth.updateUser({ password: body.next })
    if (error) throw new Error(error.message)
    return { ok: true }
  },
  // Email/WhatsApp notification prefs have no backend yet — return defaults / no-op.
  getNotifications: async (): Promise<NotificationPrefs> => DEFAULT_NOTIF_PREFS,
  updateNotifications: async (body: NotificationPrefs): Promise<NotificationPrefs> => body,
}

// ---- Notifications (bell) ---- no backend yet; empty so the bell never errors.
export const notificationsApi = {
  list: async (): Promise<Paginated<NotificationItem>> => {
    const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)
    if (error) throw new Error(error.message)
    const items = (data ?? []) as NotificationItem[]
    return { data: items, page: 1, page_size: items.length, total: items.length }
  },
  markRead: async (id: string): Promise<void> => {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id)
    if (error) throw new Error(error.message)
  },
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

// ---- §3 AuditLog (real, RLS-scoped). Rows are written by DB triggers; read-only here. ----
export interface AuditRow { id: string; actor_id: string | null; action: string; target: string | null; meta: Record<string, unknown> | null; created_at: string }
export const auditApi = {
  list: async (limit = 100): Promise<AuditRow[]> => {
    const { data, error } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as AuditRow[]
  },
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
