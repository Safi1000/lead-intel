/** White-label theming engine (§I-5). Runtime CSS-var injection. */

export interface TenantTheme {
  brandName: string
  primary: string
  signal: string
  logoText: string
  supportEmail: string
}

export const DEFAULT_THEME: TenantTheme = {
  brandName: 'LeadIntel',
  primary: '#9a1750',
  signal: '#ee4c7c',
  logoText: 'Li',
  supportEmail: 'support@techexcel.io',
}

/** Inject a tenant theme into CSS variables (pre-paint where possible). */
export function applyTheme(theme: Partial<TenantTheme>) {
  const root = document.documentElement
  if (theme.primary) {
    root.style.setProperty('--color-primary', theme.primary)
    root.style.setProperty('--color-primary-hover', shade(theme.primary, -12))
    root.style.setProperty('--color-admin', theme.primary)
  }
  if (theme.signal) root.style.setProperty('--color-signal', theme.signal)
}

export function resetTheme() {
  // Revert to the CSS-var tokens so the per-mode (light/dark) brand palette governs again.
  const root = document.documentElement
  for (const v of ['--color-primary', '--color-primary-hover', '--color-admin', '--color-signal']) {
    root.style.removeProperty(v)
  }
}

function shade(hex: string, percent: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, Math.min(255, (n >> 16) + Math.round((255 * percent) / 100)))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + Math.round((255 * percent) / 100)))
  const b = Math.max(0, Math.min(255, (n & 0xff) + Math.round((255 * percent) / 100)))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
