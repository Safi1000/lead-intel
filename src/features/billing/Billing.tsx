import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Check, CreditCard, Download, Plus } from 'lucide-react'
import { billingApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { formatMoney } from '../../lib/i18n'
import { formatNumber, cn } from '../../lib/utils'
import { shortDate } from '../../lib/time'
import { Badge, Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { CardSkeleton, ErrorState } from '../../components/feedback'
import { ProgressBar, SectionCard } from '../shared/bits'
import { Can } from '../../components/rbac/Can'
import type { Currency } from '../../lib/i18n'
import type { BillingState, Invoice, PaymentMethod, PlanTier } from '../../api/types'
import { MarketLocksPanel } from './MarketLocks'

const BILLING_REASON = 'Requires billing or owner role'

export function BillingSettingsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['billing'],
    queryFn: () => billingApi.get(),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
  }
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />

  const usedRatio = data.included_credits > 0 ? data.used_credits / data.included_credits : 0
  const lowBalance = usedRatio >= 0.8

  return (
    <div className="reveal space-y-6">
      {lowBalance && (
        <div className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Low credit balance</p>
            <p>
              You’ve used {Math.round(usedRatio * 100)}% of your included credits. Buy more credits to avoid
              interruptions to lead delivery.
            </p>
          </div>
        </div>
      )}

      <PlanSection billing={data} />
      <CreditsSection billing={data} lowBalance={lowBalance} />
      <PaymentMethodsSection methods={data.payment_methods} />
      <InvoicesSection invoices={data.invoices} currency={data.currency} />
      <MarketLocksPanel />
    </div>
  )
}

