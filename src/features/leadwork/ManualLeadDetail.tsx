import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Mail, MessageCircle, Phone, Send } from 'lucide-react'
import { manualLeadsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { ROLE_LABELS } from '../../config/permissions'
import { useAuth } from '../../hooks'
import { Button, Card, Textarea } from '../../components/ui/primitives'
import { ErrorState, LoadingState } from '../../components/feedback'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { STATUS_META, TEMP_META, actionsFor, canWorkLeads, type LeadPatch } from './workflow'
import type { Temperature } from '../../api/types'

const digits = (s: string) => s.replace(/[^\d]/g, '')
const looksEmail = (s: string) => /\S+@\S+\.\S+/.test(s)
const looksPhone = (s: string) => digits(s).length >= 7 && /^[\d\s+().-]+$/.test(s.trim())

export function ManualLeadDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { role, user } = useAuth()
  const me = user?.name ?? ''
  const canWork = canWorkLeads(role)

  const { data: lead, isLoading, isError, refetch } = useQuery({
    queryKey: ['manual-lead', id],
    queryFn: () => manualLeadsApi.get(id as string),
    enabled: !!id,
  })

  const [remark, setRemark] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['manual-lead', id] })
    qc.invalidateQueries({ queryKey: ['manual-leads'] })
  }

  const update = useMutation({
    mutationFn: (patch: LeadPatch & { temperature?: Temperature }) => manualLeadsApi.update(id as string, patch),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const addRemark = useMutation({
    mutationFn: () => manualLeadsApi.addRemark(id as string, { text: remark, author: me, author_role: role! }),
    onSuccess: () => {
      setRemark('')
      toast.success('Remark added')
      invalidate()
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError || !lead) return <ErrorState onRetry={() => refetch()} />

  const st = STATUS_META[lead.status]
  const actions = canWork ? actionsFor(role, lead, me) : []

  return (
    <div className="reveal mx-auto max-w-4xl">
      <Link to="/leads" className="mb-4 inline-flex items-center gap-1 text-[13px] text-[var(--color-primary)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight">{lead.display_name}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">From template “{lead.template_name}”</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[13px] font-medium', st.className)}>{st.label}</span>
          {lead.temperature && (
            <TempBadge temp={lead.temperature} />
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Lead data */}
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Lead details</h2>
            <dl className="divide-y divide-[var(--color-border)]">
              {Object.entries(lead.data).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">{key}</dt>
                  <dd className="flex items-center gap-2 text-right text-sm">
                    <span>{value || <span className="text-[var(--color-text-muted)]">—</span>}</span>
                    {value && looksPhone(value) && (
                      <>
                        <a href={`tel:${digits(value)}`} title="Call" className="text-[var(--color-primary)] hover:opacity-70"><Phone className="h-4 w-4" /></a>
                        <a href={`https://wa.me/${digits(value)}`} target="_blank" rel="noreferrer" title="WhatsApp" className="text-green-600 hover:opacity-70"><MessageCircle className="h-4 w-4" /></a>
                      </>
                    )}
                    {value && looksEmail(value) && (
                      <a href={`mailto:${value}`} title="Email" className="text-[var(--color-primary)] hover:opacity-70"><Mail className="h-4 w-4" /></a>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* Remarks */}
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Remarks {lead.remarks.length > 0 && <span className="text-[var(--color-text-muted)]">({lead.remarks.length})</span>}</h2>
            {lead.remarks.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No remarks yet. Setters leave notes here for the closer.</p>
            ) : (
              <ul className="space-y-3">
                {lead.remarks.map((r) => (
                  <li key={r.id} className="rounded-[10px] bg-[var(--color-surface-2)] p-3">
                    <div className="mb-1 flex items-center gap-2 text-[12px]">
                      <span className="font-semibold text-[var(--color-text)]">{r.author}</span>
                      <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">{ROLE_LABELS[r.author_role]}</span>
                      <span className="text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(r.at), { addSuffix: true })}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{r.text}</p>
                  </li>
                ))}
              </ul>
            )}

            {canWork && (
              <div className="mt-4">
                <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} placeholder="Add a remark for the closer…" />
                <div className="mt-2 flex justify-end">
                  <Button size="sm" loading={addRemark.isPending} disabled={!remark.trim()} onClick={() => addRemark.mutate()}>
                    <Send className="h-3.5 w-3.5" /> Add remark
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar: actions */}
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Assignment</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Setter</dt><dd>{lead.setter ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Closer</dt><dd>{lead.closer ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Updated</dt><dd>{formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}</dd></div>
            </dl>
          </Card>

          {canWork && (
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold">Classify</h2>
              <div className="flex gap-2">
                {(['warm', 'cold'] as const).map((t) => {
                  const meta = TEMP_META[t]
                  const active = lead.temperature === t
                  return (
                    <Button
                      key={t}
                      variant={active ? 'primary' : 'outline'}
                      size="sm"
                      className="flex-1"
                      loading={update.isPending && update.variables?.temperature === t}
                      onClick={() => update.mutate({ temperature: active ? null : t })}
                    >
                      <meta.icon className="h-4 w-4" /> {meta.label}
                    </Button>
                  )
                })}
              </div>
            </Card>
          )}

          {canWork && actions.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold">Actions</h2>
              <div className="space-y-2">
                {actions.map((a) => (
                  <Button
                    key={a.key}
                    variant={a.variant}
                    className="w-full justify-center"
                    loading={update.isPending && update.variables?.status === a.patch.status}
                    onClick={() => update.mutate(a.patch)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function TempBadge({ temp }: { temp: Exclude<Temperature, null> }) {
  const meta = TEMP_META[temp]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium', meta.className)}>
      <meta.icon className="h-3.5 w-3.5" /> {meta.label}
    </span>
  )
}
