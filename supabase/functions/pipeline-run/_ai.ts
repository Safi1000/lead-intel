/**
 * OpenAI Structured Outputs scorer for the med spa lead pipeline.
 * Hard-coded for the US med spa / aesthetic clinic niche.
 * Returns: is_correct_niche, website_status, site_issue_note, quality_score, low_fit,
 *          pain_points, personalization_notes.
 * Schema is enforced at the grammar level (strict: true) — malformed JSON is impossible.
 */

import type { WebsiteResult } from './_website.ts'

export interface AiScore {
  is_correct_niche: boolean
  website_status: 'weak' | 'good' | 'none' | 'unknown'
  site_issue_note: string
  quality_score: number
  low_fit: boolean
  pain_points: string
  personalization_notes: string
}

export interface PlaceForScoring {
  name: string
  address: string
  phone: string | null
  website: string | null
  rating: number | null
  reviews: Array<{ text: string; rating: number }>
  email: string | null
  websiteSignals: WebsiteResult | null
}

const OPENAI_API_BASE = 'https://api.openai.com/v1'

const SYSTEM_PROMPT = `You are a lead-qualification AI for a web design agency that sells premium website redesigns to US med spas and aesthetic clinics.

NICHE: Medical spas, aesthetic clinics, botox clinics, skin clinics in the United States only.
NOT our niche: gyms, yoga studios, dental offices, hair salons, nail salons, regular dermatologists, plastic surgeons (they typically have great websites already), chiropractors, tanning salons, massage parlours, spas without an aesthetic/medical focus.

OUR PRODUCT: A premium website redesign. We are NOT selling the idea of having a website — the business must already have one. We are selling an UPGRADE from a current bad/outdated site to a modern one.

WHAT WE WANT (ideal lead):
- Active med spa with solid Google reviews (real patients spending money, not brand-new)
- Has a website, but it is clearly WEAK: slow to load, not mobile-friendly, outdated design, or no online booking
- Small (1–3 locations) — the owner makes the decision, which means a faster close
- Reachable: has a verified email and/or direct phone number

WHAT TO SKIP:
- Business with no website — cannot sell an upgrade; mark website_status = 'none'
- Business with a great modern website (fast, mobile-friendly, has online booking) — nothing to sell; mark website_status = 'good'
- Wrong business type — mark is_correct_niche = false
- Too new / too few reviews — not yet a proven money-making business

WEBSITE STATUS RULES (set this based on the technical signals provided below):
- 'weak': Has a website WITH at least one clear problem (not mobile-friendly, no booking widget, slow, or dated design). THIS IS OUR IDEAL TARGET.
- 'good': Website is modern, mobile-friendly, and already has online booking. Skip — nothing to sell.
- 'none': No website URL provided. These go into a separate list; do not import as a CRM lead.
- 'unknown': Cannot determine from the available signals (e.g., website was unreachable).

SITE ISSUE NOTE (mandatory for weak websites):
Write ONE crisp sentence a setter can use to open the call — reference the SPECIFIC problem we detected.
Examples:
  "Site isn't mobile-friendly and has no way for patients to book online."
  "Website loaded very slowly and looks visually dated."
  "No online booking detected — patients would have to call."
  "No mobile viewport and copyright year suggests site hasn't been updated in years."
If website_status is NOT 'weak', set site_issue_note to "N/A".

QUALITY SCORE (1-10):
10 = Perfect: weak website, many reviews, verified email, small/local clinic.
7-9 = Strong: most criteria met, minor gaps.
4-6 = Marginal: missing something meaningful (no email, very few reviews, borderline niche).
1-3 = Poor: wrong niche, great website, barely any reviews, or not reachable at all.

PAIN POINTS:
Summarise real complaints or frustrations visible in the reviews. Focus on things that suggest a bad digital experience (hard to reach, no booking, slow service communications, etc.).
If there are fewer than 3 reviews OR the total review text is under 200 characters, set pain_points to exactly "insufficient data" — do NOT invent plausible-sounding issues.

PERSONALIZATION NOTES:
One or two short, specific hooks for cold outreach grounded ONLY in actual review content, the website URL, or business details provided. Do not fabricate.`

