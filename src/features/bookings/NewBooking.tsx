import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CalendarCheck, ChevronDown, ChevronRight, CircleCheck, CircleX, ExternalLink, Hash, Loader2, ArrowRight,
} from 'lucide-react'
import { bookingsApi, type AeBookingConfig } from '../../api/bookings'
import { manualLeadsApi, leadBatchesApi } from '../../api/endpoints'
import { useAuth } from '../../hooks'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { CopyButton } from './components'
import { cn } from '../../lib/utils'

/** Values we auto-fill into the Cal.com booking form so the setter doesn't
 *  hand-type them. The client name/email come from the CRM lead; setter name +
 *  CRM Lead ID are known from context. Custom fields prefill by their Cal.com
 *  field identifier — set those identifiers to: setter-name, lead-source, crm-lead-id. */
interface Prefill {
  name?: string
  email?: string
  setterName?: string
  leadSource?: string
  crmLeadId?: string
}

/** Build the Cal.com booking URL with the lead's details prefilled as query
 *  params. Cal reads these from the URL and they override the booker's session.
 *  Returns null if the AE has no valid scheduling URL. */
function buildCalUrl(url: string, prefill: Prefill): string | null {
  let parsed: URL | null = null
  try { parsed = url ? new URL(url) : null } catch { parsed = null }
  if (!parsed) return null
  const p = parsed.searchParams
  if (prefill.name) p.set('name', prefill.name)
  p.set('email', prefill.email ?? '') // explicit blank so Cal doesn't use the booker's session email
  if (prefill.setterName) p.set('setter-name', prefill.setterName)
  if (prefill.leadSource) p.set('lead-source', prefill.leadSource)
  if (prefill.crmLeadId) p.set('crm-lead-id', prefill.crmLeadId)
  return parsed.toString()
}

/**
 * Booking launcher (production). Opens the AE's Cal.com page in a NEW TAB rather
 * than embedding it. Inline embedding (embed.js / iframe) is blocked in some
 * regions by Cal's Cloudflare bot-challenge on the embed script — a top-level
 * navigation can solve that challenge, a subresource embed cannot. The booked
 * meeting still flows back to the AE via the webhook.
 */
