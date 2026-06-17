import { useState } from 'react'
import { Check, Copy, Play } from 'lucide-react'
import { Button, Card, Badge } from '../../components/ui/primitives'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface Param {
  name: string
  in: 'path' | 'query' | 'body'
  type: string
  required: boolean
  description: string
}

interface Endpoint {
  id: string
  method: Method
  path: string
  summary: string
  description: string
  params: Param[]
  response: unknown
}

interface Group {
  name: string
  endpoints: Endpoint[]
}

const GROUPS: Group[] = [
  {
    name: 'Auth',
    endpoints: [
      {
        id: 'auth-token',
        method: 'POST',
        path: '/v1/auth/token',
        summary: 'Exchange credentials for a token',
        description: 'Authenticate with an API key and secret to obtain a short-lived bearer token for subsequent requests.',
        params: [
          { name: 'key_id', in: 'body', type: 'string', required: true, description: 'Your API key id.' },
          { name: 'secret', in: 'body', type: 'string', required: true, description: 'The API key secret.' },
        ],
        response: { access_token: 'tok_live_8f3a…', expires_in: 3600, token_type: 'Bearer' },
      },
    ],
  },
  {
    name: 'Runs',
    endpoints: [
      {
        id: 'runs-list',
        method: 'GET',
        path: '/v1/runs',
        summary: 'List runs',
        description: 'Returns a paginated list of enrichment runs for the authenticated account.',
        params: [
          { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by run status.' },
          { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number (default 1).' },
        ],
        response: { data: [{ id: 'run_1a2b', trade: 'roofing', status: 'completed', leads_found: 142 }], page: 1, total: 37 },
      },
      {
        id: 'runs-create',
        method: 'POST',
        path: '/v1/runs',
        summary: 'Create a run',
        description: 'Start a new enrichment run for a trade and location.',
        params: [
          { name: 'trade', in: 'body', type: 'string', required: true, description: 'Trade slug, e.g. "roofing".' },
          { name: 'city', in: 'body', type: 'string', required: true, description: 'Target city.' },
          { name: 'include_owner_phone', in: 'body', type: 'boolean', required: false, description: 'Enrich owner mobile numbers.' },
        ],
        response: { id: 'run_9z8y', status: 'queued', eta_seconds: 420 },
      },
    ],
  },
  {
    name: 'Leads',
    endpoints: [
      {
        id: 'leads-get',
        method: 'GET',
        path: '/v1/leads/{id}',
        summary: 'Get a lead',
        description: 'Retrieve a single enriched lead with full provenance and confidence per field.',
        params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'The lead id.' }],
        response: { id: 'lead_42', business_name: 'Acme Roofing', owner_name: { value: 'Jane Doe', confidence: 'verified' } },
      },
    ],
  },
  {
    name: 'Exports',
    endpoints: [
      {
        id: 'exports-create',
        method: 'POST',
        path: '/v1/exports',
        summary: 'Create an export',
        description: 'Generate a CSV or XLSX export of leads from a run or batch.',
        params: [
          { name: 'run_id', in: 'body', type: 'string', required: false, description: 'Run to export.' },
          { name: 'format', in: 'body', type: 'string', required: true, description: '"csv" or "xlsx".' },
        ],
        response: { id: 'exp_77', status: 'processing', format: 'csv' },
      },
    ],
  },
]

const METHOD_TONE: Record<Method, string> = {
  GET: 'bg-[var(--c-verified-bg)] text-[var(--c-verified-text)]',
  POST: 'bg-[var(--color-surface-2)] text-[var(--color-primary)]',
  PUT: 'bg-amber-50 text-amber-700',
  DELETE: 'bg-[var(--c-unverified-bg)] text-[var(--c-unverified-text)]',
}

type Lang = 'cURL' | 'JS' | 'Python'

