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

/** Phase 2 & 3 delivered → all flags ON. */
export const DEFAULT_FLAGS: FeatureFlags = {
  signup: true,
  marketMap: true,
  usage: true,
  apiKeys: true,
  webhooks: true,
  team: true,
  billing: true,
  integrations: true,
  aiProviders: true,
  scoring: true,
  crmPush: true,
  whatsapp: true,
  globalSearch: true,
  marketLocks: true,
  notesTags: true,
  assistant: true,
  outreach: true,
  campaigns: true,
  inbox: true,
  branding: true,
  resellers: true,
  predictive: true,
  apiDocs: true,
  addons: true,
  countryCA: true,
  countryUK: true,
}

export type FeatureFlagKey = keyof FeatureFlags
