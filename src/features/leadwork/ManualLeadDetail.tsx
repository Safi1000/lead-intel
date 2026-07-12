import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { ArrowLeft, ArrowRight, Ban, CalendarClock, Check, CheckCircle2, Cloud, Copy, ExternalLink, FileText, Mail, MessageCircle, Phone, PhoneCall, Send, Target } from 'lucide-react'
import { EMAIL_OUTREACH } from '../../config/constants'
import { activitiesApi, cadencesApi, crmApi, emailApi, manualLeadsApi, teamsApi, CRM_PROVIDERS, type CrmProvider } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { ROLE_LABELS } from '../../config/permissions'
import { useAuth } from '../../hooks'
import { useCan } from '../../components/rbac/Can'
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives'
import { Select } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/Dialog'
import { ErrorState, LoadingState } from '../../components/feedback'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { StageSelect, FollowUpCell } from './controls'
import { canWorkLeads, isOverdue } from './workflow'
import { type ActivityType, type LeadStage, type ManualLead } from '../../api/types'

const digits = (s: string) => s.replace(/[^\d]/g, '')
const looksEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim())
const looksPhone = (s: string) => digits(s).length >= 7 && /^[\d\s+().-]+$/.test(s.trim())
const looksUrl = (s: string) => {
  const v = s.trim()
  if (v.includes('@') || v.includes(' ')) return false
  return /^(https?:\/\/|www\.)/i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)
}
const hrefFor = (s: string) => (/^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim().replace(/^\/+/, '')}`)
/** A readable label for a link — booking-widget URLs (Vagaro, Fresha…) are often 500+ chars of
 *  opaque query blob. Show the domain (plus a short path if it stays tidy); the full URL is still
 *  the href and lives in the tooltip. */
const prettyUrl = (s: string): string => {
  const v = s.trim()
  try {
    const u = new URL(hrefFor(v))
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname === '/' ? '' : u.pathname
    const label = host + path
    return label.length > 40 ? host : label
  } catch {
    return v.length > 40 ? v.slice(0, 39) + '…' : v
  }
}
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" title="Copy" aria-label="Copy"
      onClick={async (e) => { e.stopPropagation(); e.preventDefault(); try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) } catch { toast.error('Could not copy') } }}
      className={cn('shrink-0 rounded p-1 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]', className)}>
      {done ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

const CRM_LABEL: Record<CrmProvider, string> = { hubspot: 'HubSpot', gohighlevel: 'GoHighLevel', pipedrive: 'Pipedrive', zoho: 'Zoho CRM', salesforce: 'Salesforce', webhook: 'your webhook' }

/** Push one lead into whichever CRM(s) the org has connected. Managers/owners only. Hidden until a
 *  CRM is connected (nothing to send to otherwise). */
function SendToCrmButton({ leadId }: { leadId: string }) {
  const { data: status } = useQuery({ queryKey: ['crm-status'], queryFn: () => crmApi.status(), staleTime: 60_000 })
  const connected = useMemo<CrmProvider[]>(
    () => (status ? CRM_PROVIDERS.filter((p) => status[p]?.connected) : []),
    [status],
  )
  const push = useMutation({
    mutationFn: async () => {
      const all = await Promise.all(connected.map((p) => crmApi.push({ provider: p, source: 'lead', ids: [leadId] })))
      return all.flatMap((r) => r.results)
    },
    onSuccess: (results) => {
      const failed = results.find((r) => r.status === 'failed')
      if (failed) { toast.error(failed.error ?? 'Could not send to the CRM'); return }
      if (results.some((r) => r.status === 'synced')) toast.success(`Sent to ${connected.map((p) => CRM_LABEL[p]).join(' & ')}`)
      else if (results.some((r) => r.status === 'duplicate')) toast.success('This lead is already in your CRM')
      else toast.info('Already sent to your CRM')
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  if (!connected.length) return null
  return (
    <Button variant="outline" size="sm" loading={push.isPending} onClick={() => push.mutate()}
      title={`Send this lead to ${connected.map((p) => CRM_LABEL[p]).join(' & ')} as a contact`}>
      <Cloud className="h-4 w-4" /> Send to CRM
    </Button>
  )
}

function LeadValue({ value }: { value: string }) {
  const v = value.trim()
  if (!v) return <span className="text-[var(--color-text-muted)]">—</span>
  if (looksEmail(v)) return <a href={`mailto:${v}`} className="break-all text-[var(--color-primary)] hover:underline">{value}</a>
  if (looksUrl(v)) return <a href={hrefFor(v)} target="_blank" rel="noreferrer" title={value} className="inline-flex items-center gap-1 break-all text-[var(--color-primary)] hover:underline">{prettyUrl(value)}<ExternalLink className="h-3 w-3 shrink-0" /></a>
  // whitespace-pre-line preserves the newlines in multi-point fields (numbered Pain Points).
  return <span className="whitespace-pre-line break-words">{value}</span>
}

const toLocalInput = (iso: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '')

export function ManualLeadDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { role, user } = useAuth()
  const me = user?.name ?? ''
  const canWork = canWorkLeads(role)
  const canBook = useCan('create', 'bookings')

  const navigate = useNavigate()
  const { data: lead, isLoading, isError, refetch } = useQuery({ queryKey: ['manual-lead', id], queryFn: () => manualLeadsApi.get(id as string), enabled: !!id })
  const { data: activities } = useQuery({ queryKey: ['activities', id], queryFn: () => activitiesApi.list(id as string), enabled: !!id })
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list(), enabled: role === 'manager' || role === 'superadmin' || role === 'admin' || role === 'owner' })

  // Prev / Next within the same batch — call, click Next, keep dialing (no round-trip to the list).
  // Ordered by created_at (stable), scoped by RLS to the leads this user can see.
  const { data: batchLeads } = useQuery({
    queryKey: ['manual-leads', 'nav', lead?.batch_id],
    queryFn: () => manualLeadsApi.list({ batch_id: lead!.batch_id! }),
    enabled: !!lead?.batch_id,
    staleTime: 60_000,
  })
  const leadNav = useMemo(() => {
    // Setters/closers walk only THEIR assigned leads (50 of 200, not the whole batch);
    // managers walk everything.
    let rows = batchLeads?.data ?? []
    if (role === 'setter') rows = rows.filter((r) => r.setter_id === user?.id || r.id === id)
    else if (role === 'closer') rows = rows.filter((r) => r.closer_id === user?.id || r.id === id)
    rows = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    const i = rows.findIndex((r) => r.id === id)
    return {
      prev: i > 0 ? rows[i - 1].id : null,
      next: i >= 0 && i < rows.length - 1 ? rows[i + 1].id : null,
      pos: i + 1,
      total: rows.length,
    }
  }, [batchLeads, id, role, user?.id])

  const [remark, setRemark] = useState('')
  const [logType, setLogType] = useState<ActivityType | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  // Direct-email follow-up — scoped to one manager (Hamna) who works warm leads from her own inbox.
  const canEmail = user?.id === EMAIL_OUTREACH.userId
  // Managers/owners see internal sourcing + scoring fields; setters/closers must not (secrecy rule).
  const isInternal = role === 'manager' || role === 'owner' || role === 'superadmin' || role === 'admin'

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['manual-lead', id] })
    qc.invalidateQueries({ queryKey: ['activities', id] })
    qc.invalidateQueries({ queryKey: ['manual-leads'] })
    qc.invalidateQueries({ queryKey: ['lead-batches'] })
    qc.invalidateQueries({ queryKey: ['due-today'] })
    qc.invalidateQueries({ queryKey: ['org-user-stats'] })
  }

  const update = useMutation({
    mutationFn: (body: Parameters<typeof manualLeadsApi.update>[1]) => manualLeadsApi.update(id as string, body),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(normalizeError(e).message),
  })
  // Stage is the single activity signal now: changing it updates the lead AND logs to the Activity panel.
  const changeStage = (s: LeadStage) => {
    update.mutate({ stage: s })
    activitiesApi.add(id as string, { type: 'Stage Change', note: `Stage → ${s}` })
      .then(() => qc.invalidateQueries({ queryKey: ['activities', id] })).catch(() => {})
  }
  const addRemark = useMutation({
    mutationFn: () => manualLeadsApi.addRemark(id as string, { text: remark, author: me, author_role: role! }),
    onSuccess: () => { setRemark(''); toast.success('Remark added'); invalidate() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const markDone = useMutation({
    mutationFn: (done: boolean) => manualLeadsApi.markDone(id as string, done),
    onSuccess: (_d, done) => { toast.success(done ? 'Marked as done' : 'Reopened'); invalidate(); qc.invalidateQueries({ queryKey: ['my-progress'] }); qc.invalidateQueries({ queryKey: ['setter-progress'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const unassign = useMutation({
    mutationFn: (which: 'setter' | 'closer') => manualLeadsApi.unassign(id as string, which),
    onSuccess: (_d, which) => { toast.success(`${which === 'setter' ? 'Setter' : 'Closer'} unassigned`); invalidate() },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError || !lead) return <ErrorState onRetry={() => refetch()} />

  const backTo = lead.batch_id ? `/leads/batch/${lead.batch_id}` : '/leads'
  const acts = activities ?? []

  return (
    <div className="reveal mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link to={backTo} className="inline-flex items-center gap-1 text-[13px] text-[var(--color-primary)] hover:underline"><ArrowLeft className="h-4 w-4" /> Back to batch</Link>
        {leadNav.total > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] tabular-nums text-[var(--color-text-muted)]">{leadNav.pos > 0 ? `${leadNav.pos} of ${leadNav.total}` : ''}</span>
            <Button size="sm" variant="outline" disabled={!leadNav.prev} onClick={() => leadNav.prev && navigate(`/leads/manual/${leadNav.prev}`)}><ArrowLeft className="h-3.5 w-3.5" /> Prev</Button>
            <Button size="sm" variant="outline" disabled={!leadNav.next} onClick={() => leadNav.next && navigate(`/leads/manual/${leadNav.next}`)}>Next <ArrowRight className="h-3.5 w-3.5" /></Button>
          </div>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="group min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-[24px] font-bold tracking-tight">{lead.display_name}</h1>
            <CopyButton text={lead.display_name} />
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">From template “{lead.template_name}”</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {lead.lifecycle_state && <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">{lead.lifecycle_state}</span>}
            {lead.attempt_count > 0 && <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)] tabular-nums">{lead.attempt_count} attempt{lead.attempt_count === 1 ? '' : 's'}</span>}
            {lead.dnc && <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400"><Ban className="h-3 w-3" /> Do not call</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canWork && (
            <Button
              variant={lead.done_at ? 'secondary' : 'outline'}
              size="sm"
              loading={markDone.isPending}
              onClick={() => markDone.mutate(!lead.done_at)}
              title={lead.done_at ? 'Click to reopen' : 'Mark this lead as processed'}
            >
              <CheckCircle2 className={cn('h-4 w-4', lead.done_at && 'text-[var(--c-verified)]')} /> {lead.done_at ? 'Done' : 'Mark as done'}
            </Button>
          )}
          {canEmail && (
            <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)} title="Draft a follow-up email to this lead">
              <Mail className="h-4 w-4" /> Send Email
            </Button>
          )}
          {canBook && (
            <Link to={`/bookings/new?leadId=${lead.id}`}>
              <Button variant="outline" size="sm"><CalendarClock className="h-4 w-4" /> Book a meeting</Button>
            </Link>
          )}
          {isInternal && <SendToCrmButton leadId={lead.id} />}
          {(role === 'manager' || role === 'owner' || role === 'superadmin' || role === 'admin') && (
            <Link to={`/leads/manual/${lead.id}/audit?print=1`} target="_blank" rel="noreferrer" title="Open a branded, client-ready audit PDF">
              <Button variant="outline" size="sm"><FileText className="h-4 w-4" /> Audit PDF</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {canWork && <CadenceCard leadId={lead.id} />}
          <TalkingPointsCard data={lead.data} />
          <DetailsCard lead={lead} />
          {isInternal && <InternalCard lead={lead} />}

          {/* Activity log */}
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Activity {acts.length > 0 && <span className="text-[var(--color-text-muted)]">({acts.length})</span>}</h2>
            {acts.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No activity yet — stage changes are logged here.</p>
            ) : (
              <ul className="space-y-2.5">
                {acts.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 border-l-2 border-[var(--color-primary)] pl-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-semibold">{a.type}</span>
                        {a.author && <span className="text-[var(--color-text-muted)]">· {a.author}</span>}
                        <span className="text-[var(--color-text-muted)]">· {formatDistanceToNow(new Date(a.at), { addSuffix: true })}</span>
                      </div>
                      {a.note && <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-[var(--color-text-secondary)]">{a.note}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Remarks (freeform, separate from the structured log) */}
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Notes {lead.remarks.length > 0 && <span className="text-[var(--color-text-muted)]">({lead.remarks.length})</span>}</h2>
            {lead.remarks.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {lead.remarks.map((r) => (
                  <li key={r.id} className="group rounded-[10px] bg-[var(--color-surface-2)] p-3">
                    <div className="mb-1 flex items-center gap-2 text-[12px]">
                      <span className="font-semibold text-[var(--color-text)]">{r.author}</span>
                      <span className="rounded-full bg-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--color-text-secondary)]">{ROLE_LABELS[r.author_role]}</span>
                      <span className="text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(r.at), { addSuffix: true })}</span>
                      <CopyButton text={r.text} className="ml-auto" />
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
            {canWork && (
              <div className="mt-4">
                <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} placeholder="Add a freeform note…" />
                <div className="mt-2 flex justify-end"><Button size="sm" loading={addRemark.isPending} disabled={!remark.trim()} onClick={() => addRemark.mutate()}><Send className="h-3.5 w-3.5" /> Add note</Button></div>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Status</h2>
            <div className="space-y-3">
              <div>
                <Label className="mb-1.5">Stage</Label>
                <StageSelect stage={lead.stage} role={role} disabled={!canWork} onChange={(s) => changeStage(s)} />
              </div>
              <div>
                <Label className="mb-1.5 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Next follow-up</Label>
                <FollowUpCell value={lead.next_follow_up} disabled={!canWork} onChange={(d) => update.mutate({ next_follow_up: d })} />
                {isOverdue(lead.next_follow_up) && <p className="mt-1 text-[12px] font-medium text-red-600 dark:text-red-400">Overdue</p>}
              </div>
              {(lead.stage === 'Booked' || lead.call_at) && (
                <div>
                  <Label htmlFor="call-at" className="mb-1.5 flex items-center gap-1"><PhoneCall className="h-3.5 w-3.5" /> Call date &amp; time</Label>
                  {canWork ? (
                    <Input id="call-at" type="datetime-local" value={toLocalInput(lead.call_at)} onChange={(e) => update.mutate({ call_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                  ) : (
                    <p className="text-sm">{lead.call_at ? format(new Date(lead.call_at), 'PPp') : '—'}</p>
                  )}
                </div>
              )}
            </div>
          </Card>


          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Assignment</h2>
            <dl className="space-y-2 text-sm">
              <div className="group flex items-center justify-between gap-2"><dt className="text-[var(--color-text-muted)]">Setter</dt><dd className="flex items-center gap-1">{lead.setter ?? '—'}{lead.setter && <CopyButton text={lead.setter} />}{lead.setter && !lead.done_at && (role === 'manager' || role === 'superadmin' || role === 'admin' || role === 'owner') && (
                <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" loading={unassign.isPending && unassign.variables === 'setter'} onClick={() => unassign.mutate('setter')}>Unassign</Button>
              )}{lead.setter && lead.done_at && <span className="text-[11px] text-[var(--color-text-muted)]" title="Done leads stay with their setter forever">🔒</span>}</dd></div>
              <div className="group flex items-center justify-between gap-2"><dt className="text-[var(--color-text-muted)]">Closer</dt><dd className="flex items-center gap-1">{lead.closer ?? '—'}{lead.closer && <CopyButton text={lead.closer} />}{lead.closer && (role === 'manager' || role === 'superadmin' || role === 'admin' || role === 'owner') && (
                <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" loading={unassign.isPending && unassign.variables === 'closer'} onClick={() => unassign.mutate('closer')}>Unassign</Button>
              )}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Updated</dt><dd>{formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}</dd></div>
            </dl>
            {(role === 'manager' || role === 'superadmin' || role === 'admin' || role === 'owner') && teams && (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <Label className="mb-1 text-[12px]">Team</Label>
                <Select
                  value={lead.team_id ?? ''}
                  onValueChange={(v) => update.mutate({ team_id: v || null })}
                  className="w-full"
                  options={[{ value: '', label: '— none —' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
                />
              </div>
            )}
          </Card>
        </div>
      </div>

      {logType && (
        <LogActivityDialog
          type={logType}
          onClose={() => setLogType(null)}
          onDone={() => { setLogType(null); invalidate() }}
          leadId={id as string}
          currentCallAt={lead.call_at}
        />
      )}

      {emailOpen && <SendEmailDialog lead={lead} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}


// ---- Direct-email follow-up (Hamna only) -------------------------------------------------
// No server-side mailer exists yet, so we build an editable draft from the lead's own scoring
// fields and hand it to Hamna's Gmail (from hamna@techxserve.com). She reviews, then sends.

const striptrail = (s: string) => s.replace(/\s+/g, ' ').trim()

function cityFromLead(data: Record<string, string>): string {
  const loc = data['Search Location'] || data['City'] || ''
  return striptrail(loc.split(',')[0])
}

function nicheFromLead(data: Record<string, string>): string {
  let n = (data['Search Query'] || '').trim()
  const city = cityFromLead(data)
  if (city) n = n.split(city).join(' ')
  n = n
    .replace(/,?\s*\b[A-Z]{2}\b/g, ' ') // drop state codes like "TX"
    .replace(/\bin\b/gi, ' ')
    .replace(/[,]/g, ' ')
  n = striptrail(n).toLowerCase()
  if (!n) return 'local businesses'
  return /s$/.test(n) ? n : n + 's'
}

function buildDraft(lead: ManualLead): { to: string; subject: string; body: string } {
  const data = lead.data as Record<string, string>
  const business = lead.display_name
  const city = cityFromLead(data)
  const niche = nicheFromLead(data)
  const rating = (data['Rating'] || '').trim()
  const praise = striptrail(data['Personalization Notes'] || '')
  // List every pain point (a numbered, multi-line field) — not just the single headline issue.
  // Fall back to the one-line Site Issue Note when there's no usable list.
  const painPoints = (data['Pain Points'] || '').trim()
  const painUsable = !!painPoints && !/not analyzed|insufficient/i.test(painPoints)
  const issueNote = striptrail(data['Site Issue Note'] || '')

  let intro = `I came across ${business} while looking through ${niche} ${city ? `in ${city}` : 'in your area'}, and the reviews genuinely stand out.`
  if (praise) intro += ' ' + praise
  if (rating) intro += ` A ${rating}★ average says you're doing the hard part right.`

  const parts: string[] = [
    'Hi there,',
    '',
    'Thanks to your team for taking my call earlier and passing along this email. Following up as promised.',
    '',
    intro,
  ]
  if (painUsable) parts.push('', "Here's what's holding you back, and it's costing you real bookings:", '', painPoints)
  else if (issueNote) parts.push('', issueNote)
  parts.push(
    '',
    "Let's grab a quick meeting and I'll show you exactly what we'd do.",
    `Pick whatever time works here: ${EMAIL_OUTREACH.meetingLink}`,
    '',
    'Talk soon,',
    EMAIL_OUTREACH.senderName,
  )

  return {
    to: (data['Email'] || '').trim(),
    subject: `Following up on our call — ${business}`,
    body: parts.join('\n'),
  }
}

