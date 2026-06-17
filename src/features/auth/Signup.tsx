import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertCircle, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, FieldError, Input, Label } from '../../components/ui/primitives'
import { Checkbox } from '../../components/ui/controls'
import { AuthLayout, passwordStrength } from './AuthLayout'
import { cn } from '../../lib/utils'

const STEPS = ['Account', 'Intent', 'Verify', 'Terms', 'Done'] as const

interface IntentOption {
  id: string
  title: string
  desc: string
}
const INTENTS: IntentOption[] = [
  { id: 'agency', title: 'Agency / reseller', desc: 'Generate leads for multiple clients.' },
  { id: 'contractor', title: 'Contractor', desc: 'Find owner-level leads for my own trade.' },
  { id: 'marketer', title: 'In-house marketer', desc: 'Power campaigns with verified B2B leads.' },
]

export function SignupPage() {
  const [step, setStep] = useState(0)

  // Step 1
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  // Step 2
  const [intent, setIntent] = useState<string>('contractor')
  // Step 3
  const [code, setCode] = useState('')
  // Step 4
  const [acceptTos, setAcceptTos] = useState(false)
  const [acceptAup, setAcceptAup] = useState(false)

  const strength = passwordStrength(password)
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const emailTaken = email.toLowerCase().includes('taken')

  const step1Valid = company.trim().length > 1 && emailValid && !emailTaken && strength.score >= 3
  const codeValid = /^\d{6}$/.test(code)

  const submit = useMutation({
    // No real signup endpoint — simulate account creation.
    mutationFn: () => new Promise<void>((resolve) => setTimeout(resolve, 700)),
    onSuccess: () => {
      toast.success('Account created')
      setStep(4)
    },
    onError: () => toast.error('Could not create account. Please try again.'),
  })

  function next() {
    if (step === 3) submit.mutate()
    else setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const canNext =
    step === 0 ? step1Valid : step === 1 ? !!intent : step === 2 ? codeValid : step === 3 ? acceptTos && acceptAup : true

  const subtitle =
    step === 0
      ? 'Start finding verified owner-level leads in minutes.'
      : step === 1
        ? 'Tell us how you’ll use LeadIntel.'
        : step === 2
          ? 'Confirm your email to secure your account.'
          : step === 3
            ? 'Review and accept our policies.'
            : undefined

  return (
    <AuthLayout title={step === 4 ? 'You’re all set' : 'Create your account'} subtitle={subtitle}>
      {step < 4 && (
        <ol className="mb-6 flex items-center">
          {STEPS.slice(0, 4).map((label, i) => (
            <li key={label} className="flex flex-1 items-center last:flex-none">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold',
                  i < step
                    ? 'bg-[var(--color-primary)] text-white'
                    : i === step
                      ? 'border-2 border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
                )}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              {i < 3 && (
                <div className={cn('mx-2 h-px flex-1', i < step ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]')} />
              )}
            </li>
          ))}
        </ol>
      )}

      {/* Step 1 — Account */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <Label htmlFor="company">Company name</Label>
            <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Roofing" />
          </div>
          <div>
            <Label htmlFor="email">Admin email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              invalid={emailTouched && (!emailValid || emailTaken)}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
            />
            {emailTouched && emailTaken && (
              <FieldError>An account with this email already exists. Try signing in.</FieldError>
            )}
            {emailTouched && !emailTaken && !emailValid && <FieldError>Enter a valid email.</FieldError>}
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {password && (
              <div className="mt-2">
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1.5 flex-1 rounded-full',
                        i < strength.score
                          ? strength.score >= 3
                            ? 'bg-[var(--c-verified)]'
                            : 'bg-[var(--c-probable)]'
                          : 'bg-slate-200',
                      )}
                    />
                  ))}
                </div>
                <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Strength: {strength.label}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2 — Intent */}
      {step === 1 && (
        <div className="space-y-3">
          {INTENTS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setIntent(opt.id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-[12px] border p-4 text-left transition-colors',
                intent === opt.id ? 'border-[var(--color-primary)] bg-blue-50' : 'border-[var(--color-border)] hover:border-slate-300',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                  intent === opt.id ? 'border-[var(--color-primary)]' : 'border-slate-300',
                )}
              >
                {intent === opt.id && <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />}
              </span>
              <span>
                <span className="block text-sm font-semibold text-[var(--color-text)]">{opt.title}</span>
                <span className="mt-0.5 block text-[13px] text-[var(--color-text-secondary)]">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Step 3 — Verify */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-[8px] bg-slate-50 p-3 text-[13px] text-[var(--color-text-secondary)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              We sent a 6-digit code to <b>{email || 'your email'}</b>. Enter it below. (Demo: any 6 digits work.)
            </span>
          </div>
          <div>
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              inputMode="numeric"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-[20px] tracking-[0.4em] tabular-nums"
            />
          </div>
        </div>
      )}

      {/* Step 4 — Terms */}
      {step === 3 && (
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-[12px] border border-[var(--color-border)] p-4">
            <Checkbox checked={acceptTos} onCheckedChange={setAcceptTos} aria-label="Accept Terms of Service" />
            <span className="text-[13px] text-[var(--color-text-secondary)]">
              I agree to the{' '}
              <Link to="/terms" className="text-[var(--color-primary)] hover:underline">
                Terms of Service
              </Link>
              .
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-[12px] border border-[var(--color-border)] p-4">
            <Checkbox checked={acceptAup} onCheckedChange={setAcceptAup} aria-label="Accept Acceptable Use Policy" />
            <span className="text-[13px] text-[var(--color-text-secondary)]">
              I agree to the{' '}
              <Link to="/aup" className="text-[var(--color-primary)] hover:underline">
                Acceptable Use Policy
              </Link>{' '}
              and to honor opt-outs and consent requirements.
            </span>
          </label>
        </div>
      )}

      {/* Step 5 — Done */}
      {step === 4 && (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
            <Check className="h-7 w-7 text-[var(--c-verified)]" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Your account for <b>{company || 'your company'}</b> is ready. Sign in to launch your first run.
          </p>
          <Link to="/login">
            <Button className="w-full" size="lg">
              Go to sign in
            </Button>
          </Link>
        </div>
      )}

      {/* Nav */}
      {step < 4 && (
        <div className="mt-6 flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
          ) : (
            <Link to="/login" className="text-[13px] text-[var(--color-text-secondary)] hover:underline">
              Already have an account?
            </Link>
          )}
          <Button onClick={next} disabled={!canNext} loading={step === 3 && submit.isPending}>
            {step === 3 ? 'Create account' : 'Continue'} <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}

