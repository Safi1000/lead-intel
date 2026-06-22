/** MSW handlers for organizations + user management (SSA / manager). */
import { http, HttpResponse, delay } from 'msw'
import {
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  getCurrentUser,
  listOrgs,
  listUsers,
  resetPassword,
  toManagedUser,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
} from './accounts'

const ok = (data: unknown) => HttpResponse.json(data as object)
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status })

const isSSA = () => {
  const u = getCurrentUser()
  return u?.role === 'superadmin' || u?.role === 'admin'
}

/** Map an accounts-layer result into an HTTP response. */
function result<T>(res: { error: string } | T, map: (v: T) => unknown, status = 200) {
  if (res && typeof res === 'object' && 'error' in res) {
    const msg = (res as { error: string }).error
    const code = /authoriz|cannot|disabled/i.test(msg) ? 403 : 422
    return fail(code, 'rejected', msg)
  }
  return HttpResponse.json(map(res as T) as object, { status })
}

export const accountsHandlers = [
  // ---- Organizations (SSA only) ----
  http.get('/api/orgs', () => {
    if (!isSSA()) return fail(403, 'forbidden', 'Only the super admin can manage organizations.')
    return ok(listOrgs())
  }),
  http.post('/api/orgs', async ({ request }) => {
    await delay(300)
    if (!isSSA()) return fail(403, 'forbidden', 'Only the super admin can create organizations.')
    const { name } = (await request.json()) as { name: string }
    if (!name?.trim()) return fail(422, 'invalid', 'Organization name is required.')
    return HttpResponse.json(createOrg(name) as object, { status: 201 })
  }),
  http.delete('/api/orgs/:id', ({ params }) => {
    if (!isSSA()) return fail(403, 'forbidden', 'Only the super admin can delete organizations.')
    deleteOrg(params.id as string)
    return ok({})
  }),

  // ---- Users (SSA: all orgs · manager: own org) ----
  http.get('/api/users', ({ request }) => {
    const actor = getCurrentUser()
    const orgFilter = new URL(request.url).searchParams.get('org_id') ?? undefined
    return ok(listUsers(actor, orgFilter).map(toManagedUser))
  }),
  http.post('/api/users', async ({ request }) => {
    await delay(300)
    const actor = getCurrentUser()
    const body = (await request.json()) as CreateUserInput
    return result(createUser(actor, body), (r) => toManagedUser(r.user), 201)
  }),
  http.patch('/api/users/:id', async ({ params, request }) => {
    const actor = getCurrentUser()
    const body = (await request.json()) as UpdateUserInput
    return result(updateUser(actor, params.id as string, body), (r) => toManagedUser(r.user))
  }),
  http.post('/api/users/:id/reset-password', async ({ params, request }) => {
    const actor = getCurrentUser()
    const { password } = (await request.json()) as { password: string }
    return result(resetPassword(actor, params.id as string, password), () => ({}))
  }),
  http.delete('/api/users/:id', ({ params }) => {
    const actor = getCurrentUser()
    return result(deleteUser(actor, params.id as string), () => ({}))
  }),
]