function SendEmailDialog({ lead, onClose }: { lead: ManualLead; onClose: () => void }) {
  const qc = useQueryClient()
  const initial = useMemo(() => buildDraft(lead), [lead])
  const [to, setTo] = useState(initial.to)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [copied, setCopied] = useState(false)

  // Is direct sending switched on for this user (SMTP configured + authorised mailbox owner)?
  const { data: mail, isLoading: statusLoading } = useQuery({
    queryKey: ['send-email-status'], queryFn: () => emailApi.status(), staleTime: 60_000,
  })
  const send = useMutation({
    mutationFn: () => emailApi.send({ to: to.trim(), subject: subject.trim(), body, leadId: lead.id }),
    onSuccess: async () => {
      toast.success('Email sent')
      try { await activitiesApi.add(lead.id, { type: 'Emailed', note: `Sent email: ${subject.trim()}` }) } catch { /* non-fatal */ }
      qc.invalidateQueries({ queryKey: ['activities', lead.id] })
      onClose()
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  // Fallback when direct sending isn't on: open the user's default mail app with the draft pre-filled.
  const openMailApp = () => {
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
  const copyBody = async () => {
    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1200) }
    catch { toast.error('Could not copy') }
  }

  const connected = !!mail?.connected
  const canSend = connected && !!to.trim() && !!subject.trim() && !!body.trim()

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Send Email"
      description={connected
        ? `Sends from ${mail?.email ?? EMAIL_OUTREACH.fromAddress}. Review the draft, then click Send.`
        : `Review the draft below. Sending from ${EMAIL_OUTREACH.fromAddress} turns on once setup is finished.`}
      className="max-w-2xl"
    >
      <div className="space-y-3">
        {!to && (
          <div className="rounded-[10px] bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-400">
            No email was found for this lead — add the client's address in the “To” box before sending.
          </div>
        )}
        <div>
          <Label htmlFor="em-to">To</Label>
          <Input id="em-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
        </div>
        <div>
          <Label htmlFor="em-subject">Subject</Label>
          <Input id="em-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="em-body">Message</Label>
          <Textarea id="em-body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} className="font-normal leading-relaxed" />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
          <span className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]">
            {statusLoading ? 'Checking…'
              : connected ? <><CheckCircle2 className="h-3.5 w-3.5 text-[var(--c-verified)]" /> Sending from {mail?.email}</>
              : 'Direct sending not set up yet'}
          </span>
          <Button variant="ghost" size="sm" onClick={copyBody}>
            {copied ? <Check className="h-4 w-4 text-[var(--c-verified)]" /> : <Copy className="h-4 w-4" />} Copy
          </Button>
          <Button variant="outline" size="sm" onClick={openMailApp}>Open in email app</Button>
          <Button size="sm" loading={send.isPending} disabled={!canSend} onClick={() => send.mutate()} title={connected ? '' : 'Sending is not set up yet'}>
            <Send className="h-4 w-4" /> Send
          </Button>
        </div>
      </div>
    </Dialog>
  )
}


