import { Card } from '../../components/ui/primitives'

/** Public setup guide for the HubSpot integration — linked from the HubSpot marketplace listing. */
export function HubSpotSetupPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Card className="p-8">
        <h1 className="text-[26px] font-bold tracking-tight">Connect LeadIntel to HubSpot</h1>
        <p className="mt-2 text-[var(--color-text-secondary)]">
          Sync your qualified leads from LeadIntel straight into HubSpot as contacts — no CSV exports, no copy-paste.
        </p>

        <h2 className="mt-8 text-[17px] font-semibold">Before you start</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-text-secondary)]">
          <li>A LeadIntel account with the <strong>Manager</strong> or <strong>Owner</strong> role.</li>
          <li>A HubSpot account you can log into and approve app access for.</li>
        </ul>

        <h2 className="mt-8 text-[17px] font-semibold">Connect your account (one-time)</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
          <li>In LeadIntel, open <strong>Settings → CRM</strong>.</li>
          <li>Click <strong>Connect</strong> next to HubSpot.</li>
          <li>In the HubSpot pop-up, choose your account and click <strong>Connect app</strong> to approve access to your contacts.</li>
          <li>The window closes and HubSpot shows as <strong>Connected</strong>. That’s it.</li>
        </ol>

        <h2 className="mt-8 text-[17px] font-semibold">Send leads to HubSpot</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
          <li><strong>One lead:</strong> open a lead and click <strong>Send to CRM</strong>.</li>
          <li><strong>A whole batch:</strong> select leads (or “select all”) and click <strong>Send to CRM</strong>.</li>
          <li><strong>Automatically:</strong> in Settings → CRM, turn on <strong>“Auto-sync every new qualified lead”</strong> so new leads flow into HubSpot on their own. You can also include cold leads.</li>
        </ul>
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          Each lead becomes a HubSpot contact with its business name, email, phone, website, and city. LeadIntel remembers what’s already been sent, so leads are never duplicated.
        </p>

        <h2 className="mt-8 text-[17px] font-semibold">Disconnect</h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Go to <strong>Settings → CRM</strong> and click <strong>Disconnect</strong> at any time. You can also remove access from within HubSpot under <em>Connected Apps</em>.
        </p>

        <h2 className="mt-8 text-[17px] font-semibold">Need help?</h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Email <a className="text-[var(--color-primary)] hover:underline" href="mailto:support@techxserve.com">support@techxserve.com</a> and we’ll help you get set up.
        </p>
      </Card>
    </div>
  )
}
