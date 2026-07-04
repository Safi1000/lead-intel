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
  status_reason: string
  site_issue_note: string
  quality_score: number
  low_fit: boolean
  confidence: 'high' | 'low'
  pain_points: string
  personalization_notes: string
}

export interface PlaceForScoring {
  name: string
  address: string
  phone: string | null
  website: string | null
  rating: number | null
  businessType?: string | null // Google Places primaryType, e.g. "medical_spa", "beauty_salon"
  reviews: Array<{ text: string; rating: number }>
  email: string | null
  websiteSignals: WebsiteResult | null
}

const OPENAI_API_BASE = 'https://api.openai.com/v1'
// Borderline / low-confidence leads get a second pass with a stronger model — pay for the better
// brain only on the leads that are genuinely hard to call (~7% measured). gpt-4.1-mini is ~6x
// cheaper than legacy-priced gpt-4o and sits between 4o-mini and 4o in quality. If the model name
// ever 404s, the escalation try/catch keeps the first-pass result — graceful fallback.
const ESCALATION_MODEL = 'gpt-4.1-mini'

const SYSTEM_PROMPT = `You are a lead-qualification AI for a web design agency that sells premium website redesigns to US med spas and aesthetic clinics.

NICHE: Medical spas, aesthetic clinics, botox clinics, skin clinics in the United States and Canada.
NOT our niche: gyms, yoga studios, dental offices, hair salons, nail salons, regular dermatologists, plastic surgeons (they typically have great websites already), chiropractors, tanning salons, massage parlours, spas without an aesthetic/medical focus.
The data may include a "Google business type" — Google's own classification of this business. Treat it as STRONG evidence for is_correct_niche: types like medical_spa / skin_care_clinic / aesthetics strongly support true; hair_salon / dentist / gym strongly support false. Ambiguous types (spa, beauty_salon, doctor) — judge from the name, reviews and website instead.
The data may also include a "Page text excerpt" — the site's actual visible wording. Use it as primary evidence for the niche (what services they really offer) and to sharpen hooks: quoting or referencing the clinic's own copy in site_issue_note / personalization_notes is far more persuasive than generic phrasing. Its absence is NOT a weakness.

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
- 'weak': Has a website WITH at least one clear, CORROBORATED problem: not mobile-friendly, slow to load, or dated design (old copyright year, table-based layout). THIS IS OUR IDEAL TARGET.
- 'good': Website is modern, mobile-friendly, and already has online booking. Skip — nothing to sell.
- 'none': No website URL provided. These go into a separate list; do not import as a CRM lead.
- 'unknown': The site could not be fetched (timeout, bot-challenge, or geo-block). This is OFTEN a false negative for slow-but-real sites — do not lower quality_score for unreachability alone.

BOOKING / CONTACT SIGNAL — READ CAREFULLY:
A CONTACT FORM, an appointment/contact page, or a "schedule / contact us" button all count as a way to reach the clinic — those are NOT a weakness. Our scanner also misses booking that JavaScript injects. Therefore:
- Do NOT invent "no online booking" as a weakness. Rely ONLY on the Auto-detected issues listed in the data.
- EXCEPTION: if an issue explicitly begins with "CONFIRMED no online contact" (a readable homepage with no form, booking widget, or contact page at all), THAT is a genuine weakness — patients can only phone in. Use it.
- If an issue says the content is JavaScript-rendered / could not be verified, treat mobile, booking, SEO and social as UNKNOWN — never claim they are missing.
The real, corroborated weaknesses are ONLY these: not mobile-friendly, slow load (>3.5s), OLD copyright (3+ years behind the current year), table layout, no email published, NO SSL (loads over http / "not secure"), missing SEO basics (title/description/H1), no Instagram/Facebook link, a FREE website-builder subdomain (auto-generated/template site — a real weakness), and "CONFIRMED no online contact".
A DIY builder on a CUSTOM domain (Wix, Squarespace, GoDaddy, Weebly) is NOT automatically a weakness — mention it in site_issue_note as a useful pitch angle ("you're on a template builder — a custom site would set you apart") but do not, by itself, make the site 'weak'.

COPYRIGHT YEAR — do not misread it:
A current or recent copyright year is GOOD (the site is maintained) — it is NEVER a weakness. Only a copyright year several years old (roughly 3+ years behind the current year) indicates neglect. Never describe a current-year copyright as "dated" or "lacking updates".

CHAINS / MULTI-LOCATION (HARD RULE — overrides the quality rubric):
We sell ONLY to owner-operated clinics (1–3 locations) where the owner makes the buying decision. Read the "Chain / multi-location signals" line in the data below. If it is anything OTHER than "none detected", the business is a chain / multi-location and is OUT OF ICP: you MUST set low_fit = true and quality_score to 4 or lower — no matter how good the website, reviews, or rating are. A polished chain site is still a bad lead; do not score it above 4.

STATUS REASON (status_reason field — fill for EVERY status, one short factual line):
Explain plainly why you chose the website_status, so the team understands the call:
- 'good': what makes it good — e.g. "Modern, mobile-friendly site with Boulevard online booking — nothing to upgrade."
- 'weak': the concrete problem(s) — e.g. "Loads in ~6s and the copyright is from 2018; the design looks dated."
- 'unknown': why it couldn't be assessed — e.g. "Site didn't respond to our scan (timeout or bot-block) — needs a manual look."
- 'none': "No website listed on Google Maps."

SITE ISSUE NOTE (our MAIN sales hook — mandatory for WEAK websites):
List EVERY corroborated problem from the Auto-detected issues (there may be several) — do not stop at one. Write it as the line a setter opens with: name each specific problem and tie it to a consequence the owner feels. Separate multiple problems with "; ". Use ONLY corroborated issues (not mobile-friendly, slow load, old copyright, table layout, no email published). NEVER include "no online booking" and NEVER call a recent copyright year dated.
Examples:
  "Your site isn't mobile-friendly, so phone visitors hit a broken layout; it also loads slowly, and there's no email address anywhere for patients to reach you."
  "The copyright reads 2018 and the layout is dated — it looks neglected next to newer spas nearby."
If website_status is NOT 'weak', set site_issue_note to "N/A".

QUALITY SCORE (1-10) — this is LEAD FIT: "how good a SALES TARGET is this business FOR US", NOT how nice the business or its website is. We sell website REDESIGNS, so a business is only a target when its website is WEAK (something to upgrade). A great business with a great website is a BAD lead for us.
Score using ONLY these tiers:
- 8-10: WEAK website AND reachable (has an email or a phone). This is our ideal target — start at 8; go to 9-10 when it also has plenty of reviews and is a single, owner-run location.
- 5-7: WEAK website but with a real gap — no reachable contact at all, very few reviews, or a borderline niche.
- 4: WEAK website but a chain / multi-location (out of ICP).
- 1-3: NOT a target for us — website is already 'good' (nothing to sell), OR 'none' (no site), OR 'unknown' (couldn't assess), OR wrong niche. A polished med spa with a modern site and 500 five-star reviews belongs HERE — a wonderful business, but a 1-3 LEAD, because we have nothing to sell it.
Rule of thumb: if website_status is NOT 'weak', the score is 1-3, full stop. If it IS 'weak' and reachable, it is 8+.

REVIEW INSIGHTS (pain_points field):
Google returns only ~5 reviews, so treat whatever is shown as your full evidence. UNLESS there are fewer than 3 reviews OR under 200 characters of review text in total, you MUST return a concrete, specific angle — never "insufficient data":
- If ANY review mentions friction — hard to book, no online booking, slow/no response, hard to reach, long waits, billing/scheduling/website problems — LEAD with that; it is the strongest hook, even if the other reviews are positive.
- Otherwise, state the recurring THEME clients praise, naming the specific provider/treatment/result (e.g. "clients repeatedly praise Dr. X's natural-looking Botox results and the welcoming staff").
- Ground every word in the actual review text; never invent complaints OR praise.
"insufficient data" is a LAST RESORT, allowed ONLY when there are genuinely fewer than 3 reviews or under 200 characters total. If reviews are present above that bar, returning "insufficient data" is a mistake.

PERSONALIZATION NOTES:
One or two short, specific hooks for cold outreach grounded ONLY in actual review content, the website URL, or business details provided. Do not fabricate.

CONFIDENCE:
Set confidence = 'low' when the evidence is genuinely thin or conflicting: the site was unreachable or JavaScript-rendered (couldn't verify signals), the niche is ambiguous (mixed services, unclear type), or signals contradict each other. Otherwise 'high'. Be honest — low-confidence answers get a second look, so flagging uncertainty helps.

WORKED EXAMPLES (calibrate to these):
Example 1 — modern site, real business, nothing to sell:
Input: med spa, type medical_spa, 4.9★, Boulevard booking detected, mobile YES, fast load, no issues; reviews praise Irena's Botox results.
Output: is_correct_niche=true, website_status='good', status_reason="Modern mobile site with Boulevard online booking — nothing to upgrade.", site_issue_note="N/A", quality_score=2, low_fit=true, confidence='high', pain_points="Clients repeatedly praise Irena's natural-looking Botox results and warm consultations.", personalization_notes="Reference Irena's reputation for natural results — reviewers mention her by name."

Example 2 — the ideal target (weak + reachable):
Input: med spa, type skin_care_clinic, 4.8★, reachable (phone + info@ email); auto-detected: copyright 2019 (7 years old), no email published, built on Squarespace; a review says "hard to get hold of them to book".
Output: is_correct_niche=true, website_status='weak', status_reason="Copyright 2019 and no published contact email — the site looks unmaintained.", site_issue_note="Your site's copyright still says 2019 so it reads as neglected next to newer spas, and there's no email on it — patients who won't call have no way to reach you; it's also a stock Squarespace template a custom design would outclass.", quality_score=9, low_fit=false, confidence='high', pain_points="A reviewer says it's hard to reach the clinic to book — direct friction our redesign (clear contact + booking) fixes; others praise the resurfacing results.", personalization_notes="Open with the reviewer complaint about reaching them; praise for their laser resurfacing gives a warm angle."

Example 3 — polished chain, out of ICP:
Input: aesthetic clinic, 4.7★, modern site with Zenoti booking, BUT chain signals: URL is /locations/seattle, "Book at" 3 cities.
Output: is_correct_niche=true, website_status='good', status_reason="Modern multi-location site with Zenoti booking.", site_issue_note="N/A", quality_score=4, low_fit=true, confidence='high', pain_points="Reviews praise consistent results across visits.", personalization_notes="Multi-location chain — corporate decision-making; deprioritize."`

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
      status_reason: {
        type: 'string',
        description: 'One short factual line explaining WHY this website_status was chosen — for EVERY status (good = what makes it modern/why nothing to sell; weak = the specific problem; unknown = why it could not be assessed; none = no website).',
      },
      site_issue_note: {
        type: 'string',
        description: 'The setter\'s opening line for WEAK sites: names the specific problem AND its business consequence. "N/A" if website_status is not weak.',
      },
      quality_score: {
        type: 'integer',
        description: 'LEAD FIT 1-10 (how good a sales target FOR US, not how nice the business is). Only weak-website leads score high; good/none/unknown/wrong-niche score 1-3.',
      },
      low_fit: {
        type: 'boolean',
        description: 'True if quality_score is below the configured threshold.',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'low'],
        description: "'low' when evidence is thin/conflicting (unreachable or JS-rendered site, ambiguous niche, contradictory signals); otherwise 'high'.",
      },
      pain_points: {
        type: 'string',
        description: 'Best outreach angle from reviews: real complaints/friction if any, otherwise the recurring theme clients praise (specific provider/treatment/result). "insufficient data" only if reviews < 3 or total text < 200 chars.',
      },
      personalization_notes: {
        type: 'string',
        description: '1-2 specific outreach hooks grounded in actual data about this business.',
      },
    },
    required: ['is_correct_niche', 'website_status', 'status_reason', 'site_issue_note', 'quality_score', 'low_fit', 'confidence', 'pain_points', 'personalization_notes'],
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
Chain / multi-location signals: ${ws.chainSignals.length > 0 ? ws.chainSignals.join('; ') : 'none detected (looks single-site)'}
Auto-detected issues:
${issues}${ws.visibleTextExcerpt ? `
Page text excerpt (the site's own visible wording):
"""${ws.visibleTextExcerpt}"""` : ''}`
  }

  return `Score this business as a lead for a website redesign sale.

