/**
 * One-off backfill: re-scan pipeline (google_maps) leads that have a real website but no email,
 * using the upgraded analyzeWebsite (cfemail/entity/(at)(dot) de-obfuscation + more pages).
 * Writes any recovered email back to leads.data + sourced_places. Idempotent: only fills blanks.
 *
 * Run:  deno run -A scripts/backfill_emails.ts            (apply)
 *       deno run -A scripts/backfill_emails.ts --dry       (scan only, no writes)
 */
import { analyzeWebsite } from '../supabase/functions/pipeline-run/_website.ts'

const DRY = Deno.args.includes('--dry')
const CONCURRENCY = 6
const LIMIT = Number((Deno.args.find((a) => a.startsWith('--limit='))?.split('=')[1]) ?? 0)

// --- env ---
const env: Record<string, string> = {}
for (const line of (await Deno.readTextFile(new URL('../.env', import.meta.url))).split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const SUPABASE_URL = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) { console.error('missing SUPABASE_URL / SERVICE_ROLE_KEY'); Deno.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

// --- fetch all google_maps leads (paginated), filter candidates in JS ---
type Lead = { id: string; data: Record<string, string> }
const all: Lead[] = []
for (let from = 0; ; from += 1000) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?source_type=eq.google_maps&select=id,data`, {
    headers: { ...H, 'Range-Unit': 'items', Range: `${from}-${from + 999}` },
  })
  if (!res.ok) { console.error('fetch leads failed', res.status, await res.text()); Deno.exit(1) }
  const page = await res.json() as Lead[]
  all.push(...page)
  if (page.length < 1000) break
}
let candidates = all.filter((l) =>
  !(l.data['Email'] ?? '').trim() &&
  (l.data['Website'] ?? '').trim() &&
  ['weak', 'good', 'unknown'].includes((l.data['Website Status'] ?? '').trim()))
if (LIMIT > 0) candidates = candidates.slice(0, LIMIT)

console.log(`total google_maps leads: ${all.length} | re-scan candidates: ${candidates.length}${DRY ? ' | DRY RUN' : ''}\n`)

let scanned = 0, found = 0, updated = 0, failed = 0
const hits: string[] = []

async function processLead(l: Lead) {
  const website = l.data['Website'].trim()
  try {
    const r = await analyzeWebsite(website)
    scanned++
    if (r.email) {
      found++
      const verified = r.emailMxOk === true ? 'Yes (MX)' : r.emailMxOk === false ? 'No — domain cannot receive mail' : ''
      hits.push(`${l.data['Business Name'] ?? l.id}  ->  ${r.email}  (${r.emailSource}/${r.emailConfidence}${verified ? ', ' + verified : ''})`)
      if (!DRY) {
        const newData = { ...l.data, Email: r.email, 'Email Verified': verified }
        const up1 = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${l.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ data: newData }) })
        const up2 = await fetch(`${SUPABASE_URL}/rest/v1/sourced_places?crm_lead_id=eq.${l.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ email: r.email, email_source: r.emailSource, email_confidence: r.emailConfidence }) })
        if (up1.ok) updated++; else console.error(`  update failed ${l.id}:`, up1.status, await up1.text())
        if (!up2.ok) console.error(`  sourced_places update failed ${l.id}:`, up2.status, await up2.text())
      }
    }
  } catch (e) {
    failed++
    console.error(`  scan failed ${l.id} (${website}):`, (e as Error).message)
  }
  if (scanned % 25 === 0) console.log(`  ...${scanned}/${candidates.length} scanned, ${found} emails found`)
}

// simple concurrency pool
let idx = 0
async function worker() { while (idx < candidates.length) { const i = idx++; await processLead(candidates[i]) } }
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

console.log(`\n===== DONE =====`)
console.log(`scanned: ${scanned} | emails found: ${found} | leads updated: ${updated} | scan errors: ${failed}`)
console.log(`\nRecovered emails:`)
for (const h of hits) console.log('  ' + h)
