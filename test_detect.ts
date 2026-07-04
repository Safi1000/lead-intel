// Live test of yield-aware search: mimic the Vercel trigger for a tiny qualified run (target 2).
import { readFileSync } from 'node:fs'
const env = readFileSync('.env', 'utf8')
const get = (k: string) => (env.match(new RegExp(`^${k}=(.+)`, 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const [URL, KEY, SECRET] = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PIPELINE_SECRET'].map(get)
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const org = (await (await fetch(`${URL}/rest/v1/pipeline_runs?select=org_id&limit=1&order=started_at.desc`, { headers: H })).json())[0].org_id

const mkBatch = async (name: string) => (await (await fetch(`${URL}/rest/v1/batches`, {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ org_id: org, template_id: null, template_name: 'Google Maps Pipeline', file_name: name, total_rows: 0, imported_count: 0, rejected_count: 0, created_by: 'pipeline' }),
})).json())[0].id

const batchId = await mkBatch('YieldTest — Website')
const batchIdNo = await mkBatch('YieldTest — No Website')
const run = (await (await fetch(`${URL}/rest/v1/pipeline_runs`, {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ org_id: org, status: 'running', qualified_target: 2, batch_id: batchId, batch_id_no_website: batchIdNo }),
})).json())[0]
console.log('run:', run.id)

const r = await fetch(`${URL}/functions/v1/pipeline-run`, {
  method: 'POST', headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ run_id: run.id, org_id: org, qualified_target: 2, batch_id: batchId, batch_id_no_website: batchIdNo, batch_name: 'YieldTest', chunk_index: 0 }),
})
console.log('chunk0:', r.status, (await r.text()).slice(0, 200))