BUSINESS:
Name: ${place.name}
Address: ${place.address}
Phone: ${place.phone ?? 'N/A'}
Email found on website: ${place.email ?? 'none'}
Google business type: ${place.businessType || 'not provided'}
Google Rating: ${place.rating ?? 'N/A'} (showing ${reviewCount} most relevant reviews — the business may have many more)

${websiteSection}

${reviewSection}

SCORING RULES — follow exactly:
1. is_correct_niche: true only for med spas / aesthetic / botox / skin clinics. false otherwise.
2. website_status: use the technical signals above. 'weak' = has a CORROBORATED problem (mobile/slow/dated). 'good' = modern + has booking. 'none' = no website. 'unknown' = could not fetch. Missing-booking alone is NOT enough to call 'weak' — the scanner misses JS booking widgets. Do not penalize quality_score for 'unknown'/unreachable.
3. status_reason: ONE short factual line explaining the website_status you chose — required for EVERY status (good/weak/unknown/none), per the STATUS REASON rules.
4. site_issue_note: our main sales hook — ONE sentence naming the corroborated problem AND its business consequence, if website_status is 'weak'. Otherwise "N/A".
5. quality_score: integer 1-10 = LEAD FIT (how good a target FOR US). Only 'weak' sites score above 3; good/none/unknown/wrong-niche → 1-3. Chains capped at 4.
6. low_fit: true if quality_score < ${qualityThreshold}, or if the business is a chain / multi-location.
7. pain_points: best outreach angle from reviews — real complaints/friction first (esp. digital), else the recurring theme clients praise (name the specific provider/treatment/result). Only "insufficient data" if reviews < 3 or total review text < 200 chars. Never fabricate.
8. personalization_notes: 1-2 hooks, real data only, no fabrication.`
}

async function callScoringModel(
  useModel: string,
  userPrompt: string,
  apiKey: string,
): Promise<{ score: AiScore; data: unknown }> {
  const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: useModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_schema', json_schema: OUTPUT_SCHEMA },
      max_tokens: 600,
      temperature: 0.2,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const score: AiScore = JSON.parse(data?.choices?.[0]?.message?.content ?? '')
  return { score, data }
}

export async function scorePlace(
  place: PlaceForScoring,
  qualityThreshold: number,
  model: string,
  apiKey: string,
): Promise<{ score: AiScore; raw: unknown }> {
  const userPrompt = buildUserPrompt(place, qualityThreshold)

  let { score, data } = await callScoringModel(model, userPrompt, apiKey)

  // Escalation: borderline scores (5-7) and low-confidence calls get one pass with the full model.
  // These are the genuinely hard calls; the mini model handles the clear-cut majority.
  const borderline = score.quality_score >= 5 && score.quality_score <= 7
  if ((borderline || score.confidence === 'low') && model !== ESCALATION_MODEL) {
    const firstPass = { model, quality_score: score.quality_score, website_status: score.website_status, confidence: score.confidence }
    try {
      const second = await callScoringModel(ESCALATION_MODEL, userPrompt, apiKey)
      score = second.score
      data = { escalated: true, first_pass: firstPass, response: second.data }
      console.log(`[scorePlace] escalated to ${ESCALATION_MODEL} (${place.name}): q${firstPass.quality_score}/${firstPass.confidence} -> q${score.quality_score}/${score.confidence}`)
    } catch (e) {
      console.error(`[scorePlace] escalation failed, keeping ${model} result:`, (e as Error).message)
    }
  }

  // Clamp score to valid range (Structured Outputs enforces schema, not value ranges)
  score.quality_score = Math.max(1, Math.min(10, Math.round(score.quality_score)))

  // Lead-fit cap. quality_score means "how good a SALES TARGET is this for us", not "how nice is
  // this business". We sell redesigns, so only a WEAK website is sellable — good/none/unknown sites
  // can never rank above 3. Enforced in code because gpt-4o-mini keeps scoring polished non-weak
  // sites 8–10, which would bury the real prospects when the list is sorted by quality_score.
  if (score.website_status !== 'weak') {
    score.quality_score = Math.min(score.quality_score, 3)
  }

  // Deterministic chain cap. Chains / multi-location are out of ICP no matter how polished.
  const chainSignals = place.websiteSignals?.chainSignals ?? []
  if (chainSignals.length > 0) {
    score.quality_score = Math.min(score.quality_score, 4)
  }

  score.low_fit = score.quality_score < qualityThreshold || chainSignals.length > 0

  return { score, raw: data }
}