function sample(lang: Lang, ep: Endpoint): string {
  const url = `https://api.leadintel.io${ep.path.replace('{id}', '42')}`
  if (lang === 'cURL') {
    return `curl -X ${ep.method} "${url}" \\\n  -H "Authorization: Bearer $LEADINTEL_TOKEN" \\\n  -H "Content-Type: application/json"`
  }
  if (lang === 'JS') {
    return `const res = await fetch("${url}", {\n  method: "${ep.method}",\n  headers: {\n    Authorization: \`Bearer \${process.env.LEADINTEL_TOKEN}\`,\n    "Content-Type": "application/json",\n  },\n})\nconst data = await res.json()`
  }
  return `import requests\n\nres = requests.${ep.method.toLowerCase()}(\n    "${url}",\n    headers={"Authorization": f"Bearer {token}"},\n)\ndata = res.json()`
}

export function ApiDocsPage() {
  const [activeId, setActiveId] = useState(GROUPS[0].endpoints[0].id)
  const [lang, setLang] = useState<Lang>('cURL')
  const [tried, setTried] = useState(false)
  const [copied, setCopied] = useState(false)

  const active = GROUPS.flatMap((g) => g.endpoints).find((e) => e.id === activeId) ?? GROUPS[0].endpoints[0]

  function copySample() {
    navigator.clipboard?.writeText(sample(lang, active))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="reveal">
      <PageHeader title="API Documentation" subtitle="Self-serve reference for the LeadIntel REST API." />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="space-y-5">
          {GROUPS.map((g) => (
            <div key={g.name}>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{g.name}</p>
              <ul className="space-y-0.5">
                {g.endpoints.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => { setActiveId(e.id); setTried(false) }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors',
                        e.id === activeId ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                      )}
                    >
                      <span className={cn('rounded px-1.5 py-0.5 font-data text-[10px] font-semibold', METHOD_TONE[e.method])}>{e.method}</span>
                      <span className="truncate">{e.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn('rounded px-2 py-0.5 font-data text-[12px] font-semibold', METHOD_TONE[active.method])}>{active.method}</span>
              <code className="font-data text-[15px] text-[var(--color-text)]">{active.path}</code>
            </div>
            <h2 className="mt-3 text-[18px] font-semibold text-[var(--color-text)]">{active.summary}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{active.description}</p>

            <h3 className="mt-6 mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Parameters</h3>
            {active.params.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No parameters.</p>
            ) : (
              <div className="overflow-hidden rounded-[8px] border border-[var(--color-border)]">
                <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_2fr] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  <span>Name</span><span>In</span><span>Type</span><span>Description</span>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {active.params.map((p) => (
                    <div key={p.name} className="grid grid-cols-[1.4fr_0.8fr_0.8fr_2fr] gap-3 px-3 py-2 text-[13px]">
                      <span className="font-data text-[var(--color-text)]">
                        {p.name}{p.required && <span className="ml-1 text-[var(--c-unverified)]">*</span>}
                      </span>
                      <Badge className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">{p.in}</Badge>
                      <span className="font-data text-[var(--color-text-secondary)]">{p.type}</span>
                      <span className="text-[var(--color-text-secondary)]">{p.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-[var(--color-text)]">Code sample</h3>
              <div className="inline-flex rounded-[8px] border border-[var(--color-border)] p-0.5">
                {(['cURL', 'JS', 'Python'] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={cn(
                      'rounded-[6px] px-3 py-1 text-[13px] font-medium transition-colors',
                      lang === l ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative">
              <pre className="font-data overflow-auto rounded-[8px] bg-slate-900 p-4 text-[12px] leading-relaxed text-slate-100">{sample(lang, active)}</pre>
              <Button size="sm" variant="ghost" className="absolute right-2 top-2 text-slate-300 hover:bg-slate-800" onClick={copySample}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-[var(--color-text)]">Try it</h3>
              <Button size="sm" onClick={() => setTried(true)}>
                <Play className="h-3.5 w-3.5" /> Send request
              </Button>
            </div>
            {tried ? (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-[var(--c-verified-bg)] px-2 py-0.5 font-data text-[12px] font-medium text-[var(--c-verified-text)]">200 OK</span>
                  <span className="font-data text-[11px] text-[var(--color-text-muted)]">application/json</span>
                </div>
                <pre className="font-data overflow-auto rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-[12px] leading-relaxed text-[var(--color-text)]">
                  {JSON.stringify(active.response, null, 2)}
                </pre>
              </>
            ) : (
              <p className="rounded-[8px] border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-[13px] text-[var(--color-text-muted)]">
                Send the request to preview a sample response.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