function CalBookingLauncher({ url, prefill, onScheduled }: { url: string; prefill: Prefill; onScheduled: () => void }) {
  const [opened, setOpened] = useState(false)
  const bookingUrl = buildCalUrl(url, prefill)

  if (!bookingUrl) {
    return (
      <div className="rounded-[10px] border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800">
        <p className="font-medium">Scheduling unavailable</p>
        <p className="mt-1">This AE has no scheduling URL configured. Set CAL_AE_&lt;ID&gt;_URL in Vercel (e.g. https://cal.com/hamna/30min) and redeploy.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Click below to open the calendar in a new tab. The client’s details are pre-filled — just pick a time the
        client confirmed and submit.
      </p>
      <a href={bookingUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>
        <Button size="lg"><CalendarCheck className="h-5 w-5" /> Open booking page <ExternalLink className="h-4 w-4" /></Button>
      </a>

      {opened && (
        <div className="rounded-[10px] border border-[var(--color-border)] bg-slate-50/60 p-4">
          <p className="text-sm text-[var(--color-text)]">Once you’ve booked the meeting in the other tab, confirm here:</p>
          <Button className="mt-3" variant="outline" onClick={onScheduled}>
            <CircleCheck className="h-4 w-4 text-[var(--c-verified)]" /> I’ve booked it
          </Button>
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">It’ll appear on the AE’s Meetings page shortly either way.</p>
        </div>
      )}
    </div>
  )
}

/** Demo embed — the mock build can't run the real Cal.com widget, so we
 *  simulate the exact booking outcome (creates a meeting on the AE side). */
function DemoEmbed({
  ae,
  prefill,
  onScheduled,
}: {
  ae: AeBookingConfig
  prefill: Prefill
  onScheduled: () => void
}) {
  const [inviteeName, setInviteeName] = useState(prefill.name ?? '')
  const [inviteeEmail, setInviteeEmail] = useState(prefill.email ?? '')
  const [leadSource, setLeadSource] = useState(prefill.leadSource ?? '')
  const [context, setContext] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!inviteeEmail.trim()) {
      toast.error('Enter the client’s email (paste it from the CRM).')
      return
    }
    setSubmitting(true)
    try {
      await bookingsApi.simulateBooking({
        aeId: ae.aeId,
        inviteeName: inviteeName.trim() || 'Client',
        inviteeEmail: inviteeEmail.trim(),
        setterName: prefill.setterName,
        leadSource: leadSource.trim() || undefined,
        context: context.trim() || undefined,
        crmLeadId: prefill.crmLeadId,
      })
      onScheduled()
    } catch {
      toast.error('Could not complete the simulated booking.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-[10px] border border-dashed border-[var(--color-border)] bg-slate-50/60 p-4">
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        <span className="font-medium text-[var(--color-text)]">Demo mode.</span> In production the AE’s live
        Cal.com widget renders here. This panel simulates the same booking so you can see it flow through to
        the AE’s Meetings page.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="inv-name">Client name</Label>
          <Input id="inv-name" value={inviteeName} onChange={(e) => setInviteeName(e.target.value)} placeholder="Tom Halloran" />
        </div>
        <div>
          <Label htmlFor="inv-email">Client email (paste from CRM)</Label>
          <Input id="inv-email" value={inviteeEmail} onChange={(e) => setInviteeEmail(e.target.value)} placeholder="tom@example.com" />
        </div>
        <div>
          <Label htmlFor="inv-source">Lead source</Label>
          <Input id="inv-source" value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="Facebook Ad" />
        </div>
        <div>
          <Label htmlFor="inv-ctx">1-line context</Label>
          <Input id="inv-ctx" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Pain + what you promised" />
        </div>
      </div>
      <Button onClick={submit} loading={submitting}>
        <CalendarCheck className="h-4 w-4" /> Simulate booking confirmation
      </Button>
    </div>
  )
}

const GUIDE_SECTIONS = [
  {
    title: 'Before you book',
    steps: [
      'Confirm you’re speaking to the decision-maker and they’ve agreed to a time.',
      'Pick the correct AE (territory / product / availability).',
    ],
  },
  {
    title: 'Booking steps',
    steps: [
      'In the widget, choose a slot the client confirmed.',
      'Enter the client’s name and email — paste the email from the CRM, don’t type it.',
      'Fill the custom questions: Setter name · Lead source · CRM Lead ID (paste) · 1-line context.',
      'Submit and wait for the confirmation before closing.',
    ],
  },
  {
    title: 'After booking',
    steps: [
      'The meeting appears on the AE’s Meetings page automatically after the next sync (up to ~2 min).',
      'Mark the lead Meeting Booked in the CRM if your workflow still requires it.',
    ],
  },
]

function SetterGuide() {
  const [open, setOpen] = useState(true)
  return (
    <Card className="p-4 sm:p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="text-[15px] font-semibold text-[var(--color-text)]">Setter guide</span>
        {open ? <ChevronDown className="h-4 w-4 text-[var(--color-text-muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)]" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {GUIDE_SECTIONS.map((sec) => (
            <div key={sec.title}>
              <h3 className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{sec.title}</h3>
              <ol className="space-y-1.5">
                {sec.steps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-sm text-[var(--color-text-secondary)]">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}

          <div className="rounded-[10px] bg-slate-50 p-3">
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Quick do / don’t</p>
            <ul className="space-y-1 text-[13px]">
              {['Paste the client’s real email', 'Always include the CRM Lead ID', 'Write one line of context'].map((t) => (
                <li key={t} className="flex items-center gap-1.5 text-[var(--color-text)]"><CircleCheck className="h-3.5 w-3.5 text-[var(--c-verified)]" /> {t}</li>
              ))}
              {['Don’t use your own email', 'Don’t book without consent', 'Don’t leave the context blank'].map((t) => (
                <li key={t} className="flex items-center gap-1.5 text-[var(--color-text)]"><CircleX className="h-3.5 w-3.5 text-[var(--c-unverified)]" /> {t}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  )
}

export function NewBookingPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const crmLeadId = params.get('leadId') || params.get('crmLeadId') || undefined

  const { data: aes, isLoading, isError, refetch } = useQuery({ queryKey: ['bookings', 'ae-configs'], queryFn: bookingsApi.listAeConfigs })
  const [aeId, setAeId] = useState<string>('')
  const [booked, setBooked] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pull the CRM lead (when started from one) to prefill the booking form.
  const leadQ = useQuery({
    queryKey: ['manual-lead', crmLeadId],
    queryFn: () => manualLeadsApi.get(crmLeadId as string),
    enabled: Boolean(crmLeadId),
  })
  // Lead Source = whoever uploaded the lead's batch (batch.created_by).
  const batchId = leadQ.data?.batch_id ?? undefined
  const batchQ = useQuery({
    queryKey: ['lead-batch', batchId],
    queryFn: () => leadBatchesApi.get(batchId as string),
    enabled: Boolean(batchId),
  })
  const prefill = useMemo<Prefill>(() => {
    const d = leadQ.data?.data ?? {}
    const entries = Object.entries(d).map(([k, v]) => [k, String(v ?? '').trim()] as const).filter(([, v]) => v)
    // First value whose COLUMN NAME matches a pattern (case-insensitive).
    const byKey = (re: RegExp) => entries.find(([k]) => re.test(k))?.[1]
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    // Email: any column whose name contains "email" (Email, E-mail, Owner Email,
    // Email Address, Contact Email…), else any cell that simply looks like an email.
    let email = byKey(/e-?\s*mail/i)
    if (!email || !emailRe.test(email)) email = entries.map(([, v]) => v).find((v) => emailRe.test(v))
    email = email && emailRe.test(email) ? email : undefined

    const name = leadQ.data?.display_name || byKey(/owner|contact|name|company|business/i)

    return {
      name,
      email,
      // Source = the batch uploader; fall back to a Lead Source column if present.
      leadSource: batchQ.data?.created_by || byKey(/lead\s*source|source/i) || undefined,
      setterName: user?.name ?? undefined,
      crmLeadId,
    }
  }, [leadQ.data, batchQ.data, user?.name, crmLeadId])
  const prefillLoading = Boolean(crmLeadId) && (leadQ.isLoading || (Boolean(batchId) && batchQ.isLoading))

  // Default to the first AE once configs load.
  useEffect(() => {
    if (!aeId && aes && aes.length > 0) setAeId(aes[0].aeId)
  }, [aes, aeId])

  const ae = aes?.find((a) => a.aeId === aeId)

  const onScheduled = useCallback(() => {
    setBooked(true)
    toast.success('Meeting booked — it will appear on the AE’s Meetings page shortly.')
    qc.invalidateQueries({ queryKey: ['bookings'] })
  }, [qc])

  return (
    <div className="reveal">
      <PageHeader title="Book a meeting" subtitle="Schedule a call for the right AE and capture the context they need to prep." />

      {isLoading ? (
        <LoadingState />
      ) : isError || !aes ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]" ref={scrollRef}>
          {/* Left — AE selector + embed */}
          <div className="space-y-4">
            <Card className="p-4 sm:p-5">
              <Label htmlFor="ae-select">Account Executive</Label>
              <div className="flex flex-wrap gap-2">
                {aes.map((a) => (
                  <button
                    key={a.aeId}
                    type="button"
                    onClick={() => { setAeId(a.aeId); setBooked(false) }}
                    className={cn(
                      'rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors',
                      a.aeId === aeId
                        ? 'border-[var(--color-primary)] bg-blue-50 text-[var(--color-primary)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-slate-50',
                    )}
                  >
                    {a.aeName}
                  </button>
                ))}
              </div>

              {crmLeadId && (
                <div className="mt-4 flex items-center justify-between gap-2 rounded-[10px] border border-blue-100 bg-blue-50/60 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Hash className="h-4 w-4 text-[var(--color-primary)]" />
                    <span className="text-[var(--color-text-secondary)]">CRM Lead ID (auto-filled — copy if you need to re-enter it):</span>
                    <span className="font-mono font-semibold text-[var(--color-text)]">{crmLeadId}</span>
                  </div>
                  <CopyButton text={crmLeadId} label="Copy" />
                </div>
              )}
            </Card>

            <Card className="p-4 sm:p-5">
              {booked ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
                    <CircleCheck className="h-7 w-7 text-[var(--c-verified)]" />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold text-[var(--color-text)]">Meeting booked</h3>
                    <p className="mt-1 max-w-sm text-sm text-[var(--color-text-secondary)]">
                      It will appear on {ae?.aeName ?? 'the AE'}’s Meetings page after the next sync (~2 min).
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setBooked(false)}>Book another</Button>
                    <Link to="/bookings"><Button variant="ghost">View meetings <ArrowRight className="h-4 w-4" /></Button></Link>
                  </div>
                </div>
              ) : !ae ? (
                <p className="py-8 text-center text-sm text-[var(--color-text-muted)]"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Select an AE to load their calendar.</p>
              ) : prefillLoading ? (
                <LoadingState label="Loading lead details…" />
              ) : ae.demo ? (
                <DemoEmbed key={crmLeadId ?? 'none'} ae={ae} prefill={prefill} onScheduled={onScheduled} />
              ) : (
                <CalBookingLauncher url={ae.schedulingUrl} prefill={prefill} onScheduled={onScheduled} />
              )}
            </Card>
          </div>

          {/* Right — guide */}
          <SetterGuide />
        </div>
      )}
    </div>
  )
}
