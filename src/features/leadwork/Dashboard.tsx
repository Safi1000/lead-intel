import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CalendarClock, FileSpreadsheet, FileUp, Users } from 'lucide-react'
import { manualLeadsApi } from '../../api/endpoints'
import { useAuth } from '../../hooks'
import { ROLE_LABELS } from '../../config/permissions'
import { Button, Card } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'
import { StageBadge } from './controls'
import { STAGE_ORDER, isOverdue, isDueToday } from './workflow'
import type { LeadStage, ManualLead } from '../../api/types'

export function WorkHomePage() {
  const { role, user } = useAuth()
  const { data, isLoading } = useQuery({ queryKey: ['manual-leads', 'all'], queryFn: () => manualLeadsApi.list() })

  const leads = data?.data ?? []
  const byStage = (s: LeadStage) => leads.filter((l) => l.stage === s).length
  const due = leads.filter((l) => isDueToday(l.next_follow_up) || isOverdue(l.next_follow_up)).length
  const recent = [...leads].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)).slice(0, 6)

  const isGenerator = role === 'manager' || role === 'lead_generator' || role === 'admin' || role === 'superadmin'

  return (
    <div className="reveal">
      <PageHeader
        title={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        subtitle={role ? `Signed in as ${ROLE_LABELS[role]}` : undefined}
        actions={
          <div className="flex gap-2">
            <Link to="/today"><Button variant="outline"><CalendarClock className="h-4 w-4" /> Due today</Button></Link>
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
            <StatCard label="Due today" value={due} to="/today" hint="Follow-ups owed" />
            <StatCard label="New" value={byStage('New')} to="/leads" />
            <StatCard label="Booked" value={byStage('Booked')} to="/leads" />
            <StatCard label="Won" value={byStage('Won')} to="/leads" />
            <StatCard label="Lost" value={byStage('Lost')} to="/leads" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {/* Pipeline breakdown */}
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold">Pipeline</h2>
              <div className="space-y-2">
                {STAGE_ORDER.map((s) => (
                  <div key={s} className="flex items-center justify-between">
                    <StageBadge stage={s} />
                    <span className="text-[15px] font-bold tabular-nums">{byStage(s)}</span>
                  </div>
                ))}
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
                  {isGenerator ? <Link to="/templates" className="text-[var(--color-primary)] hover:underline">Create a template</Link> : 'Check back once leads are assigned to you.'}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">{recent.map((l) => <RecentRow key={l.id} lead={l} />)}</ul>
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
  return (
    <li>
      <Link to={`/leads/manual/${lead.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.display_name}</p>
          <p className="truncate text-[12px] text-[var(--color-text-muted)]">{lead.template_name}</p>
        </div>
        <StageBadge stage={lead.stage} />
        <span className="hidden text-[12px] text-[var(--color-text-muted)] sm:inline">{formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}</span>
      </Link>
    </li>
  )
}
