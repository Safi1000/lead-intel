import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search as SearchIcon } from 'lucide-react'
import { manualLeadsApi } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { EmptyState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'

/** §10 global lead search — reached from the top-bar search box. RLS scopes results to the user. */
export function SearchPage() {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const { data, isLoading } = useQuery({ queryKey: ['global-search', q], queryFn: () => manualLeadsApi.list({ search: q }), enabled: q.length >= 2 })
  const results = data?.data ?? []

  return (
    <div className="reveal max-w-3xl">
      <PageHeader title="Search" subtitle={q ? `Results for “${q}”` : 'Search leads across every batch.'} />
      {q.length < 2 ? (
        <EmptyState icon={SearchIcon} title="Type to search" message="Enter at least 2 characters in the top-bar search box." />
      ) : isLoading ? (
        <LoadingState />
      ) : results.length === 0 ? (
        <EmptyState icon={SearchIcon} title="No matches" message={`Nothing matched “${q}”.`} />
      ) : (
        <Card className="divide-y divide-[var(--color-border)]">
          {results.slice(0, 50).map((l) => (
            <Link key={l.id} to={`/leads/manual/${l.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-[var(--color-surface-2)]">
              <div className="min-w-0">
                <p className="truncate font-medium">{l.display_name}</p>
                <p className="truncate text-[12px] text-[var(--color-text-muted)]">{[l.data['City'], l.data['Phone'], l.data['Website']].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              {l.lifecycle_state && <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[12px] text-[var(--color-text-secondary)]">{l.lifecycle_state}</span>}
            </Link>
          ))}
        </Card>
      )}
    </div>
  )
}
