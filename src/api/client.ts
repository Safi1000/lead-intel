import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'
import { toast } from 'sonner'
import { useAuthStore } from '../stores/authStore'
import type { ApiError } from './types'

export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

/** Attach JWT from in-memory store on every request (§5, §18-C). */
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

let refreshing: Promise<string | null> | null = null

async function refreshToken(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ access_token: string }>('/api/auth/refresh')
    useAuthStore.getState().setToken(data.access_token)
    return data.access_token
  } catch {
    return null
  }
}

/** 401 → one silent refresh, then logout. Normalize errors. (§5.4) */
api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean })
      | undefined
    const status = error.response?.status

    if (status === 401 && original && !original._retried) {
      original._retried = true
      refreshing ??= refreshToken().finally(() => {
        refreshing = null
      })
      const token = await refreshing
      if (token) {
        original.headers.set('Authorization', `Bearer ${token}`)
        return api(original)
      }
      useAuthStore.getState().clear()
      if (!location.pathname.startsWith('/login')) {
        toast.error('Session expired. Please sign in again.')
        const returnTo = encodeURIComponent(location.pathname + location.search)
        location.assign(`/login?returnTo=${returnTo}`)
      }
    }

    return Promise.reject(normalizeError(error))
  },
)

export interface NormalizedError {
  status?: number
  code: string
  message: string
  fields?: Record<string, string>
}

export function normalizeError(error: unknown): NormalizedError {
  if (axios.isAxiosError(error)) {
    const e = error as AxiosError<ApiError>
    return {
      status: e.response?.status,
      code: e.response?.data?.error?.code ?? 'network_error',
      message:
        e.response?.data?.error?.message ??
        (e.code === 'ERR_NETWORK'
          ? 'Network error. Check your connection and retry.'
          : 'Something went wrong. Please try again.'),
      fields: e.response?.data?.error?.fields,
    }
  }
  return { code: 'unknown', message: 'Unexpected error.' }
}
