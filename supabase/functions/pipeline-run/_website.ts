/**
 * Website analysis for the med spa lead pipeline.
 * Single pass over the business website to:
 *   1. Extract a contact email (mailto: first, regex fallback)
 *   2. Detect website quality signals: mobile viewport, booking widget, load speed, design age
 * All signals are returned as structured data and passed verbatim to the AI scorer.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebsiteResult {
  // Email
  email: string | null
  emailSource: 'mailto' | 'text_match' | 'none'
  emailConfidence: 'high' | 'low' | 'none'
  // Website quality signals
  reachable: boolean
  loadTimeMs: number
  hasMobileViewport: boolean
  hasBookingWidget: boolean
  bookingPlatform: string | null
  copyrightYear: number | null
  detectedIssues: string[] // human-readable sentences, pasted into the AI prompt
  chainSignals: string[] // multi-location / chain evidence, pasted into the AI prompt (empty = looks single-site)
  visibleTextExcerpt: string | null // first ~1200 chars of the page's readable text — grounds the AI's niche call and lets hooks quote the site's own wording
  seoScore: number | null // 0-100 site-health score from verified signals; null when unverifiable (JS shell / render fallback)
  techStack: string | null // detected platform/builder ("WordPress (theme: x)", "Shopify", "Wix", ...)
  emailMxOk: boolean | null // MX record exists for the found email's domain (null = no email / not checked)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PAGES = 3
// Med spa sites are heavy (hero video, tracking, chat widgets) and routinely take
// 5–17s to fully respond. A 4s cap produced false "unreachable" → 'unknown' → lost
// leads. Ground-truth run (2026-07-02): 5/6 'unknown' leads were live at 5–17s.
const FETCH_TIMEOUT_MS = 12000

const ROLE_PREFIXES = ['info', 'contact', 'sales', 'hello', 'support', 'admin', 'enquiries', 'enquiry', 'office', 'mail', 'booking', 'appointments']
const DISCARD_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'bounce', 'mailer-daemon', 'postmaster', 'unsubscribe']
// Small med spas very often list a free-provider business email (e.g. doublejaesthetics@gmail.com)
// in the footer. These must be accepted even though the domain ≠ the site domain.
const FREE_EMAIL_PROVIDERS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com', 'proton.me', 'protonmail.com', 'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net', 'bellsouth.net'])
// Third-party/vendor/tracking addresses that appear in page source (Wix/Sentry telemetry, CDNs,
// schema examples) but are never the business's real contact. Rejected regardless of source.
// mysite.com/yoursite.com etc. are website-builder TEMPLATE placeholders (Wix ships
// mailto:info@mysite.com) — never a real contact, even in an explicit mailto: link.
const TRACKING_EMAIL_DOMAIN_RE = /(?:wixpress\.com|wix\.com|sentry\.io|sentry-next\.[a-z.]+|squarespace\.com|godaddy\.com|cloudflare\.[a-z]+|gstatic\.com|googleapis\.com|schema\.org|example\.(?:com|org|net)|w3\.org|sentry\.[a-z.]+|mysite\.com|yoursite\.com|yourdomain\.com|yourcompany\.com)$/i

const EMAIL_REGEX = /[\w.+\-]+@[\w\-]+\.[\w.]{2,}/g
// Strict single-address validator — rejects leading junk (e.g. "%20foo@x.com"), trailing punctuation,
// and comma/semicolon-joined multi-address strings ("a@x.com,b@y.com").
const STRICT_EMAIL_RE = /^[a-z0-9](?:[a-z0-9._%+\-]*[a-z0-9])?@[a-z0-9\-]+(?:\.[a-z0-9\-]+)+$/i

// Clean one raw address token: percent-decode (%20 → space), strip surrounding junk, lowercase.
function cleanEmail(s: string): string {
  try { s = decodeURIComponent(s) } catch { /* leave as-is */ }
  return s.replace(/^[\s,;<>()"'|]+|[\s,;<>()"'|.]+$/g, '').toLowerCase().trim()
}

// Med-spa-specific booking platforms. If any of these appear in the HTML, the
// business has online booking — a significant positive signal (NOT a problem).
const BOOKING_PLATFORMS: Array<{ name: string; pattern: string }> = [
  { name: 'Vagaro', pattern: 'vagaro.com' },
  { name: 'Mindbody', pattern: 'mindbodyonline.com' },
  { name: 'Boulevard', pattern: 'boulevard.io' },
  { name: 'Mangomint', pattern: 'mangomint.com' },
  { name: 'Zenoti', pattern: 'zenoti.com' },
  { name: 'Fresha', pattern: 'fresha.com' },
  { name: 'Jane App', pattern: 'janeapp.com' },
  { name: 'Patientpop', pattern: 'patientpop.com' },
  { name: 'AestheticsPro', pattern: 'myaestheticspro.com' },
  { name: 'Square Appointments', pattern: 'squareup.com' },
  { name: 'Acuity Scheduling', pattern: 'acuityscheduling.com' },
  { name: 'Calendly', pattern: 'calendly.com' },
  { name: 'Schedulista', pattern: 'schedulista.com' },
  { name: 'Zynnyme', pattern: 'zynnyme.com' },
  { name: 'Booker', pattern: 'booker.com' },
  { name: 'Treatwell', pattern: 'treatwell.com' },
  { name: 'Timely', pattern: 'gettimely.com' },
  { name: 'SimplePractice', pattern: 'simplepractice.com' },
  // Added 2026-07-02 after ground-truth run found these on "no booking" false positives.
  { name: 'AestheticRecord', pattern: 'aestheticrecord' }, // covers myaestheticrecord.com + aestheticrecord.com
  { name: 'Growth99', pattern: 'growth99' },
  { name: 'RepeatMD', pattern: 'repeatmd' },
  { name: 'GlossGenius', pattern: 'glossgenius' },
  { name: 'Moxie', pattern: 'joinmoxie' },
  { name: 'PatientNow', pattern: 'patientnow' }, // covers mypatientnow.com + book.mypatientnow.com
  { name: 'Booksy', pattern: 'booksy.com' },
  { name: 'Setmore', pattern: 'setmore.com' },
  { name: 'Boulevard', pattern: 'blvd.co' },
  { name: 'GoHighLevel', pattern: 'leadconnectorhq' }, // GHL booking widget host
]

// Custom / self-hosted booking is common (GoHighLevel /widget/form, PatientNow, in-house
// booking pages). These won't match a platform host, so also look for booking LINKS in the
// markup. Kept deliberately narrow (hyphenated slugs / path segments) so it does not fire on
// prose like "book now" text or on facebook.com links.
const BOOKING_LINK_RE = /(?:href|src|data-href)\s*=\s*["'][^"']*(?:\/book|book-|online-booking|\/appointment|-appointment|\/schedul|\/widget\/form|acuityscheduling|calendly\.com|book\.[a-z0-9-]+\.)[^"']*["']/i

// A med spa with a CONTACT/APPOINTMENT form or a "schedule/contact us" CTA counts as reachable
// online — it is NOT a "no booking" weakness. These broaden detection to stop false negatives.
const CONTACT_FORM_RE = /<form[\s>]/i
// Embedded form / scheduler platforms (contact forms + booking widgets).
const FORM_PLATFORM_RE = /(calendly|hs-form|hsforms|hubspot|jotform|typeform|gravityforms|gform_|wpforms|wpcf7|contact-form-7|formstack|wufoo|123formbuilder|getresponse|mindbody|vagaro|squarespace-forms|tally\.so|fillout|paperform)/i
// A link to a contact / appointment / booking page.
const CONTACT_LINK_RE = /(?:href|action)\s*=\s*["'][^"']*(?:\/contact|contact-us|\/appointments?|\/book|\/booking|\/schedul|\/consult|get-started)[^"']*["']/i
// Visible-text CTAs a real page shows for booking/contact (matched against stripped text, not scripts).
const CONTACT_KEYWORD_RE = /\b(?:book\s*(?:now|online|an?\s*appointment|a?\s*consultation)?|schedule\s*(?:an?\s*)?(?:appointment|consultation|call|visit|now|online)?|request\s*(?:an?\s*)?(?:appointment|consultation|callback)|make\s*an?\s*appointment|online\s*booking|reserve\s*(?:your|a)?\s*(?:spot|appointment|table)?|free\s*consultation|contact\s*us|get\s*started)\b/i

// ---------------------------------------------------------------------------
// Chain / multi-location signals
// Our ICP is owner-operated clinics (1–3 locations). Chains close slowly / route to
// committees, so we down-rank them. These signals are extracted from raw HTML and passed
// to the AI, which caps quality_score. Ground-truth run (2026-07-02) found chains (SkinSpirit,
// Advanced Aesthetics) were scored high because the AI had no chain signal to act on.
// ---------------------------------------------------------------------------
const CHAIN_NAV_RE = /\b(?:our|all|other|more|view all) locations\b|\bchoose (?:a |your )?location\b|\bselect (?:a |your )?location\b|\ball (?:our )?(?:clinics|offices|studios)\b/i
const FRANCHISE_RE = /\bfranchis(?:e|ing|es)\b/i
// A training school/academy alongside the clinic signals a larger operation — matched either in
// visible text or in a link (e.g. href=".../the-school-educational-courses/").
const SCHOOL_RE = /\b(?:training school|aesthetics? (?:school|academy)|school of aesthetic|our academy|explore the school|education center)\b/i
const SCHOOL_LINK_RE = /(?:href|src)\s*=\s*["'][^"']*(?:the-school|school-educational|educational-courses|aesthetics?-(?:school|academy)|\/academy\b)[^"']*["']/i
// A link to a plural /locations directory (a chain lists its sites there; a single clinic uses a
// singular "location"/"contact" page).
const LOCATIONS_DIR_RE = /(?:href|src)\s*=\s*["'][^"']*\/locations\/?["']/i
// Per-CITY booking CTAs: "Book at Seattle", "Book in Miami". The "at/in <City>" connector is
// the precision guard — a single clinic has many "Book Now" / "Book <Treatment>" buttons but
// never "Book at <City>". (These signals deterministically cap the score, so precision > recall.)
const BOOK_CITY_G = /\bbook\s+(?:at|in)\s+([A-Z][a-z]{2,})/g
const BOOK_STOPWORDS = new Set(['advance', 'person', 'store', 'minutes', 'seconds', 'time', 'the', 'your', 'our', 'a', 'an'])
// Links to 2+ distinct /locations/<city> pages — the highest-precision chain signal (a
// single-location clinic has at most one). Matches on raw HTML (hrefs live inside tags).
const LOCATION_LINK_G = /(?:href|src)\s*=\s*["'][^"']*\/locations?\/([a-z0-9][a-z0-9-]{2,})[^"']*["']/gi

function detectChainSignals(html: string, url: string): string[] {
  const signals: string[] = []
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') // normalize whitespace so phrases split across tags still match
  // The URL itself is a per-location sub-page of a multi-location brand, e.g. /locations/seattle-university-village
  try {
    if (/\/locations?\/[a-z0-9]/i.test(new URL(url).pathname)) signals.push('URL is a per-location page of a multi-location brand (/locations/<city>)')
  } catch { /* ignore bad URL */ }
  // Links to 2+ distinct /locations/<city> pages.
  const locSlugs = new Set<string>()
  for (const m of html.matchAll(LOCATION_LINK_G)) locSlugs.add(m[1].toLowerCase())
  for (const generic of ['index', 'all', 'map', 'near-me', 'find']) locSlugs.delete(generic)
  if (locSlugs.size >= 2) signals.push(`Links to ${locSlugs.size} location pages (/locations/<city>)`)
  else if (LOCATIONS_DIR_RE.test(html)) signals.push('Links to a /locations directory (multi-location listing)')
  if (CHAIN_NAV_RE.test(text)) signals.push('Multi-location navigation present ("our/all/select location")')
  if (FRANCHISE_RE.test(text)) signals.push('Franchise language present')
  if (SCHOOL_RE.test(text) || SCHOOL_LINK_RE.test(html)) signals.push('Runs a training school/academy (larger operation)')
  // Per-city "Book at <City>" CTAs → the clinic books multiple locations separately.
  const cities = new Set<string>()
  for (const m of text.matchAll(BOOK_CITY_G)) {
    const tok = m[1].toLowerCase()
    if (!BOOK_STOPWORDS.has(tok)) cities.add(tok)
  }
  if (cities.size >= 2) signals.push(`Per-city booking CTAs (${cities.size} cities) — multi-location`)
  // Corroborating only (never fires alone): many "location" mentions on the homepage.
  const locCount = (text.match(/\blocations?\b/gi) ?? []).length
  if (locCount >= 8 && signals.length > 0) signals.push(`"location" mentioned ${locCount}× on the homepage`)
  return signals
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function parseDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function extractMailtoEmails(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/mailto:([^\s"'?#>]+)/gi)) {
    // A single mailto may hold several comma/semicolon-separated addresses.
    for (const part of m[1].split(/[?#]/)[0].split(/[,;]+/)) {
      const addr = cleanEmail(part)
      if (STRICT_EMAIL_RE.test(addr)) out.push(addr)
    }
  }
  return out
}

function extractRegexEmails(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, ' ')
  return (text.match(EMAIL_REGEX) ?? []).map(cleanEmail).filter((e) => STRICT_EMAIL_RE.test(e))
}

// `fromMailto` = the address came from an explicit mailto: link the owner placed on the page, so
// it is trusted regardless of domain (minus tracking/junk). Regex-scraped addresses from page text
// are noisier, so they must be on the site domain or a known free provider.
function filterEmails(emails: string[], siteDomain: string, fromMailto = false): string[] {
  return emails.filter((e) => {
    if (!STRICT_EMAIL_RE.test(e)) return false // reject %20 prefixes, joined addresses, trailing junk
    const [local, domain] = e.split('@')
    if (!local || !domain) return false
    if (domain.length < 4 || !domain.includes('.')) return false
    if (DISCARD_PREFIXES.some((p) => local.startsWith(p))) return false
    const emailDomain = domain.replace(/^www\./, '')
    if (TRACKING_EMAIL_DOMAIN_RE.test(emailDomain)) return false
    if (fromMailto) return true
    const onSite = !!siteDomain && (emailDomain === siteDomain || emailDomain.endsWith('.' + siteDomain))
    return onSite || FREE_EMAIL_PROVIDERS.has(emailDomain)
  })
}

function rankEmails(emails: string[]): string[] {
  return [...emails].sort((a, b) => {
    const aRole = ROLE_PREFIXES.some((p) => a.split('@')[0].startsWith(p)) ? 0 : 1
    const bRole = ROLE_PREFIXES.some((p) => b.split('@')[0].startsWith(p)) ? 0 : 1
    return aRole - bRole
  })
}

// ---------------------------------------------------------------------------
// Fetch with timing
// ---------------------------------------------------------------------------

// Headless-render fallback (r.jina.ai): returns the RENDERED page as markdown/text — sees what a
// browser sees, including JS-injected content. Used only for JS-shell pages and bot-blocked sites
// (~15% of leads), so the free tier's rate limits are fine; set JINA_API_KEY for higher limits.
const RENDER_TIMEOUT_MS = 25_000 // first render of a heavy site can take ~20s (jina caches after)
async function fetchRendered(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS)
    const key = typeof Deno !== 'undefined' ? Deno.env.get('JINA_API_KEY') : undefined
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const text = await res.text()
    if (text.length < 300) return null // render failed or empty shell
    // The renderer can be served the same bot-challenge page — don't treat that as site content.
    if (/sgcaptcha|robot challenge|checking your browser|just a moment|verify you are human/i.test(text.slice(0, 2000))) return null
    return text.length > 200_000 ? text.slice(0, 200_000) : text
  } catch {
    return null
  }
}

async function fetchPage(url: string): Promise<{ html: string | null; loadTimeMs: number; finalUrl?: string; truncatedEmails?: { mailto: string[]; text: string[] } }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelBot/1.0; +https://leadintel.io)' },
    })
    clearTimeout(timer)
    const loadTimeMs = Date.now() - start
    const finalUrl = res.url || url // where we landed after redirects (for SSL check)
    if (!res.ok) return { html: null, loadTimeMs, finalUrl }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return { html: null, loadTimeMs, finalUrl }
    const html = await res.text()
    // Bot-challenge / JS-gate guard: some sites (Cloudflare-style JS challenges) answer any
    // non-browser client with HTTP 202 + a tiny stub (~170 bytes). res.ok is true, so without
    // this guard we'd score the stub as a real page and emit bogus "not mobile / no booking"
    // issues → a false 'weak'. Treat these as unreachable (→ 'unknown') instead.
    // Ground-truth run (2026-07-02): 4/17 sites were JS-gated this way and need a real browser.
    if (res.status === 202 || html.length < 600) return { html: null, loadTimeMs, finalUrl }
    // Bot-challenge interstitials served with HTTP 200 (sgcaptcha, Cloudflare "Just a moment",
    // etc.). Verified live: leverve.ca serves a "Robot Challenge Screen" that we scored as a real
    // page → false "no booking/contact". Treat as unreachable so the render fallback takes over.
    if (/sgcaptcha|robot challenge|checking your browser|just a moment|cf-chl|__cf_chl/i.test(html.slice(0, 3000)) && html.length < 20_000) {
      return { html: null, loadTimeMs, finalUrl }
    }
    // Cap size to bound CPU: the quality/chain/email regexes each scan the whole document, and some
    // med-spa sites ship 700KB+ of inline scripts/JSON. The signals we need live in the visible
    // markup, so ~400KB is plenty and keeps per-lead CPU well under the edge function's limit.
    // EXCEPTION — emails: on giant builder pages (ERT: 2.5MB Wix) the footer email sits far past
    // the cap, so harvest candidates from the FULL html first (two single-pass regexes, cheap).
    if (html.length > 400_000) {
      return {
        html: html.slice(0, 400_000), loadTimeMs, finalUrl,
        truncatedEmails: { mailto: extractMailtoEmails(html), text: extractRegexEmails(html) },
      }
    }
    return { html, loadTimeMs, finalUrl }
  } catch {
    return { html: null, loadTimeMs: Date.now() - start }
  }
}

// ---------------------------------------------------------------------------
// Website quality signal detection (all from raw HTML, no headless browser)
// ---------------------------------------------------------------------------

function detectQualitySignals(html: string, loadTimeMs: number): {
  hasMobileViewport: boolean
  hasBookingWidget: boolean
  bookingPlatform: string | null
  copyrightYear: number | null
  detectedIssues: string[]
  hasTitle: boolean
  hasMetaDescription: boolean
  hasH1: boolean
  jsShell: boolean
  visibleTextExcerpt: string | null
} {
  const issues: string[] = []
  const htmlLower = html.toLowerCase()

  // Visible text with scripts/styles/tags removed. A page that is almost all script and has little
  // readable text (+ no form / no viewport) is a JS-rendered SHELL (Wix/Squarespace/React) whose real
  // content loads client-side — we CANNOT judge its booking/mobile from raw HTML, so we won't guess.
  const htmlNoScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // A <script>/<style> block cut off by the 400KB size cap has no closing tag — strip to end so its
    // raw JS isn't counted as "visible text" (would make a JS-shell page look readable).
    .replace(/<script[\s\S]*$/i, ' ')
    .replace(/<style[\s\S]*$/i, ' ')
  const visibleText = htmlNoScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  // Detect forms in the REAL markup only — a big JS bundle often contains "<form" inside its code,
  // which would otherwise make a JS-shell page look like it has a real on-page form.
  const hasForm = CONTACT_FORM_RE.test(htmlNoScripts)

  // 1. Mobile viewport (accept attribute-order variants + device-width in content)
  const hasMobileViewport = /<meta[^>]+viewport/i.test(html) || /width\s*=\s*device-width/i.test(html)

  // Sparse readable text + no on-page form = a JS-rendered shell (Wix/Squarespace/Showit/React) whose
  // real content loads client-side. A viewport tag in the static <head> does NOT make it readable —
  // solene-spa.com is 2MB of JS with ~90 chars of text yet has a viewport. So don't require no-viewport.
  const jsShell = visibleText.length < 600 && !hasForm

  // 2. Booking / contact online: a named platform, a booking link, an embedded form platform,
  //    an on-page <form>, a contact/appointment page link, or a contact/booking CTA in the text.
  //    A contact/appointment FORM counts as "reachable online" — NOT a "no booking" weakness.
  let bookingPlatform: string | null = null
  for (const { name, pattern } of BOOKING_PLATFORMS) { if (htmlLower.includes(pattern)) { bookingPlatform = name; break } }
  if (!bookingPlatform && FORM_PLATFORM_RE.test(html)) bookingPlatform = 'Embedded form/scheduler'
  if (!bookingPlatform && BOOKING_LINK_RE.test(html)) bookingPlatform = 'Booking link'
  if (!bookingPlatform && CONTACT_LINK_RE.test(html)) bookingPlatform = 'Contact/appointment page'
  if (!bookingPlatform && hasForm) bookingPlatform = 'On-page form'
  if (!bookingPlatform && CONTACT_KEYWORD_RE.test(visibleText)) bookingPlatform = 'Contact/booking CTA'
  const hasBookingWidget = bookingPlatform !== null

  // Contact/booking: when we can READ the page and found NO form, no contact/appointment page, no
  // booking widget and no contact CTA, that's a CONFIRMED weakness (phone-only, no online contact).
  if (!hasBookingWidget && !jsShell) {
    issues.push('CONFIRMED no online contact: a readable homepage with no contact form, booking widget, or contact/appointment page — patients can only reach the clinic by phone')
  }
  // Mobile: only assert not-mobile-friendly when we can read the page.
  if (!hasMobileViewport && !jsShell) {
    issues.push('No mobile viewport tag — the site may not be mobile-friendly (text can be tiny on phones)')
  }

  // 3. Load time — 2s is fine; only clearly slow loads matter.
  if (loadTimeMs > 6000) issues.push(`Very slow load (${loadTimeMs}ms) — visitors bounce and Google ranks slow sites lower`)
  else if (loadTimeMs > 3500) issues.push(`Somewhat slow load (${loadTimeMs}ms)`)

  // 4. Copyright year — ONLY an OLD year signals neglect. A current/recent year is GOOD, never "dated".
  const copyrightMatch = html.match(/©\s*(\d{4})/g)
  let copyrightYear: number | null = null
  if (copyrightMatch) {
    const years = copyrightMatch.map((m) => parseInt(m.replace(/©\s*/, ''))).filter((y) => y >= 2000 && y <= 2100)
    if (years.length) {
      copyrightYear = Math.max(...years)
      const currentYear = new Date().getFullYear()
      if (copyrightYear <= currentYear - 3) {
        issues.push(`Copyright year ${copyrightYear} — ${currentYear - copyrightYear} years out of date; the site looks unmaintained`)
      }
    }
  }

  // 5. Table-based layout — a reliable indicator of very old web design
  const tableLayoutSignals = (html.match(/<table[^>]*(width=["']100%["']|cellpadding|cellspacing)/gi) ?? []).length
  if (tableLayoutSignals >= 2) issues.push('Table-based page layout — a sign of a very outdated website')

  // 6. SEO basics — missing title / meta description / H1 hurts Google visibility (readable pages only).
  const hasTitle = /<title[^>]*>\s*\S[^<]*<\/title>/i.test(html)
  const hasMetaDescription = /<meta[^>]+name=["']?description["']?/i.test(html)
  const hasH1 = /<h1[\s>]/i.test(html)
  if (!jsShell) {
    const missing: string[] = []
    if (!hasTitle) missing.push('page title')
    if (!hasMetaDescription) missing.push('meta description')
    if (!hasH1) missing.push('H1 heading')
    if (missing.length >= 2) issues.push(`Missing SEO basics (${missing.join(', ')}) — the site is hard to find on Google`)
  }

  // 7. Social presence — med spa patients expect an active Instagram; no IG/FB link is a weak signal.
  if (!jsShell && !/instagram\.com/i.test(html) && !/facebook\.com/i.test(html)) {
    issues.push('No Instagram or Facebook linked on the site — weak social presence for a med spa')
  }

  if (jsShell) issues.push('Site content is JavaScript-rendered — booking, mobile, SEO and social could not be verified from the page source; treat those as UNKNOWN, not weaknesses')

  return {
    hasMobileViewport, hasBookingWidget, bookingPlatform, copyrightYear, detectedIssues: issues,
    // Granular SEO flags feed the 0-100 site-health score (null-able upstream when jsShell).
    hasTitle, hasMetaDescription, hasH1, jsShell,
    // The site's own words — what a visitor actually reads. Grounds the AI's niche judgment and
    // lets pain points / hooks quote the clinic's real copy. Null for shells (nothing readable).
    visibleTextExcerpt: jsShell ? null : visibleText.slice(0, 1200),
  }
}

// ---------------------------------------------------------------------------
// Cheap / DIY website-builder detection. Fingerprints live in the static shell, so this works even
// on JS-rendered sites (unlike booking/mobile). A FREE subdomain is a real weakness; a DIY builder
// on a custom domain is a softer signal + a good pitch angle.
// ---------------------------------------------------------------------------
const FREE_HOST_SUFFIXES = ['business.site', 'wixsite.com', 'godaddysites.com', 'weebly.com', 'mystrikingly.com', 'square.site', 'wordpress.com', 'blogspot.com', 'jimdosite.com', 'site123.me', 'webnode.com', 'yolasite.com', 'webs.com', 'simplesite.com', 'ucraft.site']
const BUILDER_FINGERPRINTS: Array<{ name: string; re: RegExp }> = [
  { name: 'Wix', re: /wixstatic\.com|static\.parastorage\.com|X-Wix|content=["'][^"']*Wix\.com/i },
  { name: 'Squarespace', re: /static1\.squarespace\.com|squarespace-cdn\.com|["']Squarespace["']/i },
  { name: 'GoDaddy Website Builder', re: /img1\.wsimg\.com|GoDaddy Website Builder/i },
  { name: 'Weebly', re: /cdn\d?\.editmysite\.com|weeblycloud|["']Weebly["']/i },
  { name: 'Google Sites', re: /gstatic\.com\/atari|sites\.google\.com\/embed/i },
  { name: 'Jimdo', re: /jimstatic\.com|["']Jimdo["']/i },
  { name: 'Site123', re: /s123-cdn|["']SITE123["']/i },
  { name: 'Strikingly', re: /strikingly(?:cdn)?\.com/i },
  { name: 'Duda', re: /irp\.cdn-website\.com|dudamobile|dudaone/i },
]

// Professional platforms — recorded as tech stack (NOT a weakness or pitch angle by themselves).
// WordPress theme name is extracted when present ("WordPress (theme: bridge)").
const PLATFORM_FINGERPRINTS: Array<{ name: string; re: RegExp }> = [
  { name: 'Shopify', re: /cdn\.shopify\.com|myshopify\.com/i },
  { name: 'Webflow', re: /assets(?:-global)?\.website-files\.com|data-wf-page/i },
  { name: 'Framer', re: /framerusercontent\.com|framer\.website/i },
  { name: 'GoHighLevel', re: /leadconnectorhq|msgsndr\.com|widgets\.leadconnector/i },
  { name: 'Showit', re: /showit\.co|cdn\.showit/i },
]

function detectBuilder(html: string, domain: string): { builder: string | null; freeTier: boolean; techStack: string | null } {
  const freeSuffix = FREE_HOST_SUFFIXES.find((s) => domain === s || domain.endsWith('.' + s))
  if (freeSuffix) {
    const label = /wixsite/.test(freeSuffix) ? 'free Wix subdomain'
      : /business\.site/.test(freeSuffix) ? 'auto-generated Google Business site'
      : /godaddysites/.test(freeSuffix) ? 'free GoDaddy subdomain'
      : /weebly/.test(freeSuffix) ? 'free Weebly subdomain'
      : /square\.site/.test(freeSuffix) ? 'free Square Online subdomain'
      : /wordpress\.com/.test(freeSuffix) ? 'free WordPress.com subdomain'
      : `free builder subdomain (${freeSuffix})`
    return { builder: label, freeTier: true, techStack: label }
  }
  for (const { name, re } of BUILDER_FINGERPRINTS) { if (re.test(html)) return { builder: name, freeTier: false, techStack: name } }
  // WordPress: platform, with theme extraction (Elementor noted — common DIY-on-WP signal)
  if (/wp-content|wp-includes/i.test(html)) {
    const theme = html.match(/\/wp-content\/themes\/([a-z0-9_-]+)\//i)?.[1] ?? null
    const elementor = /elementor/i.test(html) ? ' + Elementor' : ''
    return { builder: null, freeTier: false, techStack: `WordPress${theme ? ` (theme: ${theme})` : ''}${elementor}` }
  }
  for (const { name, re } of PLATFORM_FINGERPRINTS) { if (re.test(html)) return { builder: null, freeTier: false, techStack: name } }
  return { builder: null, freeTier: false, techStack: null }
}

// MX lookup for the found email's domain. Deno.resolveDns in the edge runtime; DNS-over-HTTPS
// fallback (also the Node test-harness path). true/false = definitive; null = couldn't check.
async function checkMx(email: string | null): Promise<boolean | null> {
  if (!email) return null
  const domain = email.split('@')[1]
  if (!domain) return null
  try {
    // @ts-ignore — Deno global absent under the Node test harness
    if (typeof Deno !== 'undefined' && Deno.resolveDns) {
      // @ts-ignore
      const recs = await Deno.resolveDns(domain, 'MX')
      if (Array.isArray(recs) && recs.length > 0) return true
      // fall through to DoH — resolveDns can return empty on some resolvers
    }
  } catch { /* NXDOMAIN or resolver error — confirm via DoH */ }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const j = await res.json()
    if (j.Status === 3) return false // NXDOMAIN — domain doesn't exist
    return Array.isArray(j.Answer) && j.Answer.some((a: { type?: number }) => a.type === 15)
  } catch {
    return null // network failure — unknown, never claim "dead" without proof
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function analyzeWebsite(websiteUri: string): Promise<WebsiteResult> {
  const noResult: WebsiteResult = {
    email: null, emailSource: 'none', emailConfidence: 'none',
    reachable: false, loadTimeMs: 0,
    hasMobileViewport: false, hasBookingWidget: false, bookingPlatform: null,
    copyrightYear: null, detectedIssues: [], chainSignals: [], visibleTextExcerpt: null,
    seoScore: null, techStack: null, emailMxOk: null,
  }

  if (!websiteUri) return noResult

  const siteDomain = parseDomain(websiteUri)
  if (!siteDomain) return noResult

  const base = websiteUri.endsWith('/') ? websiteUri.slice(0, -1) : websiteUri
  const pagesToTry = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`, `${base}/about-us`]

  let email: string | null = null
  let emailSource: 'mailto' | 'text_match' | 'none' = 'none'
  let emailConfidence: 'high' | 'low' | 'none' = 'none'
  let homepageHtml: string | null = null
  let homepageLoadMs = 0
  let homepageFinalUrl = base
  let reachable = false
  let pagesChecked = 0

  for (const pageUrl of pagesToTry) {
    if (pagesChecked >= MAX_PAGES) break
    const { html, loadTimeMs, finalUrl, truncatedEmails } = await fetchPage(pageUrl)
    pagesChecked++
    if (pagesChecked === 1 && finalUrl) homepageFinalUrl = finalUrl
    if (!html) {
      // If the homepage itself is unreachable, the whole domain is down/blocked — don't burn
      // more timeouts probing contact/about pages on the same dead host. Bounds a dead domain
      // to a single timeout, which keeps a generous FETCH_TIMEOUT_MS safe for batch runs.
      if (pagesChecked === 1) break
      continue
    }

    reachable = true
    if (pagesChecked === 1) {
      homepageHtml = html
      homepageLoadMs = loadTimeMs
    }

    if (!email) {
      // Prefer mailto: links (high confidence) — trusted regardless of domain (fromMailto)
      const mailtoFiltered = filterEmails(extractMailtoEmails(html), siteDomain, true)
      if (mailtoFiltered.length > 0) {
        email = rankEmails(mailtoFiltered)[0]
        emailSource = 'mailto'
        emailConfidence = 'high'
      } else {
        // Regex fallback (low confidence) — keep searching other pages for a better hit
        const regexFiltered = filterEmails(extractRegexEmails(html), siteDomain)
        if (regexFiltered.length > 0 && emailSource !== 'mailto') {
          email = rankEmails(regexFiltered)[0]
          emailSource = 'text_match'
          emailConfidence = 'low'
        }
      }
    }
    // Giant-page fallback: candidates harvested from the FULL html before truncation (the page's
    // footer email often sits past the 400KB cap on heavy Wix/builder sites).
    if (!email && truncatedEmails) {
      const m = filterEmails(truncatedEmails.mailto, siteDomain, true)
      if (m.length > 0) {
        email = rankEmails(m)[0]; emailSource = 'mailto'; emailConfidence = 'high'
      } else {
        const t = filterEmails(truncatedEmails.text, siteDomain)
        if (t.length > 0) { email = rankEmails(t)[0]; emailSource = 'text_match'; emailConfidence = 'low' }
      }
    }

    // Once we have a high-confidence email AND we've scanned the homepage, stop early
    if (emailConfidence === 'high' && homepageHtml) break
  }

  // Quality + chain signals come from the homepage only
  const qualitySignals = homepageHtml
    ? detectQualitySignals(homepageHtml, homepageLoadMs)
    : { hasMobileViewport: false, hasBookingWidget: false, bookingPlatform: null, copyrightYear: null, detectedIssues: [], hasTitle: false, hasMetaDescription: false, hasH1: false, jsShell: false, visibleTextExcerpt: null as string | null }
  const chainSignals = homepageHtml ? detectChainSignals(homepageHtml, websiteUri) : []

  // ---------------------------------------------------------------------------
  // Headless-render fallback: for JS-shell pages (content invisible in raw HTML) and unreachable/
  // bot-blocked sites, fetch the RENDERED page text and recover the signals we couldn't see.
  // ---------------------------------------------------------------------------
  const isJsShell = qualitySignals.detectedIssues.some((i) => i.startsWith('Site content is JavaScript-rendered'))
  let renderFallbackUsed = false
  if (!homepageHtml || isJsShell) {
    const rendered = await fetchRendered(websiteUri)
    if (rendered) {
      reachable = true
      // Booking/contact from the rendered text: CTAs, or links to booking/contact pages.
      if (!qualitySignals.hasBookingWidget) {
        const bookingInText = CONTACT_KEYWORD_RE.test(rendered)
          || /\(https?:\/\/[^)]*(?:book|schedul|appointment|contact)[^)]*\)/i.test(rendered)
        if (bookingInText) {
          qualitySignals.hasBookingWidget = true
          qualitySignals.bookingPlatform = 'Booking/contact found on rendered page'
        }
      }
      // Email from the rendered text (raw HTML had none).
      if (!email) {
        const found = filterEmails((rendered.match(EMAIL_REGEX) ?? []).map(cleanEmail).filter((e) => STRICT_EMAIL_RE.test(e)), siteDomain)
        if (found.length > 0) { email = rankEmails(found)[0]; emailSource = 'text_match'; emailConfidence = 'low' }
      }
      // Copyright year from rendered text.
      if (!qualitySignals.copyrightYear) {
        const m = rendered.match(/©\s*(20\d{2})/g)
        if (m) {
          const years = m.map((x) => parseInt(x.replace(/©\s*/, ''))).filter((y) => y >= 2000 && y <= 2100)
          if (years.length) qualitySignals.copyrightYear = Math.max(...years)
        }
      }
      // Page-text excerpt from the rendered content (skip jina's header, drop markdown link URLs).
      if (!qualitySignals.visibleTextExcerpt) {
        const bodyStart = rendered.indexOf('Markdown Content:')
        const body = (bodyStart >= 0 ? rendered.slice(bodyStart + 17) : rendered)
          .replace(/\]\((https?:\/\/|mailto:)[^)]*\)/g, ']')
          .replace(/[#*_>\[\]]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (body.length > 80) qualitySignals.visibleTextExcerpt = body.slice(0, 1200)
      }

      // Replace the "couldn't verify" messaging with what the render actually established.
      // Mobile: renders can't verify the viewport, and printing "NO" to the model invites false
      // "not mobile-friendly" claims (audit 2026-07-04: CLINIQUE AG, Skin Solution) — assume yes.
      qualitySignals.hasMobileViewport = true
      renderFallbackUsed = true
      qualitySignals.detectedIssues = qualitySignals.detectedIssues.filter((i) => !i.startsWith('Site content is JavaScript-rendered'))
      qualitySignals.detectedIssues.push('Assessed via headless-render fallback — booking/contact were read from the RENDERED page; layout, load speed, SSL, mobile and email presence could not be fully verified (treat those as UNKNOWN)')
      if (!qualitySignals.hasBookingWidget) {
        qualitySignals.detectedIssues.push('CONFIRMED no online contact: even the fully rendered page shows no booking or contact option — patients can only phone')
      }
    }
  }

  // No email published anywhere on the site is itself a real weakness (patients can't email) —
  // but ONLY assert absence when we directly read the real page. Render fallbacks are partial
  // (lazy-loaded footers missing) and shells hide emails behind JS, so absence proves nothing there.
  if (homepageHtml && !isJsShell && !renderFallbackUsed && !email) {
    qualitySignals.detectedIssues.push('No email address published anywhere on the site — patients cannot reach the clinic by email')
  }
  // No SSL — the site loads over http:// (didn't upgrade to https). Insecure + browsers warn visitors.
  // Only assert when we actually fetched the page ourselves (not via the render fallback).
  if (homepageHtml && /^http:\/\//i.test(homepageFinalUrl)) {
    qualitySignals.detectedIssues.push('No SSL certificate — the site loads over insecure http:// and browsers show a "Not Secure" warning')
  }
  // Cheap / DIY website builder — a free subdomain is a real weakness; a DIY builder is a pitch
  // angle. Professional platforms (WordPress/Shopify/Webflow…) are recorded as tech stack only.
  let techStack: string | null = null
  let isFreeTier = false
  if (homepageHtml) {
    const det = detectBuilder(homepageHtml, siteDomain)
    techStack = det.techStack
    isFreeTier = det.freeTier
    if (det.freeTier) {
      qualitySignals.detectedIssues.push(`Site is a ${det.builder} — a free, auto-generated/template page with no custom domain; a clear sign the clinic has not invested in its web presence (strong weakness)`)
    } else if (det.builder) {
      qualitySignals.detectedIssues.push(`Built on ${det.builder} (a DIY website builder) — likely a generic template rather than a custom-designed site (a pitch angle; not automatically a flaw)`)
    }
  }

  // Email deliverability: does the address's domain have MX records at all? A dead domain means
  // the published email silently bounces — itself a sellable defect.
  const emailMxOk = await checkMx(email)
  if (email && emailMxOk === false) {
    qualitySignals.detectedIssues.push(`The published email ${email} is on a domain with no mail records (MX) — messages to it bounce; patients emailing the clinic get silence`)
  }

  // 0-100 site-health score — ONLY from verified signals (never for JS shells / render fallbacks,
  // where honesty demands "unknown" rather than a guessed number).
  let seoScore: number | null = null
  const verifiable = !!homepageHtml && !qualitySignals.jsShell && !renderFallbackUsed
  if (verifiable) {
    const currentYear = new Date().getFullYear()
    const ssl = !/^http:\/\//i.test(homepageFinalUrl)
    const load = homepageLoadMs < 2500 ? 10 : homepageLoadMs < 4000 ? 6 : homepageLoadMs < 6000 ? 3 : 0
    seoScore =
      (ssl ? 15 : 0) +
      (qualitySignals.hasMobileViewport ? 20 : 0) +
      (qualitySignals.hasTitle ? 10 : 0) +
      (qualitySignals.hasMetaDescription ? 10 : 0) +
      (qualitySignals.hasH1 ? 10 : 0) +
      (qualitySignals.hasBookingWidget ? 15 : 0) +
      load +
      (qualitySignals.copyrightYear == null || qualitySignals.copyrightYear > currentYear - 3 ? 5 : 0) +
      (isFreeTier ? 0 : 5)
  }

  return {
    email,
    emailSource,
    emailConfidence,
    reachable,
    loadTimeMs: homepageLoadMs,
    ...qualitySignals,
    chainSignals,
    seoScore,
    techStack,
    emailMxOk,
  }
}