/** §10 enroll this lead into a follow-up sequence + show/stop active enrollments. */
function CadenceCard({ leadId }: { leadId: string }) {
  const qc = useQueryClient()
  const { data: cadences } = useQuery({ queryKey: ['cadences'], queryFn: () => cadencesApi.list() })
  const { data: enrollments } = useQuery({ queryKey: ['cadence-enrollments', leadId], queryFn: () => cadencesApi.enrollmentsForLead(leadId) })
  const [cid, setCid] = useState('')
  const active = (enrollments ?? []).filter((e) => e.status === 'active')
  const activeCadences = (cadences ?? []).filter((c) => c.active)
  const enroll = useMutation({ mutationFn: () => cadencesApi.enroll(leadId, cid), onSuccess: () => { toast.success('Enrolled in sequence'); setCid(''); qc.invalidateQueries({ queryKey: ['cadence-enrollments', leadId] }) }, onError: (e) => toast.error(normalizeError(e).message) })
  const stop = useMutation({ mutationFn: (id: string) => cadencesApi.stop(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['cadence-enrollments', leadId] }), onError: (e) => toast.error(normalizeError(e).message) })

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-[15px] font-semibold">Sequence</h2>
      {active.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {active.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-[8px] bg-[var(--color-surface-2)] px-3 py-1.5 text-[13px]">
              <span className="font-medium">{e.cadence_name} <span className="text-[var(--color-text-muted)]">· step {e.current_step + 1}</span></span>
              <button onClick={() => stop.mutate(e.id)} className="text-[12px] text-red-600 hover:underline dark:text-red-400">Stop</button>
            </div>
          ))}
        </div>
      )}
      {activeCadences.length > 0 ? (
        <div className="flex gap-2">
          <Select
            value={cid}
            onValueChange={setCid}
            placeholder="Enroll in…"
            className="flex-1"
            options={activeCadences.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Button size="sm" disabled={!cid} loading={enroll.isPending} onClick={() => enroll.mutate()}>Enroll</Button>
        </div>
      ) : <p className="text-[13px] text-[var(--color-text-muted)]">No active sequences yet.</p>}
    </Card>
  )
}


