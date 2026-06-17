/** Localization helpers (§I-6). Lightweight — currency, postal, regions. */

export type Currency = 'USD' | 'CAD' | 'GBP'
export type CountryCode = 'US' | 'CA' | 'GB'

export interface Country {
  code: CountryCode
  label: string
  currency: Currency
  flag: string
  regionLabel: string
  regions: string[]
  postalLabel: string
  postalRegex: RegExp
  compliance: string
}

export const COUNTRIES: Record<CountryCode, Country> = {
  US: {
    code: 'US',
    label: 'United States',
    currency: 'USD',
    flag: '🇺🇸',
    regionLabel: 'State',
    regions: ['TX', 'CA', 'FL', 'AZ', 'CO', 'NC', 'GA', 'NY', 'IL', 'OH'],
    postalLabel: 'ZIP code',
    postalRegex: /^\d{5}$/,
    compliance: 'CCPA / TCPA / CAN-SPAM apply. Honor opt-outs and consent.',
  },
  CA: {
    code: 'CA',
    label: 'Canada',
    currency: 'CAD',
    flag: '🇨🇦',
    regionLabel: 'Province',
    regions: ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB'],
    postalLabel: 'Postal code',
    postalRegex: /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/,
    compliance: 'PIPEDA / CASL apply. Express consent required for CEMs.',
  },
  GB: {
    code: 'GB',
    label: 'United Kingdom',
    currency: 'GBP',
    flag: '🇬🇧',
    regionLabel: 'County',
    regions: ['Greater London', 'West Midlands', 'Greater Manchester', 'Kent', 'Essex', 'Surrey'],
    postalLabel: 'Postcode',
    postalRegex: /^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$/,
    compliance: 'UK GDPR / PECR apply. Lawful basis required for marketing.',
  },
}

export function formatMoney(
  cents: number | null | undefined,
  currency: Currency = 'USD',
  opts: { fromCents?: boolean } = {},
): string {
  if (cents == null) return '—'
  const value = opts.fromCents === false ? cents : cents / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: value < 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function validatePostal(value: string, country: CountryCode): boolean {
  return COUNTRIES[country].postalRegex.test(value.trim())
}
