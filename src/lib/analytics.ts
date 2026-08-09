/**
 * Google Analytics 4.
 *
 * The tag is injected from here rather than hardcoded in index.html so it only
 * loads in production builds — dev sessions would otherwise pollute the
 * property with fake traffic.
 *
 * LeadIntel is a SPA, so GA's automatic page_view (which only fires on the
 * initial document load) is turned off and every route change is reported
 * manually instead. See the router subscription in main.tsx.
 */

const GA_ID = (import.meta.env.VITE_GA_ID as string | undefined) || 'G-NQMDXDJQL2'

type GtagArgs =
  | ['js', Date]
  | ['config', string, Record<string, unknown>?]
  | ['event', string, Record<string, unknown>?]
  | ['set', Record<string, unknown>]

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: GtagArgs) => void
  }
}

let enabled = false

/**
 * Honours a browser-level "don't track me" signal — Global Privacy Control
 * (legally binding under CCPA/CPRA) and the older Do Not Track header.
 */
function optedOut() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }
  return (
    nav.globalPrivacyControl === true ||
    nav.doNotTrack === '1' ||
    nav.msDoNotTrack === '1' ||
    (window as Window & { doNotTrack?: string }).doNotTrack === '1'
  )
}

/**
 * Loads gtag.js. No-op in dev, when the id is missing, when the visitor has
 * opted out at the browser level, or if called twice.
 */
export function initAnalytics() {
  if (enabled) return
  if (!GA_ID || !import.meta.env.PROD || optedOut()) return

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    // gtag relies on `arguments` being pushed verbatim — do not spread.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  } as typeof window.gtag

  window.gtag!('js', new Date())
  window.gtag!('config', GA_ID, { send_page_view: false })

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`
  document.head.appendChild(s)

  enabled = true
}

/** Reports one SPA navigation. */
export function trackPageView(path: string) {
  if (!enabled) return
  window.gtag!('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + path,
    page_title: document.title,
  })
}

/** Reports a custom event, e.g. trackEvent('lead_exported', { count: 25 }). */
export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (!enabled) return
  window.gtag!('event', name, params)
}

/**
 * Ties sessions to a user without sending anything personal — ids and role
 * only, never emails or names (GA forbids PII).
 */
export function setAnalyticsUser(userId: string | null, props?: Record<string, string>) {
  if (!enabled) return
  window.gtag!('set', { user_id: userId ?? undefined, user_properties: props })
}
