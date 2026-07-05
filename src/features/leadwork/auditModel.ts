/**
 * Turns a ManualLead's raw enrichment fields into a structured audit model the report renders.
 * Pure + defensive: every section is optional, so a thin lead still produces a valid (shorter) audit.
 */
import type { ManualLead } from '../../api/types'

export type Severity = 'crit' | 'warn' | 'good'

export interface ScoreTile {
  label: string
  value: string
  sub?: string
  note: string
  severity: Severity
  meterPct?: number // 0–100; omit to hide the bar
}
export interface Finding {
  kicker: string
  body: string
  severity: Severity
}
export interface AuditModel {
  businessName: string
  location: string
  website: string
  rating: string | null
  overall: { score: number | null; label: string; severity: Severity }
  tiles: ScoreTile[]
  findings: Finding[]
  voice: string | null
}

const val = (l: ManualLead, key: string): string => (l.data?.[key] ?? '').trim()

/** "45/100 — Critical" → { num: 45, tag: 'Critical' } */
function parseScore(s: string): { num: number; tag: string } | null {
  const m = s.match(/(\d+)\s*\/\s*100(?:\s*[—-]\s*([A-Za-z]+))?/)
  if (!m) return null
  return { num: Number(m[1]), tag: (m[2] ?? '').toLowerCase() }
}
function tagSeverity(tag: string): Severity {
  if (/good|healthy|fast/.test(tag)) return 'good'
  if (/critical|poor/.test(tag)) return 'crit'
  return 'warn' // weak / slow / needs work
}

/** Split a numbered pain-points string ("1. … 2. … 3. …") into individual points. */
function splitPoints(s: string): string[] {
  const out: string[] = []
  const re = /\d+\.\s+([\s\S]*?)(?=\s+\d+\.\s+|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) { const t = m[1].trim(); if (t) out.push(t) }
  if (out.length === 0) return s.split(/\n+/).map((x) => x.trim()).filter(Boolean)
  return out
}

/** Give each pain point a short kicker + severity from its wording (first match wins). */
function classify(text: string): { kicker: string; severity: Severity } {
  const t = text.toLowerCase()
  if (/\bads?\b|ad spend|google ads/.test(t)) return { kicker: 'Wasted ad spend', severity: 'crit' }
  if (/slow|load|speed|seconds/.test(t)) return { kicker: 'Slow to load', severity: 'crit' }
  if (/mobile|phone/.test(t)) return { kicker: 'Not mobile-ready', severity: 'crit' }
  if (/book|appointment|respond|repl|call ?back|message|schedul/.test(t)) return { kicker: 'Bookings at risk', severity: 'crit' }
  if (/no (real )?website|booking (page|link)|3rd[- ]party/.test(t)) return { kicker: 'No real website', severity: 'crit' }
  if (/seo|search|meta|h1|heading|visib|rank/.test(t)) return { kicker: 'Low search visibility', severity: 'warn' }
  if (/outdated|copyright|20\d\d|dated|modern/.test(t)) return { kicker: 'Outdated design', severity: 'warn' }
  return { kicker: 'Worth fixing', severity: 'warn' }
}

export function buildAudit(lead: ManualLead): AuditModel {
  const businessName = val(lead, 'Business Name') || lead.display_name
  const location = val(lead, 'Search Location') || val(lead, 'Address')
  const website = val(lead, 'Website')
  const rating = val(lead, 'Rating') || null

  const seo = parseScore(val(lead, 'SEO Score'))
  const perf = parseScore(val(lead, 'Performance Score'))
  const emailV = val(lead, 'Email Verified')
  const adsRunning = /^yes/i.test(val(lead, 'Running Google Ads'))

  // ---- Scorecard tiles (whatever's available, up to 4) ----
  const tiles: ScoreTile[] = []
  if (seo) tiles.push({
    label: 'Search Visibility', value: String(seo.num), sub: '/ 100', severity: tagSeverity(seo.tag),
    meterPct: seo.num, note: seo.num < 50 ? 'Missing the basics Google looks for.' : seo.num < 80 ? 'Room to rank higher.' : 'Solid search foundation.',
  })
  if (perf) tiles.push({
    label: 'Mobile Speed', value: String(perf.num), sub: '/ 100', severity: tagSeverity(perf.tag),
    meterPct: perf.num, note: perf.num < 50 ? 'Painfully slow on phones.' : perf.num < 90 ? 'Slower than visitors will wait.' : 'Loads fast on phones.',
  })
  if (emailV) {
    const ok = /^yes/i.test(emailV)
    tiles.push({ label: 'Email Setup', value: ok ? '✓' : '✕', severity: ok ? 'good' : 'crit', meterPct: ok ? 100 : 15, note: ok ? 'Your inbox can receive mail.' : 'Domain can’t receive mail.' })
  }
  if (adsRunning) tiles.push({ label: 'Google Ads', value: 'Active', severity: 'crit', note: 'Paying to send traffic to this site.' })
  else if (rating) tiles.push({ label: 'Google Rating', value: rating, sub: '★', severity: 'good', note: 'Well-reviewed — the reputation is there.' })
  const trimmedTiles = tiles.slice(0, 4)

  // ---- Overall dial: average of the /100 scores we have ----
  const nums = [seo?.num, perf?.num].filter((n): n is number => typeof n === 'number')
  let overall: AuditModel['overall']
  if (nums.length) {
    const score = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
    const severity: Severity = score >= 80 ? 'good' : score >= 55 ? 'warn' : 'crit'
    overall = { score, label: severity === 'good' ? 'Looking Strong' : 'Needs Attention', severity }
  } else {
    overall = { score: null, label: 'Needs Attention', severity: 'warn' }
  }

  // ---- Findings from the AI pain points ----
  const findings: Finding[] = splitPoints(val(lead, 'Pain Points')).map((body) => ({ body, ...classify(body) }))

  const voice = val(lead, 'Personalization Notes') || null

  return { businessName, location, website, rating, overall, tiles: trimmedTiles, findings, voice }
}
