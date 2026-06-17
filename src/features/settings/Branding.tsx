import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Globe, RotateCcw } from 'lucide-react'
import { Button, Card, Input, Label, Badge } from '../../components/ui/primitives'
import { Can } from '../../components/rbac/Can'
import { applyTheme, resetTheme, DEFAULT_THEME, type TenantTheme } from '../../lib/theming'
import { cn } from '../../lib/utils'

interface DnsRecord {
  type: string
  host: string
  value: string
}

const DNS_RECORDS: DnsRecord[] = [
  { type: 'CNAME', host: 'app', value: 'cname.leadintel.io' },
  { type: 'TXT', host: '_leadintel', value: 'leadintel-verify=8f3a91c2' },
]

export function BrandingSettingsPage() {
  const [theme, setTheme] = useState<TenantTheme>(DEFAULT_THEME)
  const [domain, setDomain] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  function update<K extends keyof TenantTheme>(key: K, value: TenantTheme[K]) {
    setTheme((t) => {
      const next = { ...t, [key]: value }
      if (key === 'primary' || key === 'signal') {
        applyTheme({ primary: next.primary, signal: next.signal })
      }
      return next
    })
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value)
    setCopied(value)
    setTimeout(() => setCopied(null), 1200)
  }

  function save() {
    toast.success('Branding saved')
  }

  function reset() {
    resetTheme()
    setTheme(DEFAULT_THEME)
    toast.success('Reset to default theme')
  }

  return (
    <div className="reveal grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <div className="border-b border-[var(--color-border)] px-6 py-4">
            <h2 className="text-[16px] font-semibold">Brand identity</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">White-label the app for your clients.</p>
          </div>
          <Can action="manage" resource="branding" disable>
            <div className="space-y-4 px-6 py-5">
              <div>
                <Label htmlFor="brand-name">Brand name</Label>
                <Input id="brand-name" value={theme.brandName} onChange={(e) => update('brandName', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="brand-logo">Logo text (2 characters)</Label>
                <Input id="brand-logo" maxLength={2} value={theme.logoText} onChange={(e) => update('logoText', e.target.value.slice(0, 2))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="brand-primary">Primary color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="brand-primary"
                      type="color"
                      value={theme.primary}
                      onChange={(e) => update('primary', e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded-[8px] border border-[var(--color-border)] bg-transparent"
                    />
                    <span className="font-data text-[13px] text-[var(--color-text-secondary)]">{theme.primary}</span>
                  </div>
                </div>
                <div>
                  <Label htmlFor="brand-signal">Signal / accent color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="brand-signal"
                      type="color"
                      value={theme.signal}
                      onChange={(e) => update('signal', e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded-[8px] border border-[var(--color-border)] bg-transparent"
                    />
                    <span className="font-data text-[13px] text-[var(--color-text-secondary)]">{theme.signal}</span>
                  </div>
                </div>
              </div>
              <div>
                <Label htmlFor="brand-email">Support email</Label>
                <Input id="brand-email" type="email" value={theme.supportEmail} onChange={(e) => update('supportEmail', e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset to default
              </Button>
              <Button onClick={save}>Save branding</Button>
            </div>
          </Can>
        </Card>

        <Card>
          <div className="border-b border-[var(--color-border)] px-6 py-4">
            <h2 className="text-[16px] font-semibold">Custom domain</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">Serve the app from your own domain.</p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div>
              <Label htmlFor="brand-domain">Domain</Label>
              <Input id="brand-domain" value={domain} placeholder="app.yourbrand.com" onChange={(e) => setDomain(e.target.value)} />
            </div>
            <div>
              <p className="mb-2 text-[13px] font-medium text-[var(--color-text)]">DNS records to set</p>
              <div className="overflow-hidden rounded-[8px] border border-[var(--color-border)]">
                <div className="grid grid-cols-[0.6fr_0.8fr_1.6fr_auto] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  <span>Type</span><span>Host</span><span>Value</span><span />
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {DNS_RECORDS.map((r) => (
                    <div key={r.type} className="grid grid-cols-[0.6fr_0.8fr_1.6fr_auto] items-center gap-3 px-3 py-2 text-[13px]">
                      <span className="font-data text-[var(--color-text)]">{r.type}</span>
                      <span className="font-data text-[var(--color-text-secondary)]">{r.host}</span>
                      <span className="font-data truncate text-[var(--color-text-secondary)]">{r.value}</span>
                      <button onClick={() => copy(r.value)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        {copied === r.value ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Badge className="bg-amber-50 text-amber-700">Verification: Pending</Badge>
              <Button variant="outline" size="sm" onClick={() => toast('Verification still pending — DNS can take up to 24h to propagate.')}>
                <Globe className="h-3.5 w-3.5" /> Check status
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div>
        <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Live preview</p>
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3" style={{ background: theme.primary }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/20 text-[13px] font-bold text-white">{theme.logoText || 'Li'}</span>
            <span className="text-[15px] font-semibold text-white">{theme.brandName || 'LeadIntel'}</span>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Leads</p>
                <p className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: theme.primary }}>1,284</p>
              </div>
              <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Live now</p>
                <p className="mt-1 flex items-center gap-1.5 text-[24px] font-bold tabular-nums">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: theme.signal }} />
                  7
                </p>
              </div>
            </div>
            <button
              className={cn('w-full rounded-[8px] px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90')}
              style={{ background: theme.primary }}
            >
              New run
            </button>
            <p className="text-[12px] text-[var(--color-text-muted)]">Support: {theme.supportEmail || DEFAULT_THEME.supportEmail}</p>
          </div>
        </Card>
      </div>
    </div>
  )
}
