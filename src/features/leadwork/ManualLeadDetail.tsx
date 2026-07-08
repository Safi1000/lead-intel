import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { ArrowLeft, ArrowRight, Ban, CalendarClock, Check, CheckCircle2, Copy, ExternalLink, FileText, MessageCircle, Phone, PhoneCall, Send } from 'lucide-react'
import { activitiesApi, cadencesApi, manualLeadsApi, teamsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { ROLE_LABELS } from '../../config/permissions'
import { useAuth } from '../../hooks'
import { useCan } from '../../components/rbac/Can'
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives'
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
/** Find a lead data value whose column name matches a pattern (Feature 4 call card). */
const findField = (data: Record<string, string>, re: RegExp) => {
  const hit = Object.entries(data).find(([k, v]) => re.test(k) && v?.trim())
  return hit?.[1]?.trim() ?? null
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

function LeadValue({ value }: { value: string }) {
  const v = value.trim()
  if (!v) return <span className="text-[var(--color-text-muted)]">—</span>
  if (looksEmail(v)) return <a href={`mailto:${v}`} className="break-all text-[var(--color-primary)] hover:underline">{value}</a>
  if (looksUrl(v)) return <a href={hrefFor(v)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-[var(--color-primary)] hover:underline">{value}<ExternalLink className="h-3 w-3 shrink-0" /></a>
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
          {canBook && (
            <Link to={`/bookings/new?leadId=${lead.id}`}>
              <Button variant="outline" size="sm"><CalendarClock className="h-4 w-4" /> Book a meeting</Button>
            </Link>
          )}
          {(role === 'manager' || role === 'owner' || role === 'superadmin' || role === 'admin') && (
            <Link to={`/leads/manual/${lead.id}/audit?print=1`} target="_blank" rel="noreferrer" title="Open a branded, client-ready audit PDF">
              <Button variant="outline" size="sm"><FileText className="h-4 w-4" /> Audit PDF</Button>
            </Link>
          )}
          <StageSelect stage={lead.stage} role={role} disabled={!canWork} onChange={(s) => changeStage(s)} />
        </div>
      </div>

      {lead.stage === 'Booked' && <CallCard lead={lead} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {canWork && <CadenceCard leadId={lead.id} />}
          {/* Lead data */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Lead details</h2>
              <button type="button" onClick={async () => { const all = Object.entries(lead.data).map(([k, v]) => `${k}: ${v}`).join('\n'); try { await navigator.clipboard.writeText(all); toast.success('All fields copied') } catch { toast.error('Could not copy') } }}
                className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><Copy className="h-3.5 w-3.5" /> Copy all</button>
            </div>
            <dl className="divide-y divide-[var(--color-border)]">
              <div className="group flex items-start justify-between gap-4 py-2.5">
                <dt className="pt-0.5 font-mono text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">Lead ID</dt>
                <dd className="flex max-w-[68%] items-start gap-1.5 text-right text-sm">
                  <span className="break-all text-left font-mono text-[13px]">{lead.id}</span>
                  <CopyButton text={lead.id} />
                </dd>
              </div>
              {Object.entries(lead.data).map(([key, value]) => (
                <div key={key} className="group flex items-start justify-between gap-4 py-2.5">
                  <dt className="pt-0.5 font-mono text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">{key}</dt>
                  <dd className="flex max-w-[68%] items-start gap-1.5 text-right text-sm">
                    <span className="text-left"><LeadValue value={value} /></span>
                    {value && looksPhone(value) && (
                      <>
                        <a href={`tel:${digits(value)}`} title="Call" className="shrink-0 rounded p-1 text-[var(--color-primary)] hover:bg-[var(--color-surface-2)]"><Phone className="h-4 w-4" /></a>
                        <a href={`https://wa.me/${digits(value)}`} target="_blank" rel="noreferrer" title="WhatsApp" className="shrink-0 rounded p-1 text-green-600 dark:text-green-400 hover:bg-[var(--color-surface-2)]"><MessageCircle className="h-4 w-4" /></a>
                      </>
                    )}
                    {value && <CopyButton text={value} />}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

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
                <select value={lead.team_id ?? ''} onChange={(e) => update.mutate({ team_id: e.target.value || null })}
                  className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
                  <option value="">— none —</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
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
    </div>
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
          <select value={cid} onChange={(e) => setCid(e.target.value)} className="h-9 flex-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            <option value="">Enroll in…</option>
            {activeCadences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button size="sm" disabled={!cid} loading={enroll.isPending} onClick={() => enroll.mutate()}>Enroll</Button>
        </div>
      ) : <p className="text-[13px] text-[var(--color-text-muted)]">No active sequences yet.</p>}
    </Card>
  )
}


/** Feature 4 — clean call card surfaced when a lead is Booked. */
function CallCard({ lead }: { lead: ManualLead }) {
  const website = findField(lead.data, /website|url|site|web/i)
  const owner = findField(lead.data, /owner|manager|contact|name/i)
  const issue = findField(lead.data, /issue|problem|pain|reason|note/i)
  const phone = findField(lead.data, /phone|mobile|cell|tel/i)
  return (
    <Card className="mb-5 border-amber-200 bg-amber-500/10 p-5">
      <div className="mb-3 flex items-center gap-2">
        <PhoneCall className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h2 className="text-[15px] font-semibold">Call card</h2>
        {lead.call_at && <span className="ml-auto text-[13px] font-medium text-amber-700 dark:text-amber-400">{format(new Date(lead.call_at), 'PPp')}</span>}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="Business">{lead.display_name}</Field>
        <Field label="Owner / Manager">{owner ?? '—'}</Field>
        <Field label="Website">{website ? <a href={hrefFor(website)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-[var(--color-primary)] hover:underline">{website}<ExternalLink className="h-3 w-3 shrink-0" /></a> : '—'}</Field>
        <Field label="Phone">{phone ? <a href={`tel:${digits(phone)}`} className="text-[var(--color-primary)] hover:underline">{phone}</a> : '—'}</Field>
        <div className="sm:col-span-2"><Field label="Site issue note">{issue ?? '—'}</Field></div>
      </dl>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
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
