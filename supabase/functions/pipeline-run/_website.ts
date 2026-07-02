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

const EMAIL_REGEX = /[\w.+\-]+@[\w\-]+\.[\w.]{2,}/g

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
    const addr = m[1].split(/[?#]/)[0].toLowerCase().trim()
    if (addr.includes('@')) out.push(addr)
  }
  return out
}

function extractRegexEmails(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, ' ')
  return (text.match(EMAIL_REGEX) ?? []).map((e) => e.toLowerCase())
}

function filterEmails(emails: string[], siteDomain: string): string[] {
  return emails.filter((e) => {
    const [local, domain] = e.split('@')
    if (!local || !domain) return false
    if (DISCARD_PREFIXES.some((p) => local.startsWith(p))) return false
    const emailDomain = domain.replace(/^www\./, '')
    if (siteDomain && emailDomain !== siteDomain && !emailDomain.endsWith('.' + siteDomain)) return false
    if (domain.length < 4 || !domain.includes('.')) return false
    return true
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

async function fetchPage(url: string): Promise<{ html: string | null; loadTimeMs: number }> {
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
    if (!res.ok) return { html: null, loadTimeMs }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return { html: null, loadTimeMs }
    const html = await res.text()
    // Bot-challenge / JS-gate guard: some sites (Cloudflare-style JS challenges) answer any
    // non-browser client with HTTP 202 + a tiny stub (~170 bytes). res.ok is true, so without
    // this guard we'd score the stub as a real page and emit bogus "not mobile / no booking"
    // issues → a false 'weak'. Treat these as unreachable (→ 'unknown') instead.
    // Ground-truth run (2026-07-02): 4/17 sites were JS-gated this way and need a real browser.
    if (res.status === 202 || html.length < 600) return { html: null, loadTimeMs }
    return { html, loadTimeMs }
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
} {
  const issues: string[] = []

  // 1. Mobile viewport — absence is a strong mobile-unfriendly signal
  const hasMobileViewport = /<meta[^>]+name=["']viewport["']/i.test(html)
  if (!hasMobileViewport) issues.push('No mobile viewport — site is not mobile-friendly (text will be tiny on phones)')

  // 2. Online booking — a named platform host, OR a booking link/widget in the markup.
  let bookingPlatform: string | null = null
  const htmlLower = html.toLowerCase()
  for (const { name, pattern } of BOOKING_PLATFORMS) {
    if (htmlLower.includes(pattern)) {
      bookingPlatform = name
      break
    }
  }
  if (!bookingPlatform && BOOKING_LINK_RE.test(html)) {
    bookingPlatform = 'Embedded/custom booking'
  }
  const hasBookingWidget = bookingPlatform !== null
  // NOTE: booking is frequently injected by JavaScript and invisible to this raw-HTML scan.
  // We therefore flag a *possible* gap for the AI to weigh — never as a confirmed weakness.
  if (!hasBookingWidget) issues.push('No online booking detected in page source — UNCERTAIN: may be a JS-injected widget, verify before treating as a weakness')

  // 3. Slow load time (>4s = definitely slow; 2-4s = borderline)
  if (loadTimeMs > 4000) issues.push(`Very slow load time (${loadTimeMs}ms) — Google penalises slow sites and visitors bounce`)
  else if (loadTimeMs > 2000) issues.push(`Slow load time (${loadTimeMs}ms) — noticeably slow on mobile connections`)

  // 4. Copyright year — old year suggests unmaintained site
  const copyrightMatch = html.match(/©\s*(\d{4})/g)
  let copyrightYear: number | null = null
  if (copyrightMatch) {
    // Take the most recent year found (some sites show © 2018-2024)
    const years = copyrightMatch.map((m) => parseInt(m.replace(/©\s*/, '')))
    copyrightYear = Math.max(...years)
    if (copyrightYear < 2021) {
      issues.push(`Copyright year ${copyrightYear} — site appears unmaintained and dated`)
    }
  }

  // 5. Table-based layout — a reliable indicator of very old web design
  const tableLayoutSignals = (html.match(/<table[^>]*(width=["']100%["']|cellpadding|cellspacing)/gi) ?? []).length
  if (tableLayoutSignals >= 2) issues.push('Table-based page layout — classic sign of a very outdated website')

  return { hasMobileViewport, hasBookingWidget, bookingPlatform, copyrightYear, detectedIssues: issues }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function analyzeWebsite(websiteUri: string): Promise<WebsiteResult> {
  const noResult: WebsiteResult = {
    email: null, emailSource: 'none', emailConfidence: 'none',
    reachable: false, loadTimeMs: 0,
    hasMobileViewport: false, hasBookingWidget: false, bookingPlatform: null,
    copyrightYear: null, detectedIssues: [],
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
  let reachable = false
  let pagesChecked = 0

  for (const pageUrl of pagesToTry) {
    if (pagesChecked >= MAX_PAGES) break
    const { html, loadTimeMs } = await fetchPage(pageUrl)
    pagesChecked++
    if (!html) continue

    reachable = true
    if (pagesChecked === 1) {
      homepageHtml = html
      homepageLoadMs = loadTimeMs
    }

    if (!email) {
      // Prefer mailto: links (high confidence)
      const mailtoFiltered = filterEmails(extractMailtoEmails(html), siteDomain)
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

    // Once we have a high-confidence email AND we've scanned the homepage, stop early
    if (emailConfidence === 'high' && homepageHtml) break
  }

  // Quality signals come from the homepage only
  const qualitySignals = homepageHtml
    ? detectQualitySignals(homepageHtml, homepageLoadMs)
    : { hasMobileViewport: false, hasBookingWidget: false, bookingPlatform: null, copyrightYear: null, detectedIssues: [] }

  return {
    email,
    emailSource,
    emailConfidence,
    reachable,
    loadTimeMs: homepageLoadMs,
    ...qualitySignals,
  }
}