// --- Lead-detail cards: call-ready grouping + role-aware visibility -----------------------------
// Internal/sourcing fields quietly reveal automated scraping + scoring, so they're kept out of the
// setter/closer view (hard rule: setters never learn lead-gen is automated). Managers/owners see them.
const PITCH_KEYS = ['Site Issue Note', 'Pain Points', 'Top Competitors', 'Personalization Notes']
const CONTACT_KEYS = ['Phone', 'Email', 'Website', 'Address']
const BUSINESS_KEYS = ['Rating', 'Business Hours', 'Best Time to Call (PKT)']
const INTERNAL_KEYS = ['Quality Score', 'Primary Angle', 'Website Status', 'Why This Status', 'SEO Score', 'Tech Stack', 'Running Google Ads', 'Email Verified', 'Source', 'Search Query', 'Search Location']
const ANGLE_LABELS: Record<string, string> = {
  first_website: 'No website yet',
  broken_site: 'Broken / dead website',
  redesign: 'Website needs a rebuild',
  lead_capture: 'No way to capture leads online',
  seo: 'Hard to find on Google',
  booking: 'No online booking',
  reputation: 'Behind local rivals on reviews',
}

function RatingStars({ value }: { value: string }) {
  const n = parseFloat(value)
  if (isNaN(n)) return <LeadValue value={value} />
  const full = Math.min(5, Math.round(n))
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tracking-tight text-amber-500" aria-hidden>{'★'.repeat(full)}{'☆'.repeat(5 - full)}</span>
      <span className="tabular-nums font-medium">{n.toFixed(1)}</span>
    </span>
  )
}

