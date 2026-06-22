import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { FileSpreadsheet, FileUp, Flame, Snowflake, Users } from 'lucide-react'
import { manualLeadsApi } from '../../api/endpoints'
import { useAuth } from '../../hooks'
import { ROLE_LABELS } from '../../config/permissions'
import { Button, Card } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'
import { STATUS_META, TEMP_META } from './workflow'
import type { LeadStatus, ManualLead } from '../../api/types'

export function WorkHomePage() {
  const { role, user } = useAuth()
  const { data, isLoading } = useQuery({ queryKey: ['manual-leads'], queryFn: () => manualLeadsApi.list() })

  const leads = data?.data ?? []
  const count = (s: LeadStatus) => leads.filter((l) => l.status === s).length
  const warm = leads.filter((l) => l.temperature === 'warm').length
  const cold = leads.filter((l) => l.temperature === 'cold').length
  const recent = [...leads].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)).slice(0, 6)

  const isGenerator = role === 'manager' || role === 'lead_generator' || role === 'admin' || role === 'superadmin'

  return (
    <div className="reveal">
      <PageHeader
        title={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        subtitle={role ? `Signed in as ${ROLE_LABELS[role]}` : undefined}
        actions={
          <div className="flex gap-2">
            <Link to="/leads"><Button variant="outline"><Users className="h-4 w-4" /> Open leads</Button></Link>
            {isGenerator && <Link to="/upload"><Button><FileUp className="h-4 w-4" /> Upload leads</Button></Link>}
          </div>
        }
      />

      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total leads" value={leads.length} to="/leads" />
            <StatCard label={STATUS_META.new.label} value={count('new')} to="/leads" hint="Unclaimed pool" />
            <StatCard label={STATUS_META.with_setter.label} value={count('with_setter')} to="/leads" />
            <StatCard label={STATUS_META.with_closer.label} value={count('with_closer')} to="/leads" />
            <StatCard label={STATUS_META.open.label} value={count('open')} to="/leads" />
            <StatCard label={STATUS_META.closed.label} value={count('closed')} to="/leads" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {/* Temperature split */}
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold">Classification</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-sm"><Flame className="h-4 w-4 text-red-500" /> Warm</span>
                  <span className="text-[20px] font-bold tabular-nums text-red-600">{warm}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-sm"><Snowflake className="h-4 w-4 text-sky-500" /> Cold</span>
                  <span className="text-[20px] font-bold tabular-nums text-sky-600">{cold}</span>
                </div>
                <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2 text-[var(--color-text-muted)]">
                  <span className="text-sm">Unclassified</span>
                  <span className="text-[20px] font-bold tabular-nums">{leads.length - warm - cold}</span>
                </div>
              </div>
            </Card>

            {/* Recent activity */}
            <Card className="p-0 lg:col-span-2">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">Recent activity</h2>
                <Link to="/leads" className="text-[13px] text-[var(--color-primary)] hover:underline">View all</Link>
              </div>
              {recent.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-[var(--color-text-muted)]">
                  No leads yet.{' '}
                  {isGenerator ? <Link to="/templates" className="text-[var(--color-primary)] hover:underline">Create a template</Link> : 'Check back once leads are uploaded.'}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {recent.map((l) => (
                    <RecentRow key={l.id} lead={l} />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {isGenerator && leads.length === 0 && (
            <Card className="mt-4 flex items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-6 w-6 text-[var(--color-primary)]" />
                <div>
                  <p className="text-sm font-medium">Get started</p>
                  <p className="text-[13px] text-[var(--color-text-muted)]">Create a template, then upload your first sheet of leads.</p>
                </div>
              </div>
              <Link to="/templates"><Button variant="outline">Templates</Button></Link>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function RecentRow({ lead }: { lead: ManualLead }) {
  const st = STATUS_META[lead.status]
  const temp = lead.temperature ? TEMP_META[lead.temperature] : null
  return (
    <li>
      <Link to={`/leads/manual/${lead.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.display_name}</p>
          <p className="truncate text-[12px] text-[var(--color-text-muted)]">{lead.template_name}</p>
        </div>
        {temp && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${temp.className}`}><temp.icon className="h-3 w-3" /> {temp.label}</span>}
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium ${st.className}`}>{st.label}</span>
        <span className="hidden text-[12px] text-[var(--color-text-muted)] sm:inline">{formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}</span>
      </Link>
    </li>
  )
}
