/**
 * Offline niche score-audit harness.
 *
 * Runs the REAL engine enrichment (analyzeWebsite) and scorer (scorePlace) over a list of
 * businesses, WITHOUT touching Supabase, the billing wallet, or the leads table. Use it to
 * calibrate a new vertical (e.g. dental) before selling it: feed in verified real practices,
 * eyeball what the engine decides (weak/good/none, quality_score, which booking platform it
 * detected, which issues it flagged), and catch niche-specific false positives.
 *
 * Runs on Deno (already installed for `deno check`). No DB, no writes to prod.
 *
 * USAGE
 *   # website signals only (no OpenAI needed) — validates booking + issue detection:
 *   deno run -A scripts/audit_niche.ts --vertical dental --in places.json --out audit.csv
 *
 *   # full scoring too (set the key so scorePlace runs):
 *   OPENAI_API_KEY=sk-... deno run -A scripts/audit_niche.ts \
 *     --vertical dental --in places.json --out audit.csv --model gpt-4o-mini --threshold 6
 *
 * INPUT (--in <file.json>): a JSON array of businesses. Only `name` is required; give `website`
 * to exercise the site scan, and `reviews` to exercise pain_points.
 *   [
 *     { "name": "Bright Smile Dental", "website": "https://brightsmile.com",
 *       "phone": "+1 555 000 0000", "rating": 4.8, "businessType": "dentist",
 *       "reviews": [ { "text": "Hard to reach to book an appointment", "rating": 3 } ] }
 *   ]
 *
 * OUTPUT (--out <file.csv>): one row per business with the fields a human audits. Also prints a
 * short summary (weak/good/none/unknown counts) to stdout.
 */

import { analyzeWebsite } from '../supabase/functions/pipeline-run/_website.ts'
import { scorePlace } from '../supabase/functions/pipeline-run/_ai.ts'
import type { PlaceForScoring } from '../supabase/functions/pipeline-run/_ai.ts'

// Niche label + AI prompt per vertical — mirrors the seeded `verticals` rows so the audit applies
// the same niche override the live engine would. Keep in sync with the verticals table.
const VERTICALS: Record<string, { label: string; prompt: string }> = {
  med_spa: {
    label: 'Med Spa',
    prompt: 'A medical or aesthetic spa offering Botox, fillers, laser, skin/anti-aging — an established local business we could sell a website redesign or lead-gen to.',
  },
  dental: {
    label: 'Dental Clinic',
    prompt: 'A general/cosmetic dental or orthodontic practice — an established local business we could sell a website redesign or lead-gen to.',
  },
  hvac: {
    label: 'HVAC / Home Services',
    prompt: 'A residential home-services trade contractor — HVAC/heating & cooling, roofing, plumbing, electrical, landscaping/lawn care, general contracting & remodeling, painting, garage doors, pest control, flooring, fencing, concrete, gutters, tree service, pressure washing, restoration, windows, decks, or handyman — an established local business that sends a crew or technician to the customer\'s home to do the work, which we could sell a website redesign, first website, SEO, or online lead-gen to. NOT a hardware/home-improvement store, supplier, distributor, manufacturer, real-estate agency, or online marketplace.',
  },
  law_firm: {
    label: 'Law Firm',
    prompt: 'A small/mid law practice (personal injury, family, criminal, etc.) — an established local firm we could sell a website redesign or lead-gen to.',
  },
}

interface InputPlace {
  name: string
  website?: string | null
  address?: string
  phone?: string | null
  rating?: number | null
  businessType?: string | null
  reviews?: Array<{ text: string; rating: number }>
}

function arg(flag: string, fallback?: string): string | undefined {
  const i = Deno.args.indexOf(flag)
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : fallback
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const vertical = arg('--vertical', 'dental')!
  const inPath = arg('--in')
  const outPath = arg('--out', `audit_${vertical}.csv`)!
  const model = arg('--model', 'gpt-4o-mini')!
  const threshold = Number(arg('--threshold', '6'))
  const niche = VERTICALS[vertical]
  if (!niche) { console.error(`Unknown vertical "${vertical}". Known: ${Object.keys(VERTICALS).join(', ')}`); Deno.exit(1) }
  if (!inPath) { console.error('Missing --in <places.json>'); Deno.exit(1) }

  const places: InputPlace[] = JSON.parse(await Deno.readTextFile(inPath))
  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  const willScore = openaiKey.length > 0
  console.log(`Auditing ${places.length} "${niche.label}" businesses — website scan${willScore ? ' + AI scoring' : ' ONLY (set OPENAI_API_KEY to score)'}\n`)

  const header = [
    'name', 'website', 'reachable', 'booking_detected', 'booking_platform', 'tech_stack',
    'seo_score', 'issues', 'website_status', 'quality_score', 'is_correct_niche', 'low_fit',
    'confidence', 'status_reason', 'site_issue_note', 'pain_points',
  ]
  const rows: string[][] = [header]
  const tally: Record<string, number> = { weak: 0, good: 0, none: 0, unknown: 0, unscored: 0 }

  for (const p of places) {
    const ws = p.website ? await analyzeWebsite(p.website, vertical) : null

    let status = ws ? '' : (p.website ? 'unknown' : 'none')
    let score = '', correct = '', lowFit = '', conf = '', reason = '', issueNote = '', pain = ''

    if (willScore) {
      const forAi: PlaceForScoring = {
        name: p.name, address: p.address ?? '', phone: p.phone ?? null, website: p.website ?? null,
        rating: p.rating ?? null, businessType: p.businessType ?? null,
        reviews: p.reviews ?? [], email: ws?.email ?? null, websiteSignals: ws,
      }
      try {
        const { score: s } = await scorePlace(forAi, threshold, model, openaiKey, niche)
        // Mirror the engine's hard override: no real site => 'none'.
        status = !p.website ? 'none' : s.website_status
        score = String(s.quality_score); correct = String(s.is_correct_niche); lowFit = String(s.low_fit)
        conf = s.confidence; reason = s.status_reason; issueNote = s.site_issue_note; pain = s.pain_points
      } catch (e) {
        reason = `SCORING ERROR: ${(e as Error).message}`
      }
    }
    tally[status] = (tally[status] ?? 0) + 1
    if (!willScore) tally.unscored++

    rows.push([
      p.name, p.website ?? '', String(!!ws?.reachable),
      String(!!ws?.hasBookingWidget), ws?.bookingPlatform ?? '', ws?.techStack ?? '',
      ws?.seoScore != null ? String(ws.seoScore) : '',
      (ws?.detectedIssues ?? []).join(' | '),
      status, score, correct, lowFit, conf, reason, issueNote, pain,
    ].map(csvCell))

    console.log(`• ${p.name.padEnd(34).slice(0, 34)} ${status.padEnd(8)} q${score || '-'}  ${ws?.hasBookingWidget ? `booking:${ws.bookingPlatform}` : 'no-booking'}`)
  }

  await Deno.writeTextFile(outPath, rows.map((r) => r.join(',')).join('\n'))
  console.log(`\nWrote ${places.length} rows → ${outPath}`)
  console.log(`Summary: ${Object.entries(tally).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join('  ')}`)
}

main().catch((e) => { console.error(e); Deno.exit(1) })