function DeliverBadge({ verified }: { verified: string }) {
  if (verified.startsWith('Yes')) return <span className="shrink-0 rounded-full bg-[var(--c-verified-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--c-verified-text)]">deliverable</span>
  if (verified.startsWith('No')) return <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">may bounce</span>
  return null
}

/** One label/value row, reused across the grouped cards. */
function DataRow({ k, v, verified }: { k: string; v: string; verified?: string }) {
  if (!v?.trim()) return null
  return (
    <div className="group flex items-start justify-between gap-4 py-2.5">
      <dt className="pt-0.5 font-mono text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">{k}</dt>
      <dd className="flex max-w-[68%] items-start gap-1.5 text-right text-sm">
        {k === 'Rating' ? <RatingStars value={v} /> : <span className="text-left"><LeadValue value={v} /></span>}
        {k === 'Email' && verified && <DeliverBadge verified={verified} />}
        {looksPhone(v) && (
          <>
            <a href={`tel:${digits(v)}`} title="Call" className="shrink-0 rounded p-1 text-[var(--color-primary)] hover:bg-[var(--color-surface-2)]"><Phone className="h-4 w-4" /></a>
            <a href={`https://wa.me/${digits(v)}`} target="_blank" rel="noreferrer" title="WhatsApp" className="shrink-0 rounded p-1 text-green-600 dark:text-green-400 hover:bg-[var(--color-surface-2)]"><MessageCircle className="h-4 w-4" /></a>
          </>
        )}
        <CopyButton text={v} />
      </dd>
    </div>
  )
}

