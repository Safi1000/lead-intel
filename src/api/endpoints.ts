/** Typed endpoint modules (§2 api/). Components never call axios directly. */
import { api } from './client'
import type {
  AuthResponse,
  Batch,
  BatchReport,
  CostSummary,
  ErrorLogItem,
  EstimateResponse,
  ExportJob,
  LeadDetail,
  LeadRow,
  MeResponse,
  NotificationItem,
  NotificationPrefs,
  Paginated,
  ProfileSettings,
  Run,
  RunConfig,
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
}
