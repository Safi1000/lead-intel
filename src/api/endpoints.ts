/** Typed endpoint modules (§2 api/). Components never call axios directly. */
import { api } from './client'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { DEFAULT_FLAGS } from '../config/featureFlags'
import { clearActingOrg, loadActingOrg } from '../lib/actingOrg'
import type { ActivityType, BatchAssignment, Client, LeadActivity, LeadBatch, LeadStage, TemplateColumn, User, UserRemark } from './types'
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
  temperature: (l.temperature as Temperature) ?? null, setter: (l.setter as string) ?? null, closer: (l.closer as string) ?? null,
  remarks, created_at: l.created_at as string, updated_at: l.updated_at as string,
})

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
  update: async (id: string, body: Partial<{ status: LeadStatus; stage: LeadStage; next_follow_up: string | null; call_at: string | null; temperature: Temperature; setter: string | null; closer: string | null }>): Promise<ManualLead> => {
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

// ---- Lead batches (one per uploaded sheet) ----
const mapBatch = (r: Record<string, unknown>): LeadBatch => ({
  id: r.id as string, org_id: (r.org_id as string) ?? null, template_id: (r.template_id as string) ?? null,
  template_name: (r.template_name as string) ?? '', file_name: (r.file_name as string) ?? 'Upload',
  total_rows: Number(r.total_rows ?? 0), imported_count: Number(r.imported_count ?? 0), rejected_count: Number(r.rejected_count ?? 0),
  created_by: (r.created_by as string) ?? null, created_at: r.created_at as string,
  lead_count: Number(r.lead_count ?? 0),
  assigned_count: Number(r.assigned_count ?? 0), unassigned_count: Number(r.unassigned_count ?? 0),
  new_count: Number(r.new_count ?? 0), contacted_count: Number(r.contacted_count ?? 0),
  interested_count: Number(r.interested_count ?? 0), booked_count: Number(r.booked_count ?? 0),
  notnow_count: Number(r.notnow_count ?? 0), won_count: Number(r.won_count ?? 0), lost_count: Number(r.lost_count ?? 0),
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
}

// ---- Batch assignment (manager → setters/closers) ----
export const assignmentApi = {
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
  /** Assign specific (typically warm) leads in a batch to a closer. Returns # assigned. */
  assignLeadsToCloser: async (batchId: string, closerId: string, leadIds: string[]): Promise<number> => {
    const { data, error } = await supabase.rpc('assign_leads_to_closer', { p_batch: batchId, p_closer: closerId, p_lead_ids: leadIds })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
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
      else if (l.stage === 'Won') out.totals.won += 1
      else if (l.stage === 'Lost') out.totals.lost += 1
      if (l.setter) {
        const s = (out.bySetter[l.setter] ??= { total: 0, contacted: 0, booked: 0, won: 0 })
        s.total += 1
        if (l.stage !== 'New') s.contacted += 1
        if (l.stage === 'Booked') s.booked += 1
        if (l.stage === 'Won') s.won += 1
      }
      if (l.closer) {
        const c = (out.byCloser[l.closer] ??= { total: 0, booked: 0, won: 0, lost: 0 })
        c.total += 1
        if (l.stage === 'Booked') c.booked += 1
        if (l.stage === 'Won') c.won += 1
        if (l.stage === 'Lost') c.lost += 1
      }
    }
    return out
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