function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</p>
      {children}
    </div>
  )
}

function PitchPoint({ label, text, muted }: { label: string; text: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={cn('mt-0.5 whitespace-pre-line', muted && 'text-[var(--color-text-secondary)]')}>{text}</p>
    </div>
  )
}

/** The pitch — pinned at the top so it's the first thing to hand on a call. Visible to everyone. */
function TalkingPointsCard({ data }: { data: Record<string, string> }) {
  const angle = ANGLE_LABELS[(data['Primary Angle'] || '').trim()] ?? ''
  const hook = striptrail(data['Site Issue Note'] || '')
  const pains = (data['Pain Points'] || '').trim()
  const painUsable = !!pains && !/not analyzed|insufficient/i.test(pains)
  const rivals = striptrail(data['Top Competitors'] || '')
  const praise = striptrail(data['Personalization Notes'] || '')
  if (!hook && !painUsable && !rivals && !praise) return null
  const copyText = [
    hook && `Hook: ${hook}`,
    painUsable && `Why they need us:\n${pains}`,
    rivals && `Ahead of them locally: ${rivals}`,
    praise && `Open with a compliment: ${praise}`,
  ].filter(Boolean).join('\n\n')
  return (
    <Card className="border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.04] p-5">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-[var(--color-primary)]" />
        <h2 className="text-[15px] font-semibold">Talking points</h2>
        {angle && <span className="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)]">{angle}</span>}
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(copyText); toast.success('Talking points copied') } catch { toast.error('Could not copy') } }}
          className="ml-auto inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><Copy className="h-3.5 w-3.5" /> Copy</button>
      </div>
      <div className="space-y-3 text-sm">
        {hook && <PitchPoint label="The hook" text={hook} />}
        {painUsable && <PitchPoint label="Why they need us" text={pains} muted />}
        {rivals && <PitchPoint label="Ahead of them locally" text={rivals} />}
        {praise && <PitchPoint label="Open with a compliment" text={praise} muted />}
      </div>
    </Card>
  )
}

