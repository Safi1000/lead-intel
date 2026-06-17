/** Feature flags (§18-7). Read from /auth/me, with MVP defaults below. */

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
  // P3
  assistant: boolean
  outreach: boolean
  campaigns: boolean
  inbox: boolean
  branding: boolean
  resellers: boolean
}

/** MVP defaults: every P2/P3 flag OFF so routes render Coming-Soon shells. */
export const DEFAULT_FLAGS: FeatureFlags = {
  signup: false,
  marketMap: false,
  usage: false,
  apiKeys: false,
  webhooks: false,
  team: false,
  billing: false,
  integrations: false,
  aiProviders: false,
  scoring: false,
  crmPush: false,
  whatsapp: false,
  globalSearch: false,
  assistant: false,
  outreach: false,
  campaigns: false,
  inbox: false,
  branding: false,
  resellers: false,
}

export type FeatureFlagKey = keyof FeatureFlags
