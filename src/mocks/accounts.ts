/**
 * Persistent (localStorage-backed) accounts store for the mock backend.
 *
 * Replaces all hardcoded users. Models the real hierarchy:
 *   - SSA (superadmin): global, org_id = null, can do everything in every org.
 *   - manager: full control within their own org only.
 *   - lead_generator / setter / closer: workers within one org.
 *
 * The access token is never persisted by the client, so the "current user" is
 * resolved from a persisted sessionUserId (mirrors the old server session).
 */
import type { Client, ManagedUser, Org, PermissionOverrides, Role, User } from '../api/types'

export interface StoredUser {
  id: string
  name: string
  email: string
  password: string
  role: Role
  org_id: string | null
  status: 'active' | 'disabled'
  permissions: PermissionOverrides
  timezone: string
  tos_accepted_at: string | null
  created_at: string
  created_by: string | null
}

interface DB {
  orgs: Org[]
  users: StoredUser[]
  sessionUserId: string | null
}

const LS_KEY = 'leadintel.accounts.v1'
const now = () => new Date().toISOString()

let counter = 1
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}`

// ---- seed: the one bootstrap SSA account ----
function seed(): DB {
  return {
    orgs: [],
    users: [
      {
        id: 'usr_ssa',
        name: 'Super Admin',
        email: 'techxserve@gmail.com',
        password: 'Services@123',
        role: 'superadmin',
        org_id: null,
        status: 'active',
        permissions: { granted: [], denied: [] },
        timezone: 'UTC',
        tos_accepted_at: now(),
        created_at: now(),
        created_by: null,
      },
    ],
    sessionUserId: null,
  }
}

function load(): DB {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DB
      if (parsed.users?.some((u) => u.role === 'superadmin')) return parsed
    }
  } catch {
    /* fall through to seed */
  }
  const fresh = seed()
  persist(fresh)
  return fresh
}

let db: DB = load()

function persist(next: DB = db) {
  db = next
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db))
  } catch {
    /* storage full / unavailable — keep in-memory */
  }
}

// ---- mappers (never leak passwords to the client) ----
const orgName = (id: string | null) => (id ? (db.orgs.find((o) => o.id === id)?.name ?? null) : null)

export function toUser(u: StoredUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    org_id: u.org_id,
    timezone: u.timezone,
    tos_accepted_at: u.tos_accepted_at,
  }
}

export function toManagedUser(u: StoredUser): ManagedUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    org_id: u.org_id,
    org_name: orgName(u.org_id),
    status: u.status,
    permissions: u.permissions,
    created_at: u.created_at,
    created_by: u.created_by,
  }
}

// ---- session ----
export function getCurrentUser(): StoredUser | null {
  return db.users.find((u) => u.id === db.sessionUserId) ?? null
}

export function login(email: string, password: string): { user: StoredUser } | { error: string } {
  const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
  if (!u || u.password !== password) return { error: 'Invalid email or password.' }
  if (u.status === 'disabled') return { error: 'This account has been disabled. Contact your administrator.' }
  persist({ ...db, sessionUserId: u.id })
  return { user: u }
}

export function logout() {
  persist({ ...db, sessionUserId: null })
}

export function acceptTosForCurrent(): string | null {
  const u = getCurrentUser()
  if (!u) return null
  u.tos_accepted_at = now()
  persist()
  return u.tos_accepted_at
}

// ---- org / user helpers ----
const isSSA = (u: StoredUser | null) => u?.role === 'superadmin' || u?.role === 'admin'
const isManager = (u: StoredUser | null) => u?.role === 'manager'

/** Roles an actor is allowed to assign when creating/editing users. */
export function assignableRoles(actor: StoredUser | null): Role[] {
  if (isSSA(actor)) return ['manager', 'lead_generator', 'setter', 'closer']
  if (isManager(actor)) return ['manager', 'lead_generator', 'setter', 'closer']
  return []
}

// ---- orgs ----
export function listOrgs(): Org[] {
  return db.orgs.map((o) => ({
    ...o,
    user_count: db.users.filter((u) => u.org_id === o.id).length,
    manager_count: db.users.filter((u) => u.org_id === o.id && u.role === 'manager').length,
  }))
}

export function createOrg(name: string): Org {
  const org: Org = { id: uid('org'), name: name.trim(), created_at: now() }
  db.orgs.unshift(org)
  persist()
  return org
}

export function deleteOrg(id: string) {
  db.orgs = db.orgs.filter((o) => o.id !== id)
  db.users = db.users.filter((u) => u.org_id !== id)
  persist()
}

// ---- users ----
export interface CreateUserInput {
  name: string
  email: string
  password: string
  role: Role
  org_id: string | null
  permissions?: PermissionOverrides
}

/** Users visible to the actor (SSA → all; manager → own org). */
export function listUsers(actor: StoredUser | null, orgFilter?: string): StoredUser[] {
  let rows = db.users.filter((u) => u.id !== 'usr_ssa' || isSSA(actor)) // hide SSA from non-SSA
  if (isManager(actor)) rows = rows.filter((u) => u.org_id === actor!.org_id)
  if (orgFilter) rows = rows.filter((u) => u.org_id === orgFilter)
  return rows
}

export function findUser(id: string): StoredUser | undefined {
  return db.users.find((u) => u.id === id)
}

export function createUser(actor: StoredUser | null, input: CreateUserInput): { user: StoredUser } | { error: string } {
  if (!actor || (!isSSA(actor) && !isManager(actor))) return { error: 'Not authorized to create users.' }
  if (!assignableRoles(actor).includes(input.role)) return { error: `You cannot assign the "${input.role}" role.` }

  // Manager can only create users inside their own org.
  const org_id = isManager(actor) ? actor.org_id : input.org_id
  if (!org_id) return { error: 'Select an organization for this user.' }

  const email = input.email.trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter a valid email address.' }
  if (db.users.some((u) => u.email.toLowerCase() === email)) return { error: 'A user with this email already exists.' }
  if (!input.password || input.password.length < 6) return { error: 'Password must be at least 6 characters.' }

  const user: StoredUser = {
    id: uid('usr'),
    name: input.name.trim(),
    email: input.email.trim(),
    password: input.password,
    role: input.role,
    org_id,
    status: 'active',
    permissions: input.permissions ?? { granted: [], denied: [] },
    timezone: 'UTC',
    tos_accepted_at: now(),
    created_at: now(),
    created_by: actor.name,
  }
  db.users.unshift(user)
  persist()
  return { user }
}

export interface UpdateUserInput {
  name?: string
  role?: Role
  permissions?: PermissionOverrides
  status?: 'active' | 'disabled'
  org_id?: string | null
}

export function canManageTarget(actor: StoredUser | null, target: StoredUser): boolean {
  if (!actor) return false
  if (target.role === 'superadmin') return false // SSA account is not editable here
  if (isSSA(actor)) return true
  if (isManager(actor)) return target.org_id === actor.org_id
  return false
}

export function updateUser(actor: StoredUser | null, id: string, patch: UpdateUserInput): { user: StoredUser } | { error: string } {
  const target = findUser(id)
  if (!target) return { error: 'User not found.' }
  if (!canManageTarget(actor, target)) return { error: 'Not authorized to edit this user.' }
  if (patch.role && !assignableRoles(actor).includes(patch.role)) return { error: `You cannot assign the "${patch.role}" role.` }
  if (patch.name !== undefined) target.name = patch.name.trim()
  if (patch.role !== undefined) target.role = patch.role
  if (patch.permissions !== undefined) target.permissions = patch.permissions
  if (patch.status !== undefined) target.status = patch.status
  if (patch.org_id !== undefined && isSSA(actor)) target.org_id = patch.org_id
  persist()
  return { user: target }
}

export function resetPassword(actor: StoredUser | null, id: string, password: string): { ok: true } | { error: string } {
  const target = findUser(id)
  if (!target) return { error: 'User not found.' }
  if (!canManageTarget(actor, target)) return { error: 'Not authorized.' }
  if (!password || password.length < 6) return { error: 'Password must be at least 6 characters.' }
  target.password = password
  persist()
  return { ok: true }
}

export function deleteUser(actor: StoredUser | null, id: string): { ok: true } | { error: string } {
  const target = findUser(id)
  if (!target) return { error: 'User not found.' }
  if (!canManageTarget(actor, target)) return { error: 'Not authorized.' }
  db.users = db.users.filter((u) => u.id !== id)
  persist()
  return { ok: true }
}

/** Org id used to scope data created by this user (null for SSA = global). */
export function currentOrgId(): string | null {
  return getCurrentUser()?.org_id ?? null
}

/** The org shown to a user (synthetic "All organizations" for the SSA). */
export function clientForUser(u: StoredUser): Client {
  if (!u.org_id) return { id: '*', name: 'All organizations', plan: 'scale', credits_remaining: null }
  const o = db.orgs.find((x) => x.id === u.org_id)
  return { id: u.org_id, name: o?.name ?? 'Organization', plan: 'growth', credits_remaining: null }
}

/** Self-service profile update for the signed-in user. */
export function updateCurrentProfile(patch: { name?: string; timezone?: string }) {
  const u = getCurrentUser()
  if (!u) return
  if (patch.name !== undefined) u.name = patch.name
  if (patch.timezone !== undefined) u.timezone = patch.timezone
  persist()
}