/** Contact + business snapshot + any custom columns. Visible to everyone. */
function DetailsCard({ lead }: { lead: ManualLead }) {
  const data = lead.data as Record<string, string>
  const has = (k: string) => !!(data[k] ?? '').trim()
  const contact = CONTACT_KEYS.filter(has)
  const business = BUSINESS_KEYS.filter(has)
  const known = new Set([...PITCH_KEYS, ...CONTACT_KEYS, ...BUSINESS_KEYS, ...INTERNAL_KEYS, 'Business Name'])
  const other = Object.keys(data).filter((k) => !known.has(k) && has(k))
  if (!contact.length && !business.length && !other.length) return null
  const copyAll = [...contact, ...business, ...other].map((k) => `${k}: ${data[k]}`).join('\n')
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Lead details</h2>
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(copyAll); toast.success('Details copied') } catch { toast.error('Could not copy') } }}
          className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><Copy className="h-3.5 w-3.5" /> Copy</button>
      </div>
      {contact.length > 0 && <Subsection title="Contact"><dl className="divide-y divide-[var(--color-border)]">{contact.map((k) => <DataRow key={k} k={k} v={data[k]} verified={data['Email Verified']} />)}</dl></Subsection>}
      {business.length > 0 && <Subsection title="Business"><dl className="divide-y divide-[var(--color-border)]">{business.map((k) => <DataRow key={k} k={k} v={data[k]} />)}</dl></Subsection>}
      {other.length > 0 && <Subsection title="Other"><dl className="divide-y divide-[var(--color-border)]">{other.map((k) => <DataRow key={k} k={k} v={data[k]} />)}</dl></Subsection>}
    </Card>
  )
}

