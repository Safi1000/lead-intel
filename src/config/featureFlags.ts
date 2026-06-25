/** Feature flags (§18-7). Read from /auth/me. Phase 2 & 3 are now ON. */

export interface FeatureFlags {
  // P2
  signup: boolean
  marketMap: boolean
  usage: boolean
  apiKeys: boolean
  webhooks: boolean
  team: boolean
  billing: boolean
  integrations: boolean
  aiProviders: boolean
  scoring: boolean
  crmPush: boolean
  whatsapp: boolean
  globalSearch: boolean
  marketLocks: boolean
  notesTags: boolean
  bookings: boolean // AE meetings + setter Calendly booking (Free-plan, polled)
  // P3
  assistant: boolean
  outreach: boolean
  campaigns: boolean
  inbox: boolean
  branding: boolean
  resellers: boolean
  predictive: boolean
  apiDocs: boolean
  addons: boolean
  countryCA: boolean
  countryUK: boolean
}

/**
 * Phase 1 (manual lead-handling) scope. Only the features used by the manual
 * generator → setter → closer workflow are ON; every automation / SaaS-billing /
 * AI / WhatsApp / CRM feature is OFF (hidden). Flip back on as phases land.
 */
export const DEFAULT_FLAGS: FeatureFlags = {
  signup: false, // self-service signup disabled — accounts are provisioned by SSA/managers
  team: true, // manage generator/setter/closer users (Req 1, 3, 4)
  notesTags: true, // per-lead remarks + warm/cold (Req 3, 4, 5)
  globalSearch: true, // search within the lead queue
  bookings: true, // AE meetings page + setter Calendly booking page
  // --- hidden: automation / SaaS / AI (re-enable in later phases) ---
  marketMap: false,
  usage: false,
  apiKeys: false,
  webhooks: false,
  billing: false,
  integrations: false,
  aiProviders: false,
  scoring: false,
  crmPush: false,
  whatsapp: false,
  marketLocks: false,
  assistant: false,
  outreach: false,
  campaigns: false,
  inbox: false,
  branding: false,
  resellers: false,
  predictive: false,
  apiDocs: false,
  addons: false,
  countryCA: false,
  countryUK: false,
}

export type FeatureFlagKey = keyof FeatureFlags
