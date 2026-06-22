import { create } from 'zustand'
import type { Client, PermissionOverrides, Role, User } from '../api/types'
import { DEFAULT_FLAGS, type FeatureFlags } from '../config/featureFlags'

const NO_PERMS: PermissionOverrides = { granted: [], denied: [] }

interface AuthState {
  /** Access token kept in memory only — never localStorage (§18-C). */
  accessToken: string | null
  user: User | null
  client: Client | null
  role: Role | null
  flags: FeatureFlags
  permissions: PermissionOverrides
  tosAcceptedAt: string | null
  status: 'unknown' | 'authenticated' | 'unauthenticated'
  setSession: (p: {
    accessToken?: string | null
    user: User
    client: Client
    role: Role
    flags: FeatureFlags
    permissions: PermissionOverrides
    tosAcceptedAt: string | null
  }) => void
  setToken: (t: string | null) => void
  acceptTos: (at: string) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  client: null,
  role: null,
  flags: DEFAULT_FLAGS,
  permissions: NO_PERMS,
  tosAcceptedAt: null,
  status: 'unknown',
  setSession: ({ accessToken, user, client, role, flags, permissions, tosAcceptedAt }) =>
    set((s) => ({
      accessToken: accessToken ?? s.accessToken,
      user,
      client,
      role,
      flags,
      permissions,
      tosAcceptedAt,
      status: 'authenticated',
    })),
  setToken: (t) => set({ accessToken: t }),
  acceptTos: (at) => set({ tosAcceptedAt: at }),
  clear: () =>
    set({
      accessToken: null,
      user: null,
      client: null,
      role: null,
      flags: DEFAULT_FLAGS,
      permissions: NO_PERMS,
      tosAcceptedAt: null,
      status: 'unauthenticated',
    }),
}))

export const isAdminRole = (role: Role | null) =>
  role === 'admin' || role === 'superadmin'
