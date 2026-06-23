import { create } from 'zustand'
import type { Client, PermissionOverrides, Role, User } from '../api/types'
import { DEFAULT_FLAGS, type FeatureFlags } from '../config/featureFlags'
import { clearActingOrg, loadActingOrg, saveActingOrg } from '../lib/actingOrg'

const NO_PERMS: PermissionOverrides = { granted: [], denied: [] }
const ALL_ORGS: Client = { id: '*', name: 'All organizations', plan: 'scale', credits_remaining: null }

interface AuthState {
  /** Access token kept in memory only — never localStorage (§18-C). */
  accessToken: string | null
  user: User | null
  client: Client | null
  role: Role | null
  flags: FeatureFlags
  permissions: PermissionOverrides
  /** Org the user is currently operating in (null = SA on the org list). */
  actingOrgId: string | null
  tosAcceptedAt: string | null
  status: 'unknown' | 'authenticated' | 'unauthenticated'
  setSession: (p: {
    accessToken?: string | null
    user: User
    client: Client
    role: Role
    flags: FeatureFlags
    permissions: PermissionOverrides
    actingOrgId: string | null
    tosAcceptedAt: string | null
  }) => void
  setToken: (t: string | null) => void
  acceptTos: (at: string) => void
  /** SA enters an org (View) — pure client state, persisted locally. */
  enterOrg: (id: string, name: string) => void
  exitOrg: () => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  client: null,
  role: null,
  flags: DEFAULT_FLAGS,
  permissions: NO_PERMS,
  actingOrgId: loadActingOrg()?.id ?? null,
  tosAcceptedAt: null,
  status: 'unknown',
  setSession: ({ accessToken, user, client, role, flags, permissions, actingOrgId, tosAcceptedAt }) =>
    set((s) => ({
      accessToken: accessToken ?? s.accessToken,
      user,
      client,
      role,
      flags,
      permissions,
      actingOrgId,
      tosAcceptedAt,
      status: 'authenticated',
    })),
  setToken: (t) => set({ accessToken: t }),
  acceptTos: (at) => set({ tosAcceptedAt: at }),
  enterOrg: (id, name) => {
    saveActingOrg({ id, name })
    set({ actingOrgId: id, client: { id, name, plan: 'growth', credits_remaining: null } })
  },
  exitOrg: () => {
    clearActingOrg()
    set({ actingOrgId: null, client: ALL_ORGS })
  },
  clear: () => {
    clearActingOrg()
    set({
      accessToken: null,
      user: null,
      client: null,
      role: null,
      flags: DEFAULT_FLAGS,
      permissions: NO_PERMS,
      actingOrgId: null,
      tosAcceptedAt: null,
      status: 'unauthenticated',
    })
  },
}))

export const isAdminRole = (role: Role | null) =>
  role === 'admin' || role === 'superadmin'
