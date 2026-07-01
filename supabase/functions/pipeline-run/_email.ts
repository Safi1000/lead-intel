/** Email extraction from a business website.
 *  In-house only — no third-party enrichment APIs.
 *  Tries up to MAX_PAGES pages per business (homepage → /contact → /contact-us → /about → /about-us).
 *  Prefers mailto: links (high confidence) over regex text matches (low confidence).
 *  Discards noreply/donotreply addresses and emails on a different domain.
 *  Prefers role-based addresses when multiple candidates exist.
 */

export interface EmailResult {
  email: string | null
  source: 'mailto' | 'text_match' | 'none'
  confidence: 'high' | 'low' | 'none'
}

const MAX_PAGES = 3
const FETCH_TIMEOUT_MS = 6000
const ROLE_PREFIXES = ['info', 'contact', 'sales', 'hello', 'support', 'admin', 'enquiries', 'enquiry', 'office', 'mail']
const DISCARD_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'bounce', 'mailer-daemon', 'postmaster']

const EMAIL_REGEX = /[\w.+\-]+@[\w\-]+\.[\w.]{2,}/g

function parseDomain(url: string): string {
  try {
    const u = new URL(url)
    // Strip leading 'www.'
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function extractMailtoEmails(html: string): string[] {
  const out: string[] = []
  const matches = html.matchAll(/mailto:([^\s"'?#>]+)/gi)
  for (const m of matches) {
    const addr = m[1].split(/[?#]/)[0].toLowerCase().trim()
    if (addr.includes('@')) out.push(addr)
  }
  return out
}

function extractRegexEmails(html: string): string[] {
  // Strip HTML tags first to reduce false positives from encoded attribute values
  const text = html.replace(/<[^>]+>/g, ' ')
  const raw = text.match(EMAIL_REGEX) ?? []
  return raw.map((e) => e.toLowerCase())
}

function filterEmails(emails: string[], siteDomain: string): string[] {
  return emails.filter((e) => {
    const [local, domain] = e.split('@')
    if (!local || !domain) return false
    // Discard noreply-style
    if (DISCARD_PREFIXES.some((p) => local.startsWith(p))) return false
    // Discard emails on a completely different domain (ad networks, embeds)
    const emailDomain = domain.replace(/^www\./, '')
    if (siteDomain && emailDomain !== siteDomain && !emailDomain.endsWith('.' + siteDomain)) return false
    // Discard obviously invalid
    if (domain.length < 4 || !domain.includes('.')) return false
    return true
  })
}

function rankEmails(emails: string[]): string[] {
  return [...emails].sort((a, b) => {
    const aLocal = a.split('@')[0]
    const bLocal = b.split('@')[0]
    const aRole = ROLE_PREFIXES.some((p) => aLocal.startsWith(p)) ? 0 : 1
    const bRole = ROLE_PREFIXES.some((p) => bLocal.startsWith(p)) ? 0 : 1
    return aRole - bRole
  })
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelBot/1.0)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null
    return await res.text()
  } catch {
    return null
  }
}

export async function extractEmail(websiteUri: string): Promise<EmailResult> {
  if (!websiteUri) return { email: null, source: 'none', confidence: 'none' }

  const siteDomain = parseDomain(websiteUri)
  if (!siteDomain) return { email: null, source: 'none', confidence: 'none' }

  // Normalise base URL
  let base = websiteUri.endsWith('/') ? websiteUri.slice(0, -1) : websiteUri

  const pagesToTry = [
    base,
    base + '/contact',
    base + '/contact-us',
    base + '/about',
    base + '/about-us',
  ]

  let pagesChecked = 0

  for (const pageUrl of pagesToTry) {
    if (pagesChecked >= MAX_PAGES) break
    const html = await fetchPage(pageUrl)
    pagesChecked++
    if (!html) continue

    // 1. mailto: links — high confidence
    const mailtoRaw = extractMailtoEmails(html)
    const mailtoFiltered = filterEmails(mailtoRaw, siteDomain)
    if (mailtoFiltered.length > 0) {
      const ranked = rankEmails(mailtoFiltered)
      return { email: ranked[0], source: 'mailto', confidence: 'high' }
    }

    // 2. Regex text match — low confidence
    const regexRaw = extractRegexEmails(html)
    const regexFiltered = filterEmails(regexRaw, siteDomain)
    if (regexFiltered.length > 0) {
      const ranked = rankEmails(regexFiltered)
      return { email: ranked[0], source: 'text_match', confidence: 'low' }
    }
  }

  return { email: null, source: 'none', confidence: 'none' }
}
