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
  // The strongest sellable gap → the setter's opener. Set deterministically in scorePlace from the
  // website signals (not the model): 'none' means nothing to sell (a well-served business we skip).
  primary_angle?: 'first_website' | 'broken_site' | 'redesign' | 'lead_capture' | 'seo' | 'booking' | 'reputation' | 'none'
}

export interface PlaceForScoring {
  name: string
  address: string
  phone: string | null
  website: string | null
  rating: number | null
  reviewCount?: number | null // TOTAL Google review count (userRatingCount), for the reputation-vs-peers gap
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

WHAT WE SELL (several services — a business is a GOOD lead if it has AT LEAST ONE of these gaps):
- Website redesign — the current site is WEAK/outdated (slow, not mobile-friendly, dated design, free-builder subdomain).
- First website — the business has NO site at all.
- SEO — the site is poorly optimized / hard to find on Google (missing SEO basics, thin content, low site-health) EVEN IF it looks fine.
- Online-booking setup — the site has NO online scheduling EVEN IF it looks fine.
A business is a SKIP only when it has a strong, modern, well-optimized site that ALSO already has online booking — i.e. no gap left to sell. A good-LOOKING site is NOT automatically a skip: if it has weak SEO or no online booking, sell that instead.

WHAT WE WANT (ideal lead):
- Active med spa with solid Google reviews (real patients spending money, not brand-new)
- Has a website with at least one sellable gap: slow to load, not mobile-friendly, outdated design, weak SEO (hard to find on Google), or no online booking
- Small (1–3 locations) — the owner makes the decision, which means a faster close
- Reachable: has a verified email and/or direct phone number

SECOND PRODUCT — NO WEBSITE:
A business with NO website is NOT a skip — we sell those their FIRST website (a separate pitch). Mark website_status = 'none', but judge is_correct_niche purely on the business itself (name, Google business type, reviews). A med spa or aesthetics clinic with no website and real reviews is a GOOD lead. Never set is_correct_niche = false merely because there is no website or little website data.

WHAT TO SKIP:
- Business with a great modern website that is ALSO well-optimized for search AND already has online booking — no gap left to sell; mark website_status = 'good'. (A good-LOOKING site with weak SEO or no online booking is NOT a skip — sell the SEO or the booking.)
- Wrong business type — mark is_correct_niche = false (this field is ONLY about the business type, never about website presence or review count)
- Too new / too few reviews — not yet a proven money-making business; express this through a LOW quality_score, NOT through is_correct_niche

WEBSITE STATUS RULES (set this based on the technical signals provided below):
- 'weak': Has a website WITH at least one clear, CORROBORATED problem: not mobile-friendly, slow to load, or dated design (old copyright year, table-based layout). THIS IS OUR IDEAL TARGET.
- 'good': Website is modern and mobile-friendly. NOTE: 'good' describes the site's BUILD quality only — it does NOT by itself mean skip. If the site still has weak SEO or no online booking, it remains a sellable lead (SEO or booking pitch); only skip when it is well-optimized AND already has online booking.
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

SITE ISSUE NOTE (our MAIN sales hook — mandatory whenever there is a sellable gap):
Name the PRIMARY gap and tie it to a consequence the owner feels — the line a setter opens with. Choose by what the signals show:
- WEAK site: list EVERY corroborated problem (not mobile-friendly, slow load, old copyright, table layout, no email published, free-builder subdomain) — do not stop at one; separate with "; ".
- Good-looking site but WEAK SEO: lead with search visibility — e.g. "your site is missing the basics Google needs (no meta description / thin content), so patients searching for a clinic like yours never find you."
- Good site but NO online booking (only when 'CONFIRMED no online contact' is in the auto-detected issues): lead with that — e.g. "there's no way to book online, so every appointment ties up your front desk and you lose after-hours patients who won't call."
NEVER call a recent copyright year dated. If there is NO sellable gap at all, set site_issue_note to "N/A".

QUALITY SCORE (1-10) — LEAD FIT: how good a SALES TARGET this business is FOR US, NOT how nice the business is. We sell website redesign, first-website, SEO, and online-booking setup, so a business is a target when it has AT LEAST ONE sellable gap: a WEAK site, NO site, WEAK SEO, or NO online booking. A real business with NONE of those gaps (strong modern site + good SEO + online booking) is a BAD lead — nothing to sell.
Score using ONLY these tiers:
- 8-10: has ≥1 sellable gap (weak site / no site / weak SEO / no online booking) AND is reachable (email or phone). Ideal — start at 8; 9-10 when it also has plenty of reviews and is a single, owner-run location.
- 5-7: has a sellable gap but with a real drawback — no reachable contact at all, very few reviews, or a borderline niche.
- 4: has a gap but is a chain / multi-location (out of ICP).
- 1-3: NO sellable gap (strong modern site with good SEO AND online booking), OR wrong niche, OR could not assess ('unknown'). A polished, well-optimized clinic with online booking and 500 five-star reviews belongs HERE — a wonderful business, but nothing for us to sell.
Rule of thumb: if there is NO sellable gap, score 1-3. If there is a gap and the business is reachable, score 8+.

REVIEW INSIGHTS (pain_points field):
Google returns only ~5 reviews, so treat whatever is shown as your full evidence. UNLESS there are fewer than 3 reviews OR under 200 characters of review text in total, you MUST return a concrete, specific angle — never "insufficient data":
- If ANY review mentions friction — hard to book, no online booking, slow/no response, hard to reach, long waits, billing/scheduling/website problems — LEAD with that; it is the strongest hook, even if the other reviews are positive.
- Otherwise, state the recurring THEME clients praise, naming the specific provider/treatment/result (e.g. "clients repeatedly praise Dr. X's natural-looking Botox results and the welcoming staff").
- Ground every word in the actual review text; never invent complaints OR praise.
"insufficient data" is a LAST RESORT, allowed ONLY when there are genuinely fewer than 3 reviews or under 200 characters total. If reviews are present above that bar, returning "insufficient data" is a mistake.
FORMAT: if you have more than one distinct angle worth saying, output pain_points as a NUMBERED list, each on its own line ("1. …\n2. …"). If there is only one, output a single plain sentence with no number.

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
        // Niche-injected per call by outputSchema(); this default is the med-spa wording.
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

// The Structured-Outputs schema is the highest-salience niche signal the model sees (it's bound to
// the field it must emit). Left med-spa-hardcoded, gpt-4o-mini marks genuine non-med-spa businesses
// (e.g. real dentists with good sites) is_correct_niche=false — a false-negative that would drop
// weak-site leads for any new niche. Inject the tenant's niche into the description so it matches the
// system-prompt override. Med spa / no niche → the EXACT original wording (byte-for-byte unchanged).
function outputSchema(niche?: { label: string; prompt: string | null }) {
  if (!niche || niche.label === 'Med Spa') return OUTPUT_SCHEMA
  return {
    ...OUTPUT_SCHEMA,
    schema: {
      ...OUTPUT_SCHEMA.schema,
      properties: {
        ...OUTPUT_SCHEMA.schema.properties,
        is_correct_niche: {
          type: 'boolean',
          description: `True only if the business genuinely is a ${niche.label} (per the niche defined in the system prompt). False for any other business type. NEVER false merely because the website is missing or the data is thin.`,
        },
      },
    },
  }
}

function buildUserPrompt(place: PlaceForScoring, qualityThreshold: number, niche?: { label: string; prompt: string | null }, gapHint?: string): string {
  // Niche-aware wording for rule 1; med spa keeps its exact original phrasing.
  const nicheIsOther = !!niche && niche.label !== 'Med Spa'
  const rule1Niche = nicheIsOther
    ? `true only if the business genuinely is a ${niche.label}, false for other business types`
    : 'true for med spas / aesthetic / botox / skin clinics, false for other business types'
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
Site health score: ${ws.seoScore != null ? `${ws.seoScore}/100 (from verified signals)` : 'not scored (unverifiable page)'}
Platform: ${ws.techStack ?? 'not detected'}
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

  const gapLine = gapHint && gapHint.length
    ? `SELLABLE GAPS DETECTED (deterministic, from the signals above): ${gapHint}. Write site_issue_note as the pitch for the STRONGEST of these.`
    : 'SELLABLE GAPS DETECTED: none from the automated signals — if website_status is not weak/none, there may be nothing to sell (set site_issue_note to N/A).'

  return `Score this business as a lead for our services (website redesign, first website, SEO, or online-booking setup).

BUSINESS:
Name: ${place.name}
Address: ${place.address}
Phone: ${place.phone ?? 'N/A'}
Email found on website: ${place.email ?? 'none'}
Google business type: ${place.businessType || 'not provided'}
Google Rating: ${place.rating ?? 'N/A'} (showing ${reviewCount} most relevant reviews — the business may have many more)

${websiteSection}

${gapLine}

${reviewSection}

SCORING RULES — follow exactly:
1. is_correct_niche: judge ONLY the business type (name, Google business type, reviews): ${rule1Niche}. NEVER false because the website is missing ('none' is a sellable first-website lead) or because data is thin.
2. website_status: use the technical signals above. 'weak' = has a CORROBORATED problem (mobile/slow/dated). 'good' = modern + has booking. 'none' = no website. 'unknown' = could not fetch. Missing-booking alone is NOT enough to call 'weak' — the scanner misses JS booking widgets. Do not penalize quality_score for 'unknown'/unreachable.
3. status_reason: ONE short factual line explaining the website_status you chose — required for EVERY status (good/weak/unknown/none), per the STATUS REASON rules.
4. site_issue_note: our main sales hook — ONE sentence naming the corroborated problem AND its business consequence, if website_status is 'weak'. Otherwise "N/A".
5. quality_score: integer 1-10 = LEAD FIT (how good a target FOR US). Only 'weak' sites score above 3; good/none/unknown/wrong-niche → 1-3. Chains capped at 4. (A low score for 'none' does NOT mean wrong niche — no-website med spas are still imported for the first-website pitch via is_correct_niche=true.)
6. low_fit: true if quality_score < ${qualityThreshold}, or if the business is a chain / multi-location.
7. pain_points: all sellable angles from reviews — real complaints/friction first (esp. digital), else the recurring theme clients praise (name the specific provider/treatment/result). If more than one angle, output a NUMBERED list, one per line ("1. …\n2. …"); if only one, a plain sentence. Only "insufficient data" if reviews < 3 or total review text < 200 chars. Never fabricate.
8. personalization_notes: 1-2 hooks, real data only, no fabrication.`
}

// The three lines of SYSTEM_PROMPT that hard-code the med-spa niche. For any other vertical these
// actively CONTRADICT the niche override — e.g. the NOT-our-niche line literally lists "dental
// offices", and the Google-type line says `dentist` supports is_correct_niche=FALSE. gpt-4o-mini
// (and even the escalation model) obey these in-body exclusions over a prepended override, so a real
// dentist scores is_correct_niche=false and its weak-site lead is silently dropped. We swap these
// three lines per niche; everything else (the whole quality/scoring rubric) is niche-agnostic.
const MEDSPA_NICHE_LINE = 'NICHE: Medical spas, aesthetic clinics, botox clinics, skin clinics in the United States and Canada.'
const MEDSPA_NOTNICHE_LINE = 'NOT our niche: gyms, yoga studios, dental offices, hair salons, nail salons, regular dermatologists, plastic surgeons (they typically have great websites already), chiropractors, tanning salons, massage parlours, spas without an aesthetic/medical focus.'
const MEDSPA_TYPE_LINE = 'types like medical_spa / skin_care_clinic / aesthetics strongly support true; hair_salon / dentist / gym strongly support false. Ambiguous types (spa, beauty_salon, doctor) — judge from the name, reviews and website instead.'

// Per-niche replacements for those three lines. Add an entry when a vertical is calibrated; unknown
// verticals fall back to generic label-based text.
const NICHE_TUNING: Record<string, { nicheLine: string; notNicheLine: string; typeLine: string }> = {
  'Dental Clinic': {
    nicheLine: 'NICHE: Dental practices — general, cosmetic, family, pediatric, and orthodontic dental offices — in the United States and Canada.',
    notNicheLine: 'NOT our niche: any business that is not a dental/orthodontic practice — e.g. med spas, gyms, hair/nail salons, pharmacies, veterinary clinics, chiropractors, physical therapists. A dental or orthodontic practice IS our niche.',
    typeLine: 'types like dentist / dental_clinic strongly support true; med_spa / hair_salon / nail_salon / gym / pharmacy / veterinary_care strongly support false. Ambiguous types (doctor, medical_clinic) — judge from the name, reviews and website instead.',
  },
}
function nicheTuning(label: string): { nicheLine: string; notNicheLine: string; typeLine: string } {
  return NICHE_TUNING[label] ?? {
    nicheLine: `NICHE: ${label} businesses in the United States and Canada.`,
    notNicheLine: `NOT our niche: any business that is not a ${label}. Judge is_correct_niche purely on whether the business genuinely is a ${label}.`,
    typeLine: `the Google business type that matches a ${label} strongly supports true; clearly unrelated business types strongly support false. Ambiguous types — judge from the name, reviews and website instead.`,
  }
}

// Build the system prompt for a niche. Med spa / no niche → the exact original SYSTEM_PROMPT
// (byte-for-byte unchanged). Any other niche → the three med-spa lines swapped for the niche's, plus
// a short override preamble that re-points the (still med-spa-worded) worked examples.
function systemPrompt(niche?: { label: string; prompt: string | null }): string {
  if (!niche || niche.label === 'Med Spa') return SYSTEM_PROMPT
  const t = nicheTuning(niche.label)
  const body = SYSTEM_PROMPT
    .replace(MEDSPA_NICHE_LINE, t.nicheLine)
    .replace(MEDSPA_NOTNICHE_LINE, t.notNicheLine)
    .replace(MEDSPA_TYPE_LINE, t.typeLine)
  const preamble = `NICHE OVERRIDE — READ FIRST: You are qualifying leads for "${niche.label}" businesses, NOT med spas. ${niche.prompt ?? ''} Apply the SAME website-quality and lead-scoring logic to "${niche.label}" businesses. is_correct_niche = true means the business genuinely IS a ${niche.label}; any other business type is the wrong niche. The worked examples below use med-spa businesses only to illustrate the SCORING pattern — the niche is "${niche.label}".`
  return `${preamble}\n\n${body}`
}

async function callScoringModel(
  useModel: string,
  userPrompt: string,
  apiKey: string,
  niche?: { label: string; prompt: string | null },
): Promise<{ score: AiScore; data: unknown }> {
  const systemContent = systemPrompt(niche)
  const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: useModel,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_schema', json_schema: outputSchema(niche) },
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
  niche?: { label: string; prompt: string | null },
  peerMedianReviews?: number,
): Promise<{ score: AiScore; raw: unknown }> {
  // ---- Sellable-gap detection (deterministic, from the website signals — the authoritative gate) ----
  // Computed BEFORE scoring so the model writes site_issue_note for the real gap; finalized AFTER
  // (weak-site needs the model's website_status). Only SEO/booking gaps that we could actually verify
  // count — a JS-shell / unreachable page has seoScore null and never trips a false gap.
  const ws = place.websiteSignals
  const noWebsite = !place.website
  const brokenSite = !!ws && ws.siteBroken
  const verifiable = !!ws && ws.seoScore != null // we could actually READ the page (not a JS shell / render fallback)
  const seoGap = verifiable && (ws!.seoScore! < 60 || ws!.detectedIssues.some((i) => /Missing SEO basics/i.test(i)))
  const noOnsiteCapture = verifiable && !ws!.hasBookingWidget // no form / booking / CTA / contact link on a readable page
  const leadCaptureGap = noOnsiteCapture && !place.email       // phone-only: nothing to capture a lead online
  const bookingGap = noOnsiteCapture && !!place.email          // has email but no scheduling/form
  const templated = !!ws?.templatedVendor                     // cookie-cutter niche-vendor template → redesign/brand pitch
  const peerMed = peerMedianReviews ?? null
  const reputationGap = place.reviewCount != null && peerMed != null && peerMed >= 25 && place.reviewCount < Math.round(0.35 * peerMed)
  const chatGap = verifiable && !ws!.hasChat                   // secondary upsell tag only, never a primary qualifier
  const gapHint = [
    noWebsite ? 'NO website (first-website pitch)' : '',
    brokenSite ? 'BROKEN/parked site — no real site behind the domain (full-rebuild pitch)' : '',
    leadCaptureGap ? 'NO online lead capture — phone-only, no form/booking/email (lead-capture pitch)' : '',
    seoGap ? `WEAK SEO — site-health ${ws?.seoScore}/100 / missing SEO basics (search-visibility pitch)` : '',
    bookingGap ? 'NO online booking on a readable site (booking-setup pitch)' : '',
    templated ? `TEMPLATED vendor site (${ws?.templatedVendor}) — generic cookie-cutter template (redesign/brand pitch)` : '',
    reputationGap ? `THIN reputation — ${place.reviewCount} reviews vs local median ~${peerMed} (review-generation pitch)` : '',
  ].filter(Boolean).join('; ')

  const userPrompt = buildUserPrompt(place, qualityThreshold, niche, gapHint)

  let { score, data } = await callScoringModel(model, userPrompt, apiKey, niche)

  // Escalation: borderline scores (5-7) and low-confidence calls get one pass with the full model.
  // These are the genuinely hard calls; the mini model handles the clear-cut majority.
  const borderline = score.quality_score >= 5 && score.quality_score <= 7
  if ((borderline || score.confidence === 'low') && model !== ESCALATION_MODEL) {
    const firstPass = { model, quality_score: score.quality_score, website_status: score.website_status, confidence: score.confidence }
    try {
      const second = await callScoringModel(ESCALATION_MODEL, userPrompt, apiKey, niche)
      score = second.score
      data = { escalated: true, first_pass: firstPass, response: second.data }
      console.log(`[scorePlace] escalated to ${ESCALATION_MODEL} (${place.name}): q${firstPass.quality_score}/${firstPass.confidence} -> q${score.quality_score}/${score.confidence}`)
    } catch (e) {
      console.error(`[scorePlace] escalation failed, keeping ${model} result:`, (e as Error).message)
    }
  }

  // Clamp score to valid range (Structured Outputs enforces schema, not value ranges)
  score.quality_score = Math.max(1, Math.min(10, Math.round(score.quality_score)))

  // ---- Finalize the sellable gap → primary_angle (the authoritative, auditable qualification) ----
  // Priority: no site (first website) > bad BUILD (redesign) > weak SEO > no booking > nothing.
  // "redesign" is reserved for genuine build/design problems (not-mobile / slow / dated / free-builder /
  // no-SSL), computed deterministically — so an otherwise-fine site with only an SEO or booking gap
  // gets the accurate pitch label instead of being lumped into "redesign".
  const cy = new Date().getFullYear()
  const buildWeak = !!ws && ws.seoScore != null && (
    !ws.hasMobileViewport ||
    ws.loadTimeMs > 3500 ||
    (ws.copyrightYear != null && ws.copyrightYear <= cy - 3) ||
    ws.detectedIssues.some((i) => /no ssl certificate|auto-generated\/template|free[, ].*(subdomain|auto-generated)|table-based page layout/i.test(i))
  )
  const angle: NonNullable<AiScore['primary_angle']> =
    noWebsite ? 'first_website'
    : brokenSite ? 'broken_site'
    : buildWeak ? 'redesign'
    : leadCaptureGap ? 'lead_capture'
    : seoGap ? 'seo'
    : bookingGap ? 'booking'
    : templated ? 'redesign'                         // cookie-cutter vendor template → custom-redesign / brand pitch
    : reputationGap ? 'reputation'
    : score.website_status === 'weak' ? 'redesign'   // model saw a weakness we couldn't classify (e.g. via the render fallback)
    : 'none'
  score.primary_angle = angle

  // Lead-fit is driven by the presence of a sellable gap, not the old weak-website-only rubric.
  // No gap → capped to 3 (nothing to sell). A real gap → floored so the model's stale weak-only
  // scoring can't bury a genuine SEO/booking prospect below the import threshold.
  const chainSignals = place.websiteSignals?.chainSignals ?? []
  const reachable = !!(place.phone || place.email)
  if (angle === 'none') {
    score.quality_score = Math.min(score.quality_score, 3)
  } else if (reachable) {
    score.quality_score = Math.max(score.quality_score, 8)
  } else {
    score.quality_score = Math.min(Math.max(score.quality_score, 5), 7)
  }
  // Chains / multi-location are out of ICP no matter the gap — cap wins over the floor.
  if (chainSignals.length > 0) score.quality_score = Math.min(score.quality_score, 4)

  score.low_fit = angle === 'none' || score.quality_score < qualityThreshold || chainSignals.length > 0

  // Guarantee a pitch for every sellable lead. The model often returns site_issue_note = "N/A" for a
  // good-LOOKING site that nonetheless tripped a deterministic SEO/booking/build gap — leaving the
  // setter with no hook. Synthesize the opener from the concrete signals when that happens.
  const noNote = !score.site_issue_note || /^n\/?a\.?$/i.test(score.site_issue_note.trim()) || /^insufficient/i.test(score.site_issue_note.trim())
  const who = /dental|med spa|clinic|spa|chiro|physio|vet|health/i.test(niche?.label ?? 'Med Spa') ? 'patients' : 'clients'
  const oneWho = who.replace(/s$/, '')
  // Reputation always authored here (only we have the peer median) and led with the RANKING
  // consequence — lost patients, not vanity. Everything else only when the model returned N/A.
  if (angle === 'reputation' || (noNote && angle !== 'none' && angle !== 'first_website')) {
    if (angle === 'broken_site') {
      score.site_issue_note = `Your website is a parked/placeholder page right now — anyone who looks you up online finds no real site, so you're invisible to ${who} searching for you and losing them to competitors.`
    } else if (angle === 'lead_capture') {
      score.site_issue_note = `There's no way to reach you online — no contact form, booking, or email on the site — so every prospective ${oneWho} has to phone you, and the ones who won't just go elsewhere.`
    } else if (angle === 'reputation') {
      score.site_issue_note = `You have ${place.reviewCount ?? 'few'} Google reviews while the top ${niche?.label ?? 'businesses'} near you average ~${peerMed ?? 'many more'} — and because review count is one of the biggest Google Maps ranking factors, you're showing up below them in local search, so the new ${who} searching right now are booking with them instead of you.`
    } else if (angle === 'seo') {
      const bits: string[] = []
      if (ws?.detectedIssues.some((i) => /Missing SEO basics/i.test(i))) bits.push('missing key SEO basics')
      if (ws?.seoScore != null) bits.push(`site-health only ${ws.seoScore}/100`)
      score.site_issue_note = `Your website isn't built to be found on Google${bits.length ? ` (${bits.join(', ')})` : ''} — ${who} searching for a ${niche?.label ?? 'business'} like yours land on competitors instead of you.`
    } else if (angle === 'booking') {
      score.site_issue_note = `There's no way to book online on your site, so every appointment ties up your front desk and you lose after-hours ${who} who won't call.`
    } else { // redesign
      const probs = (ws?.detectedIssues ?? []).filter((i) => /mobile|slow|copyright|table-based|No SSL|free[, ]/i.test(i)).slice(0, 2)
      score.site_issue_note = probs.length
        ? probs.join('; ')
        : ws?.templatedVendor
          ? `Your site is a stock ${ws.templatedVendor} template used by hundreds of other practices — it looks like everyone else's, so nothing sets you apart; a custom design would stand out and convert more ${who}.`
          : `Your website's build is dated and holding you back with prospective ${who}.`
    }
    if (score.website_status === 'good') score.status_reason = `Site looks modern but has a sellable "${angle}" gap.`
  }

  // Secondary upsell: no live-chat / AI chatbot (never the reason we import — appended to the notes
  // so the setter can raise it once the lead already qualifies on something real).
  if (chatGap && angle !== 'none') {
    const chatNote = 'Upsell: no live-chat/AI chatbot on the site — a 24/7 chatbot would capture visitors who arrive after hours.'
    score.personalization_notes = score.personalization_notes && !/insufficient/i.test(score.personalization_notes)
      ? `${score.personalization_notes} ${chatNote}` : chatNote
  }

  return { score, raw: data }
}