/** Internal sourcing + scoring — managers/owners only (hidden from setters per the secrecy rule). */
function InternalCard({ lead }: { lead: ManualLead }) {
  const data = lead.data as Record<string, string>
  const rows = INTERNAL_KEYS.filter((k) => (data[k] ?? '').trim())
  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Sourcing &amp; scoring</h2>
        <span className="text-[11px] text-[var(--color-text-muted)]">Internal — hidden from setters</span>
      </div>
      <dl className="divide-y divide-[var(--color-border)]">
        {rows.map((k) => <DataRow key={k} k={k} v={data[k]} />)}
        <div className="group flex items-start justify-between gap-4 py-2.5">
          <dt className="pt-0.5 font-mono text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">Lead ID</dt>
          <dd className="flex max-w-[68%] items-start gap-1.5 text-right text-sm"><span className="break-all text-left font-mono text-[13px]">{lead.id}</span><CopyButton text={lead.id} /></dd>
        </div>
      </dl>
    </Card>
  )
}

/** Log an activity and (per spec) prompt for the next follow-up date. */
function LogActivityDialog({ type, leadId, currentCallAt, onClose, onDone }: { type: ActivityType; leadId: string; currentCallAt: string | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [callAt, setCallAt] = useState(toLocalInput(currentCallAt))
  const isBooked = type === 'Booked'

  const save = useMutation({
    mutationFn: async () => {
      await activitiesApi.add(leadId, { type, note: note.trim() || null })
      const patch: Parameters<typeof manualLeadsApi.update>[1] = {}
      if (followUp) patch.next_follow_up = followUp
      if (isBooked) { patch.stage = 'Booked'; if (callAt) patch.call_at = new Date(callAt).toISOString() }
      if (Object.keys(patch).length) await manualLeadsApi.update(leadId, patch)
    },
    onSuccess: () => { toast.success('Activity logged'); onDone() },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Log: ${type}`} description="Record the touch, then set when to follow up next.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="la-note">Note (optional)</Label>
          <Textarea id="la-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What happened?" />
        </div>
        {isBooked && (
          <div>
            <Label htmlFor="la-call">Call date &amp; time</Label>
            <Input id="la-call" type="datetime-local" value={callAt} onChange={(e) => setCallAt(e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor="la-follow" className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Next follow-up date</Label>
          <Input id="la-follow" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Leave blank if no follow-up is needed.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Log activity</Button>
        </div>
      </div>
    </Dialog>
  )
}
