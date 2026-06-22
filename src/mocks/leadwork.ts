/** MSW handlers + in-memory store for the Phase 1 manual lead workflow. */
import { http, HttpResponse, delay } from 'msw'
import type {
  ImportRejection,
  ImportResult,
  LeadRemark,
  LeadStatus,
  LeadTemplate,
  ManualLead,
  Paginated,
  Role,
  TemplateColumn,
  Temperature,
} from '../api/types'
import { currentOrgId, getCurrentUser } from './accounts'

const ok = (data: unknown) => HttpResponse.json(data as object)
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status })

let seq = 100
const nid = (p: string) => `${p}_${(seq++).toString(36)}`
const now = () => new Date().toISOString()

// No seed data — templates and leads are created by real users per org.
const templates: LeadTemplate[] = []
const leads: ManualLead[] = []

// SSA (org_id null) sees everything; everyone else is scoped to their org.
const isSSA = () => {
  const r = getCurrentUser()?.role
  return r === 'superadmin' || r === 'admin'
}
const inScope = (orgId: string | null) => isSSA() || orgId === currentOrgId()

/** Pick the best column to use as a lead's display label. */
function displayNameFor(data: Record<string, string>, columns: TemplateColumn[]): string {
  const preferred = columns.find((c) => /name|business|company|contact/i.test(c.name))
  const key = preferred?.name ?? columns[0]?.name
  return (key && data[key]) || 'Untitled lead'
}

function findTemplate(id: string) {
  return templates.find((t) => t.id === id)
}
function findLead(id: string) {
  return leads.find((l) => l.id === id)
}

