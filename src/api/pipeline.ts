/** Typed API client for the lead-sourcing pipeline (api/pipeline/* endpoints). */
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineSearch {
  id: string
  org_id: string
  search_term: string
  location: string
  enabled: boolean
  created_at: string
}

export interface PipelineConfig {
  org_id: string
  icp_rubric: string
  quality_threshold: number
  max_places_per_run: number
  openai_model: string
  daily_run_enabled?: boolean // superadmin-only: 8:00 AM (PKT) auto-run
  daily_run_target?: number
}

export interface PipelineRun {
  id: string
  org_id: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed' | 'stopped'
  dry_run: boolean
  total_searched: number
  total_new: number
  total_enriched: number
  total_emailed: number
  total_imported: number
  total_no_website: number
  target_total?: number | null
  qualified_target?: number | null
  processed_total?: number | null
  batch_id?: string | null
  batch_id_no_website?: string | null
  error: string | null
  xlsx_path: string | null
  xlsx_url?: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function pipelineOrgId(): string | null {
  const s = useAuthStore.getState()
  const isSA = s.role === 'superadmin' || s.role === 'admin'
  return isSA ? s.actingOrgId : (s.user?.org_id ?? null)
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }
}

async function call<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await authHeaders()
  const res = await fetch(`/api/pipeline${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> ?? {}) },
  })
  if (!res.ok) {
    const data: { error?: { message?: string } } = await res.json().catch(() => ({}))
    throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return null as T
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const pipelineApi = {
  // --- Searches ---
  listSearches: (orgId: string) =>
    call<PipelineSearch[]>(`/searches?orgId=${encodeURIComponent(orgId)}`),

  addSearch: (body: { org_id: string; search_term: string; location: string }) =>
    call<PipelineSearch>('/searches', { method: 'POST', body: JSON.stringify(body) }),

  toggleSearch: (id: string, enabled: boolean) =>
    call<PipelineSearch>(`/searches?id=${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),

  deleteSearch: (id: string) =>
    call<{ ok: boolean }>(`/searches?id=${id}`, { method: 'DELETE' }),

  // --- Config ---
  getConfig: (orgId: string) =>
    call<PipelineConfig>(`/config?orgId=${encodeURIComponent(orgId)}`),

  saveConfig: (body: PipelineConfig) =>
    call<PipelineConfig>('/config', { method: 'PUT', body: JSON.stringify(body) }),

  // --- Runs ---
  triggerRun: (body: { org_id: string; dry_run: boolean; qualified_target?: number; batch_name?: string }) =>
    call<{ run_id: string; batch_id?: string | null; batch_id_no_website?: string | null; dry_run: boolean; status: string }>('/run', { method: 'POST', body: JSON.stringify(body) }),

  getStatus: (orgId: string, runId: string) =>
    call<PipelineRun>(`/status?orgId=${encodeURIComponent(orgId)}&runId=${encodeURIComponent(runId)}`),

  // How many leads for this niche+cities are already in the shared cache (→ 10% discount).
  // Tolerant: returns { available: 0 } until the engine ships the endpoint (no discount shown).
  cachePreview: async (orgId: string, verticalKey: string | null, metros: string[]): Promise<{ available: number }> => {
    try {
      return await call<{ available: number }>('/cache-preview', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, vertical_key: verticalKey, metros }),
      })
    } catch {
      return { available: 0 }
    }
  },

  stopRun: (body: { run_id: string; org_id: string }) =>
    call<{ ok: boolean }>('/stop', { method: 'POST', body: JSON.stringify(body) }),

  // Run history via Supabase client (RLS scoped to the user's org)
  listRuns: async (orgId: string): Promise<PipelineRun[]> => {
    const { data, error } = await supabase
      .from('pipeline_runs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(15)
    if (error) throw new Error(error.message)
    return (data ?? []) as PipelineRun[]
  },
}