function PlanSection({ billing }: { billing: BillingState }) {
  const qc = useQueryClient()
  const changeTier = useMutation({
    mutationFn: (tier: string) => billingApi.changeTier(tier),
    onSuccess: () => {
      toast.success('Subscription updated')
      qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  return (
    <SectionCard title="Plan">
      <div className="grid gap-4 p-5 md:grid-cols-3">
        {billing.tiers.map((tier) => (
          <PlanCard
            key={tier.id}
            tier={tier}
            currency={billing.currency}
            loading={changeTier.isPending && changeTier.variables === tier.id}
            disabled={changeTier.isPending}
            onSelect={() => changeTier.mutate(tier.id)}
          />
        ))}
      </div>
    </SectionCard>
  )
}

function PlanCard({
  tier,
  currency,
  loading,
  disabled,
  onSelect,
}: {
  tier: PlanTier
  currency: Currency
  loading: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const current = !!tier.current
  return (
    <div
      className={cn(
        'flex flex-col rounded-[12px] border p-5',
        current ? 'border-[var(--color-primary)] bg-blue-50/40 ring-1 ring-[var(--color-primary)]' : 'border-[var(--color-border)]',
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold text-[var(--color-text)]">{tier.name}</h3>
        {current && (
          <Badge className="bg-[var(--color-primary)] text-white">
            <Check className="h-3 w-3" /> Current
          </Badge>
        )}
      </div>
      <p className="mt-2 text-[24px] font-bold tabular-nums text-[var(--color-text)]">
        {formatMoney(tier.price_cents, currency)}
        <span className="text-[13px] font-normal text-[var(--color-text-muted)]">/mo</span>
      </p>
      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
        {formatNumber(tier.included_credits)} credits included
      </p>
      <ul className="mt-4 flex-1 space-y-2">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13px] text-[var(--color-text-secondary)]">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--c-verified)]" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <Can action="manage" resource="billing" disable reason={BILLING_REASON}>
          <Button
            variant={current ? 'outline' : 'primary'}
            className="w-full"
            loading={loading}
            disabled={current || disabled}
            onClick={onSelect}
          >
            {current ? 'Current plan' : 'Switch to this plan'}
          </Button>
        </Can>
      </div>
    </div>
  )
}

function CreditsSection({ billing, lowBalance }: { billing: BillingState; lowBalance: boolean }) {
  const [open, setOpen] = useState(false)
  const usedRatio = billing.included_credits > 0 ? billing.used_credits / billing.included_credits : 0

  return (
    <SectionCard
      title="Credit balance"
      action={
        <Can action="manage" resource="billing" disable reason={BILLING_REASON}>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Buy credits
          </Button>
        </Can>
      }
    >
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">Balance</p>
          <p className="mt-1 text-[24px] font-bold tabular-nums text-[var(--color-text)]">
            {formatNumber(billing.balance_credits)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">Included</p>
          <p className="mt-1 text-[24px] font-bold tabular-nums text-[var(--color-text)]">
            {formatNumber(billing.included_credits)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">Used</p>
          <p className={cn('mt-1 text-[24px] font-bold tabular-nums', lowBalance ? 'text-[var(--c-unverified)]' : 'text-[var(--color-text)]')}>
            {formatNumber(billing.used_credits)}
          </p>
        </Card>
      </div>
      <div className="px-5 pb-5">
        <div className="mb-1.5 flex items-center justify-between text-[13px] text-[var(--color-text-secondary)]">
          <span>{Math.round(usedRatio * 100)}% of included credits used</span>
          <span className="tabular-nums">
            {formatNumber(billing.used_credits)} / {formatNumber(billing.included_credits)}
          </span>
        </div>
        <ProgressBar value={usedRatio} />
      </div>
      <BuyCreditsModal open={open} onOpenChange={setOpen} currency={billing.currency} />
    </SectionCard>
  )
}

const CREDIT_PACKS = [1000, 5000, 10000]

function BuyCreditsModal({
  open,
  onOpenChange,
  currency,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  currency: Currency
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState(5000)

  const buy = useMutation({
    mutationFn: () => billingApi.buyCredits(amount),
    onSuccess: () => {
      toast.success(`${formatNumber(amount)} credits added`)
      onOpenChange(false)
      qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  // Demo pricing: 1 credit ≈ 10 cents.
  const priceCents = amount * 10

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buy credits"
      description="Top up your balance. Credits never expire."
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {CREDIT_PACKS.map((pack) => (
            <button
              key={pack}
              onClick={() => setAmount(pack)}
              className={cn(
                'rounded-[12px] border p-4 text-center transition-colors',
                amount === pack ? 'border-[var(--color-primary)] bg-blue-50' : 'border-[var(--color-border)] hover:border-slate-300',
              )}
            >
              <p className="text-[18px] font-bold tabular-nums text-[var(--color-text)]">{formatNumber(pack)}</p>
              <p className="text-[12px] text-[var(--color-text-muted)]">{formatMoney(pack * 10, currency)}</p>
            </button>
          ))}
        </div>

        <DemoCardForm />

        <div className="flex items-center justify-between rounded-[8px] bg-slate-50 px-4 py-3">
          <span className="text-sm font-medium text-[var(--color-text)]">Total</span>
          <span className="text-[18px] font-bold tabular-nums">{formatMoney(priceCents, currency)}</span>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Can action="manage" resource="billing" disable reason={BILLING_REASON}>
            <Button loading={buy.isPending} onClick={() => buy.mutate()}>
              Confirm purchase
            </Button>
          </Can>
        </div>
      </div>
    </Dialog>
  )
}

/** Clearly-labeled simulated card form — no real Stripe. */
function DemoCardForm() {
  const [number, setNumber] = useState('4242 4242 4242 4242')
  const [exp, setExp] = useState('12 / 28')
  const [cvc, setCvc] = useState('123')
  return (
    <div className="rounded-[12px] border border-dashed border-[var(--color-border)] p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        <CreditCard className="h-4 w-4" /> Card details
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Demo</span>
      </div>
      <div className="space-y-3">
        <div>
          <Label htmlFor="demo-card-number">Card number</Label>
          <Input
            id="demo-card-number"
            value={number}
            inputMode="numeric"
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="demo-card-exp">Expiry</Label>
            <Input id="demo-card-exp" value={exp} onChange={(e) => setExp(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="demo-card-cvc">CVC</Label>
            <Input id="demo-card-cvc" value={cvc} inputMode="numeric" onChange={(e) => setCvc(e.target.value)} />
          </div>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
        Simulated payment — no card is charged.
      </p>
    </div>
  )
}

function PaymentMethodsSection({ methods }: { methods: PaymentMethod[] }) {
  const [open, setOpen] = useState(false)
  return (
    <SectionCard
      title="Payment methods"
      action={
        <Can action="manage" resource="billing" disable reason={BILLING_REASON}>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add payment method
          </Button>
        </Can>
      }
    >
      {methods.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">No payment methods on file.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {methods.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-12 items-center justify-center rounded-[6px] border border-[var(--color-border)] bg-slate-50">
                  <CreditCard className="h-4 w-4 text-[var(--color-text-secondary)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {m.brand} •••• {m.last4}
                  </p>
                  <p className="text-[13px] text-[var(--color-text-muted)]">Expires {m.exp}</p>
                </div>
              </div>
              {m.default && (
                <Badge className="bg-slate-100 text-[var(--color-text-secondary)]">Default</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddPaymentMethodModal open={open} onOpenChange={setOpen} />
    </SectionCard>
  )
}

function AddPaymentMethodModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  function submit() {
    toast.success('Payment method added (demo)')
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add payment method"
      description="Enter card details to add a payment method."
    >
      <div className="space-y-4">
        <DemoCardForm />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Add card</Button>
        </div>
      </div>
    </Dialog>
  )
}

const INVOICE_STATUS: Record<Invoice['status'], string> = {
  paid: 'bg-green-50 text-green-700',
  open: 'bg-amber-50 text-amber-700',
  void: 'bg-slate-100 text-slate-500',
}

function InvoicesSection({ invoices, currency }: { invoices: Invoice[]; currency: Currency }) {
  return (
    <SectionCard title="Invoices">
      {invoices.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">No invoices yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-5 py-2.5 font-medium">Number</th>
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 font-medium">Amount</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-5 py-3 font-mono text-[13px] text-[var(--color-text)]">{inv.number}</td>
                  <td className="px-5 py-3 text-[var(--color-text-secondary)]">{shortDate(inv.date)}</td>
                  <td className="px-5 py-3 tabular-nums text-[var(--color-text)]">
                    {formatMoney(inv.amount_cents, currency)}
                  </td>
                  <td className="px-5 py-3">
                    <Badge className={INVOICE_STATUS[inv.status]}>{inv.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toast.success(`Downloading ${inv.number} (demo)`)}
                    >
                      <Download className="h-4 w-4" /> PDF
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