export const leadworkHandlers = [
  // ---- Templates ----
  http.get('/api/templates', () => ok(templates.filter((t) => inScope(t.org_id)))),

  http.get('/api/templates/:id', ({ params }) => {
    const t = findTemplate(params.id as string)
    return t && inScope(t.org_id) ? ok(t) : fail(404, 'not_found', 'Template not found.')
  }),

  http.post('/api/templates', async ({ request }) => {
    await delay(300)
    const body = (await request.json()) as { name: string; columns: { name: string; required: boolean }[] }
    const name = (body.name ?? '').trim()
    if (!name) return fail(400, 'invalid', 'Template name is required.')
    const cleaned = (body.columns ?? []).map((c) => ({ name: (c.name ?? '').trim(), required: !!c.required })).filter((c) => c.name)
    if (cleaned.length === 0) return fail(400, 'invalid', 'Add at least one column.')
    // Column names must be unique (case-sensitive — they map to sheet headers).
    const seen = new Set<string>()
    for (const c of cleaned) {
      if (seen.has(c.name)) return fail(400, 'duplicate_column', `Duplicate column: "${c.name}".`)
      seen.add(c.name)
    }
    const tpl: LeadTemplate = {
      id: nid('tpl'),
      name,
      org_id: currentOrgId(),
      columns: cleaned.map((c) => ({ id: nid('col'), name: c.name, required: c.required })),
      created_by: getCurrentUser()?.name ?? 'You',
      created_at: now(),
      updated_at: now(),
      lead_count: 0,
    }
    templates.unshift(tpl)
    return HttpResponse.json(tpl, { status: 201 })
  }),

  http.put('/api/templates/:id', async ({ params, request }) => {
    await delay(300)
    const t = findTemplate(params.id as string)
    if (!t || !inScope(t.org_id)) return fail(404, 'not_found', 'Template not found.')
    const body = (await request.json()) as { name: string; columns: { name: string; required: boolean }[] }
    const cleaned = (body.columns ?? []).map((c) => ({ name: (c.name ?? '').trim(), required: !!c.required })).filter((c) => c.name)
    if (!body.name?.trim() || cleaned.length === 0) return fail(400, 'invalid', 'Name and at least one column are required.')
    t.name = body.name.trim()
    t.columns = cleaned.map((c) => ({ id: nid('col'), name: c.name, required: c.required }))
    t.updated_at = now()
    return ok(t)
  }),

  http.delete('/api/templates/:id', ({ params }) => {
    const i = templates.findIndex((t) => t.id === params.id)
    if (i === -1 || !inScope(templates[i].org_id)) return fail(404, 'not_found', 'Template not found.')
    templates.splice(i, 1)
    return ok({})
  }),

  // ---- Import (case-sensitive header matching) ----
  http.post('/api/templates/:id/import', async ({ params, request }) => {
    await delay(600)
    const t = findTemplate(params.id as string)
    if (!t || !inScope(t.org_id)) return fail(404, 'not_found', 'Template not found.')
    const body = (await request.json()) as { headers: string[]; rows: Record<string, string>[] }
    const headers = body.headers ?? []
    const rows = body.rows ?? []

    // Required template columns whose exact (case-sensitive) header is absent.
    const missing = t.columns.filter((c) => c.required && !headers.includes(c.name))
    if (missing.length > 0) {
      return fail(
        422,
        'missing_columns',
        `Sheet is missing required column(s): ${missing.map((c) => `"${c.name}"`).join(', ')}. Header match is case-sensitive.`,
      )
    }

    const rejected: ImportRejection[] = []
    let imported = 0
    rows.forEach((row, idx) => {
      const rowNo = idx + 1
      // Map only the template's columns, by exact header name.
      const data: Record<string, string> = {}
      for (const c of t.columns) {
        data[c.name] = (row[c.name] ?? '').toString().trim()
      }
      const emptyRequired = t.columns.filter((c) => c.required && !data[c.name])
      if (emptyRequired.length > 0) {
        rejected.push({ row: rowNo, reason: `Empty required value(s): ${emptyRequired.map((c) => c.name).join(', ')}` })
        return
      }
      if (t.columns.every((c) => !data[c.name])) {
        rejected.push({ row: rowNo, reason: 'Blank row' })
        return
      }
      leads.unshift({
        id: nid('lead'),
        org_id: t.org_id,
        template_id: t.id,
        template_name: t.name,
        data,
        display_name: displayNameFor(data, t.columns),
        status: 'new',
        temperature: null,
        setter: null,
        closer: null,
        remarks: [],
        created_at: now(),
        updated_at: now(),
      })
      imported++
    })
    t.lead_count += imported

    const result: ImportResult = { template_id: t.id, total_rows: rows.length, imported, rejected }
    return ok(result)
  }),

  // ---- Leads (queue lands here; full workspace UI is next phase) ----
  http.get('/api/leads', ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const q = (url.searchParams.get('search') ?? '').toLowerCase()
    let rows = leads.filter((l) => inScope(l.org_id))
    if (status) rows = rows.filter((l) => l.status === status)
    if (q) rows = rows.filter((l) => l.display_name.toLowerCase().includes(q) || Object.values(l.data).some((v) => v.toLowerCase().includes(q)))
    const res: Paginated<ManualLead> = { data: rows, page: 1, page_size: rows.length, total: rows.length }
    return ok(res)
  }),

  http.get('/api/leads/manual/:id', ({ params }) => {
    const l = findLead(params.id as string)
    return l && inScope(l.org_id) ? ok(l) : fail(404, 'not_found', 'Lead not found.')
  }),

  http.patch('/api/leads/manual/:id', async ({ params, request }) => {
    const l = findLead(params.id as string)
    if (!l || !inScope(l.org_id)) return fail(404, 'not_found', 'Lead not found.')
    const body = (await request.json()) as Partial<{ status: LeadStatus; temperature: Temperature; setter: string | null; closer: string | null }>
    if (body.status !== undefined) l.status = body.status
    if (body.temperature !== undefined) l.temperature = body.temperature
    if (body.setter !== undefined) l.setter = body.setter
    if (body.closer !== undefined) l.closer = body.closer
    l.updated_at = now()
    return ok(l)
  }),

  http.post('/api/leads/manual/:id/remarks', async ({ params, request }) => {
    const l = findLead(params.id as string)
    if (!l || !inScope(l.org_id)) return fail(404, 'not_found', 'Lead not found.')
    const body = (await request.json()) as { text: string; author: string; author_role: Role }
    if (!body.text?.trim()) return fail(400, 'invalid', 'Remark text is required.')
    const remark: LeadRemark = { id: nid('rmk'), author: body.author, author_role: body.author_role, text: body.text.trim(), at: now() }
    l.remarks.push(remark)
    l.updated_at = now()
    return HttpResponse.json(remark, { status: 201 })
  }),
]