export function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const strength = passwordStrength(password)

  const accept = useMutation({
    // No real accept-invite endpoint — simulate.
    mutationFn: () => new Promise<void>((resolve) => setTimeout(resolve, 600)),
    onSuccess: () => {
      toast.success('Invitation accepted. Please sign in.')
      navigate('/login', { replace: true })
    },
    onError: () => toast.error('Could not accept invitation. Please try again.'),
  })

  if (!token) {
    return (
      <AuthLayout title="Invalid invitation">
        <p className="text-sm text-[var(--color-text-secondary)]">
          This invitation link is missing or invalid. Ask your admin to resend the invite.
        </p>
        <Link to="/login" className="mt-4 inline-block">
          <Button>Go to sign in</Button>
        </Link>
      </AuthLayout>
    )
  }

  const valid = name.trim().length > 1 && strength.score >= 3

  return (
    <AuthLayout title="Accept your invitation" subtitle="Set your name and password to join the team.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) accept.mutate()
        }}
        className="space-y-4"
        noValidate
      >
        <div>
          <Label htmlFor="invite-name">Full name</Label>
          <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="invite-password">Password</Label>
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password && (
            <div className="mt-2">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 flex-1 rounded-full',
                      i < strength.score
                        ? strength.score >= 3
                          ? 'bg-[var(--c-verified)]'
                          : 'bg-[var(--c-probable)]'
                        : 'bg-slate-200',
                    )}
                  />
                ))}
              </div>
              <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Strength: {strength.label}</p>
            </div>
          )}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={accept.isPending} disabled={!valid}>
          Join team
        </Button>
      </form>
    </AuthLayout>
  )
}
