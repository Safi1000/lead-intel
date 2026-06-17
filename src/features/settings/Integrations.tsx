import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Cloud, Database, MessageCircle, Send, Sheet, Zap } from 'lucide-react'
import { integrationsApi } from '../../api/endpoints'
import { Button, Input, Label } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { ConnectorCard } from '../integrations/ConnectorCard'
import type { Integration } from '../../api/types'

interface Connector {
  provider: string
  name: string
  description: string
  icon: React.ReactNode
  group: 'CRM' | 'Delivery & automation' | 'Messaging'
}

const CONNECTORS: Connector[] = [
  { provider: 'hubspot', name: 'HubSpot', description: 'Push leads into HubSpot contacts & companies.', icon: <Database className="h-5 w-5 text-[var(--color-primary)]" />, group: 'CRM' },
  { provider: 'salesforce', name: 'Salesforce', description: 'Sync enriched leads to Salesforce.', icon: <Cloud className="h-5 w-5 text-[var(--color-primary)]" />, group: 'CRM' },
  { provider: 'pipedrive', name: 'Pipedrive', description: 'Create deals & persons in Pipedrive.', icon: <Database className="h-5 w-5 text-[var(--color-primary)]" />, group: 'CRM' },
  { provider: 'gohighlevel', name: 'Go High Level', description: 'Send contacts into GHL sub-accounts.', icon: <Cloud className="h-5 w-5 text-[var(--color-primary)]" />, group: 'CRM' },
  { provider: 'keap', name: 'Keap', description: 'Push leads to Keap (Infusionsoft).', icon: <Database className="h-5 w-5 text-[var(--color-primary)]" />, group: 'CRM' },
  { provider: 'zoho', name: 'Zoho CRM', description: 'Sync leads to Zoho CRM modules.', icon: <Cloud className="h-5 w-5 text-[var(--color-primary)]" />, group: 'CRM' },
  { provider: 'google-sheets', name: 'Google Sheets', description: 'Append delivered leads to a sheet.', icon: <Sheet className="h-5 w-5 text-[var(--color-primary)]" />, group: 'Delivery & automation' },
  { provider: 'zapier', name: 'Zapier / Make', description: 'Trigger automations on new leads.', icon: <Zap className="h-5 w-5 text-[var(--color-primary)]" />, group: 'Delivery & automation' },
  { provider: 'whatsapp', name: 'WhatsApp Business', description: 'Message leads from WhatsApp Business.', icon: <MessageCircle className="h-5 w-5 text-[var(--color-primary)]" />, group: 'Messaging' },
]

const GROUPS: Connector['group'][] = ['CRM', 'Delivery & automation', 'Messaging']

const MAP_FIELDS: { key: string; label: string }[] = [
  { key: 'business_name', label: 'Business name' },
  { key: 'owner_name', label: 'Owner name' },
  { key: 'owner_phone', label: 'Owner phone' },
  { key: 'email', label: 'Email' },
]

export function IntegrationsSettingsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
  })
  const [configuring, setConfiguring] = useState<Connector | null>(null)

  if (isLoading) return <LoadingState label="Loading integrations…" />
  if (isError) return <ErrorState message="We couldn’t load your integrations." onRetry={() => refetch()} />
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Cloud}
        title="No integrations yet"
        message="Connect a CRM, delivery destination, or messaging channel to start pushing leads automatically."
      />
    )
  }

  const stateFor = (provider: string): Integration | undefined => data.find((i) => i.provider === provider)

  return (
    <div className="reveal space-y-8">
      {GROUPS.map((group) => {
        const items = CONNECTORS.filter((c) => c.group === group)
        return (
          <section key={group}>
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{group}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((c) => {
                const state = stateFor(c.provider)
                const connected = state?.status === 'connected'
                return (
                  <ConnectorCard
                    key={c.provider}
                    provider={c.provider}
                    name={c.name}
                    description={c.description}
                    icon={c.icon}
                    state={state}
                    onConfigure={connected ? () => setConfiguring(c) : undefined}
                  />
                )
              })}
            </div>
          </section>
        )
      })}

      {configuring && (
        <MappingDialog
          connector={configuring}
          state={stateFor(configuring.provider)}
          onClose={() => setConfiguring(null)}
        />
      )}
    </div>
  )
}

function MappingDialog({ connector, state, onClose }: { connector: Connector; state?: Integration; onClose: () => void }) {
  const qc = useQueryClient()
  const [map, setMap] = useState<Record<string, string>>(() => ({
    business_name: state?.mapping?.business_name ?? '',
    owner_name: state?.mapping?.owner_name ?? '',
    owner_phone: state?.mapping?.owner_phone ?? '',
    email: state?.mapping?.email ?? '',
  }))
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null)

  const save = useMutation({
    mutationFn: () => integrationsApi.setMapping(connector.provider, map),
    onSuccess: () => {
      toast.success(`${connector.name} field mapping saved`)
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: () => toast.error('Couldn’t save mapping'),
  })

  const test = useMutation({
    mutationFn: () => integrationsApi.test(connector.provider),
    onSuccess: (r) => {
      setResult(r)
      toast.success('Test push complete')
    },
    onError: () => toast.error('Test push failed'),
  })

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Configure ${connector.name}`}
      description="Map LeadIntel lead fields to properties in your destination."
    >
      <div className="space-y-3">
        {MAP_FIELDS.map((f) => (
          <div key={f.key} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="text-sm text-[var(--color-text)]">{f.label}</span>
            <span className="text-[var(--color-text-muted)]">→</span>
            <div>
              <Label htmlFor={`map-${f.key}`} className="sr-only">{f.label} property</Label>
              <Input
                id={`map-${f.key}`}
                value={map[f.key]}
                placeholder="CRM property"
                onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </div>

      {result && (
        <div className="mt-4 flex gap-4 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-[13px]">
          <span className="text-[var(--c-verified-text)]">{result.created} created</span>
          <span className="text-[var(--color-primary)]">{result.updated} updated</span>
          <span className="text-[var(--color-text-muted)]">{result.skipped} skipped</span>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-2">
        <Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
          <Send className="h-3.5 w-3.5" /> Test push
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  )
}
