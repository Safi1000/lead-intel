// Correct ERT Cosmetic Clinic: fresh honest re-score (email now found), update sourced_places +
// CRM lead, then re-trigger reviews-finalize so pain points regenerate with corrected context.
import { readFileSync } from 'node:fs'
import { analyzeWebsite } from './supabase/functions/pipeline-run/_website.ts'
import { scorePlace } from './supabase/functions/pipeline-run/_ai.ts'

const env = readFileSync('.env', 'utf8')
const get = (k: string) => (env.match(new RegExp(`^${k}=(.+)`, 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const [OPENAI, GOOGLE, URL, KEY, SECRET] = ['OPENAI_API_KEY', 'GOOGLE_PLACES_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PIPELINE_SECRET'].map(get)
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const PID = 'ChIJbYoEkt_hhVQRxnK6jhChQ2A'
const LEAD = '16ff9bdb-2bd0-49a0-b26f-46f5dbeb8560'

// 1. Fresh signals + score
const ws = await analyzeWebsite('http://www.ertclinic.ca/')
console.log('email:', ws.email, '| booking:', ws.bookingPlatform)
const d = await (await fetch(`https://places.googleapis.com/v1/places/${PID}`, { headers: { 'X-Goog-Api-Key': GOOGLE, 'X-Goog-FieldMask': 'id,displayName,internationalPhoneNumber,formattedAddress,rating,primaryType,reviews' } })).json()
const reviews = (d.reviews ?? []).map((r: { text?: { text?: string }; rating?: number }) => ({ text: r.text?.text ?? '', rating: r.rating ?? 0 }))
const { score } = await scorePlace({
  name: d.displayName?.text ?? 'ERT Cosmetic Clinic', address: d.formattedAddress ?? '', phone: d.internationalPhoneNumber ?? null,
  website: 'http://www.ertclinic.ca/', rating: d.rating ?? null, businessType: d.primaryType ?? null,
  reviews, email: ws.email, websiteSignals: ws,
}, 6, 'gpt-4o-mini', OPENAI)
console.log(`fresh score: status=${score.website_status} q=${score.quality_score} low_fit=${score.low_fit} conf=${score.confidence}`)
console.log('reason:', score.status_reason)
console.log('issue_note:', String(score.site_issue_note).slice(0, 160))

// 2. Correct sourced_places
await fetch(`${URL}/rest/v1/sourced_places?place_id=eq.${PID}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify({
    email: ws.email, website_status: score.website_status, status_reason: score.status_reason,
    site_issue_note: score.site_issue_note, quality_score: score.quality_score, low_fit: score.low_fit,
  }),
})

// 3. Correct the CRM lead's data jsonb
const lead = (await (await fetch(`${URL}/rest/v1/leads?id=eq.${LEAD}&select=data`, { headers: H })).json())[0]
await fetch(`${URL}/rest/v1/leads?id=eq.${LEAD}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify({
    data: {
      ...lead.data, 'Email': ws.email ?? '', 'Website Status': score.website_status,
      'Why This Status': score.status_reason, 'Site Issue Note': score.site_issue_note,
      'Quality Score': String(score.quality_score),
    },
  }),
})
console.log('sourced_places + lead corrected')

// 4. Re-trigger insights with corrected site context (re-merges the stored 40 reviews)
const fin = await fetch(`${URL}/functions/v1/reviews-finalize?id=07041010-2021-0298-0000-53f9f1612034&tag=${PID}&secret=${encodeURIComponent(SECRET)}`)
console.log('finalize re-run:', fin.status, await fin.text())
const after = (await (await fetch(`${URL}/rest/v1/sourced_places?place_id=eq.${PID}&select=pain_points`, { headers: H })).json())[0]
console.log('\nNEW pain_points:', String(after.pain_points).slice(0, 300))
