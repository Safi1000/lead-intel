/**
 * White-label branding for the client-facing Audit PDF (Feature: on-demand audit report).
 *
 * This is the single place the audit's agency identity comes from — swap these values for your
 * own agency and every generated audit rebrands instantly, with zero mention of LeadIntel.
 *
 * Multi-tenant note: when the Branding settings page (`/settings/branding`) is wired to
 * persistence, point `useAuditBrand()` at that per-org record instead of this static default.
 */
export interface AuditBrand {
  /** Agency name shown in the report header + footer. */
  name: string
  /** One-line positioning under the name. */
  tagline: string
  /** Brand accent (hex) — drives the whole report's colour. */
  accent: string
  /** 1–2 character logo mark. */
  logoText: string
  contactEmail: string
  contactPhone: string
}

export const AUDIT_BRAND: AuditBrand = {
  name: 'Harbourline Studio',
  tagline: 'Websites that book more clients',
  accent: '#124C54',
  logoText: 'H',
  contactEmail: 'hello@harbourline.studio',
  contactPhone: '(902) 555-0148',
}
