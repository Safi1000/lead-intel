import { useMutation } from '@tanstack/react-query'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { authApi } from '../../api/endpoints'
import { useAuthStore } from '../../stores/authStore'
import { Button, Card } from '../../components/ui/primitives'

const COPY: Record<string, { title: string; body: string }> = {
  terms: {
    title: 'Terms of Service',
    body: 'These terms govern your use of the Lead Intelligence Platform. Leads are provided for legitimate B2B outreach only; you agree to comply with all applicable telemarketing, anti-spam, and data-protection laws (TCPA, CAN-SPAM, CCPA). Data is delivered as enriched estimates and is not guaranteed.',
  },
  privacy: {
    title: 'Privacy Policy',
    body: 'We process business contact data from public and licensed sources to deliver enrichment. We retain account data for the life of your account and honor deletion requests subject to a retention window. We never sell your run inputs to other tenants.',
  },
  aup: {
    title: 'Acceptable Use Policy',
    body: 'You may not use delivered data for harassment, fraud, or any unlawful purpose. Bulk messaging must respect opt-outs and consent requirements. Abuse may result in suspension.',
  },
}

export function LegalPage({ doc }: { doc: 'terms' | 'privacy' | 'aup' }) {
  const [params] = useSearchParams()
  const isGate = params.get('gate') === '1' && doc === 'terms'
  const navigate = useNavigate()
  const acceptTos = useAuthStore((s) => s.acceptTos)
  const accept = useMutation({
    mutationFn: authApi.acceptTos,
    onSuccess: (res) => {
      acceptTos(res.tos_accepted_at)
      toast.success('Terms accepted')
      navigate('/home', { replace: true })
    },
  })
  const copy = COPY[doc]

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Card className="p-8">
        <h1 className="text-[24px] font-bold">{copy.title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">{copy.body}</p>
        <div className="mt-6 space-y-3 text-[13px] text-[var(--color-text-muted)]">
          <p>Last updated June 2026. This is demo legal copy for the LeadIntel showcase build.</p>
        </div>

        {isGate ? (
          <div className="mt-8 rounded-[12px] border border-[var(--color-border)] bg-slate-50 p-4">
            <p className="text-sm font-medium">You must accept the Terms of Service to continue.</p>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              By continuing you also agree to the{' '}
              <Link to="/aup" className="text-[var(--color-primary)] hover:underline">Acceptable Use Policy</Link>.
            </p>
            <Button className="mt-4" loading={accept.isPending} onClick={() => accept.mutate()}>
              Accept &amp; continue
            </Button>
          </div>
        ) : (
          <Link to="/home" className="mt-8 inline-block">
            <Button variant="outline">Back</Button>
          </Link>
        )}
      </Card>
    </div>
  )
}