const OUTPUT_SCHEMA = {
  name: 'lead_score',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      is_correct_niche: {
        type: 'boolean',
        description: 'True only for med spas, medical spas, aesthetic/botox/skin clinics. False for everything else.',
      },
      website_status: {
        type: 'string',
        enum: ['weak', 'good', 'none', 'unknown'],
        description: 'Quality of the business website based on the technical signals provided.',
      },
      site_issue_note: {
        type: 'string',
        description: 'One sentence a setter uses to open the call. References the specific website problem. "N/A" if website_status is not weak.',
      },
      quality_score: {
        type: 'integer',
        description: 'ICP fit score 1-10. 10 = perfect med spa target.',
      },
      low_fit: {
        type: 'boolean',
        description: 'True if quality_score is below the configured threshold.',
      },
      pain_points: {
        type: 'string',
        description: 'Real complaints from reviews. "insufficient data" if reviews are thin.',
      },
      personalization_notes: {
        type: 'string',
        description: '1-2 specific outreach hooks grounded in actual data about this business.',
      },
    },
    required: ['is_correct_niche', 'website_status', 'site_issue_note', 'quality_score', 'low_fit', 'pain_points', 'personalization_notes'],
    additionalProperties: false,
  },
}

function buildUserPrompt(place: PlaceForScoring, qualityThreshold: number): string {
  const reviewCount = place.reviews.length
  const reviewText = place.reviews.map((r) => `[${r.rating}★] ${r.text}`).join('\n')
  const totalChars = reviewText.length

  const reviewSection = reviewCount > 0
    ? `Reviews (${reviewCount} shown):\n${reviewText}`
    : 'Reviews: none available.'

  const ws = place.websiteSignals
  let websiteSection: string
  if (!place.website) {
    websiteSection = 'Website: NONE — no website URL on Google Maps.'
  } else if (!ws || !ws.reachable) {
    websiteSection = `Website URL: ${place.website}\nWebsite reachability: UNREACHABLE (timed out or returned an error)`
  } else {
    const issues = ws.detectedIssues.length > 0
      ? ws.detectedIssues.map((i) => `  • ${i}`).join('\n')
      : '  • No major issues auto-detected.'
    websiteSection = `Website URL: ${place.website}
Website load time: ${ws.loadTimeMs}ms
Mobile viewport present: ${ws.hasMobileViewport ? 'YES' : 'NO'}
Online booking widget detected: ${ws.hasBookingWidget ? `YES (${ws.bookingPlatform})` : 'NO'}
Copyright year in HTML: ${ws.copyrightYear ?? 'not found'}
Auto-detected issues:
${issues}`
  }

  return `Score this business as a lead for a website redesign sale.

BUSINESS:
Name: ${place.name}
Address: ${place.address}
Phone: ${place.phone ?? 'N/A'}
Email found on website: ${place.email ?? 'none'}
Google Rating: ${place.rating ?? 'N/A'} (${reviewCount} reviews)

${websiteSection}

${reviewSection}

SCORING RULES — follow exactly:
1. is_correct_niche: true only for med spas / aesthetic / botox / skin clinics. false otherwise.
2. website_status: use the technical signals above. 'weak' = has problems. 'good' = modern + has booking. 'none' = no website. 'unknown' = unreachable.
3. site_issue_note: ONE sentence referencing the actual problem if website_status is 'weak'. Otherwise "N/A".
4. quality_score: integer 1-10 per rubric.
5. low_fit: true if quality_score < ${qualityThreshold}.
6. pain_points: real review complaints only. If reviews < 3 or total review text < 200 chars, MUST be exactly "insufficient data".
7. personalization_notes: 1-2 hooks, real data only, no fabrication.`
}

export async function scorePlace(
  place: PlaceForScoring,
  qualityThreshold: number,
  model: string,
  apiKey: string,
): Promise<{ score: AiScore; raw: unknown }> {
  const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(place, qualityThreshold) },
      ],
      response_format: { type: 'json_schema', json_schema: OUTPUT_SCHEMA },
      max_tokens: 600,
      temperature: 0.2,
    }),
  })

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)

  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  const score: AiScore = JSON.parse(content)

  // Clamp score to valid range (Structured Outputs enforces schema, not value ranges)
  score.quality_score = Math.max(1, Math.min(10, Math.round(score.quality_score)))
  score.low_fit = score.quality_score < qualityThreshold

  return { score, raw: data }
}
