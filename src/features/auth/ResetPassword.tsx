import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { authApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, FieldError, Input, Label } from '../../components/ui/primitives'
import { AuthLayout, passwordStrength } from './AuthLayout'
import { cn } from '../../lib/utils'

const schema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Passwords don’t match' })
type FormData = z.infer<typeof schema>

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } })
  const pw = form.watch('password')
  const strength = passwordStrength(pw)

  const reset = useMutation({
    mutationFn: () => authApi.resetPassword({ token, password: pw }),
    onSuccess: () => {
      toast.success('Password updated. Please sign in.')
      navigate('/login', { replace: true })
    },
  })

  if (!token) {
    return (
      <AuthLayout title="Invalid link">
        <p className="text-sm text-[var(--color-text-secondary)]">
          This reset link is missing a token. Request a new one.
        </p>
        <Link to="/forgot-password" className="mt-4 inline-block">
          <Button>Request new link</Button>
        </Link>
      </AuthLayout>
    )
  }

  const expired = reset.isError && normalizeError(reset.error).code === 'token_expired'

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password (12+ characters).">
      {expired ? (
        <div className="rounded-[12px] border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-[var(--c-unverified-text)]">This reset link has expired.</p>
          <Link to="/forgot-password" className="mt-3 inline-block">
            <Button variant="outline">Request a new link</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(() => reset.mutate())} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="password">New password</Label>
            <Input id="password" type="password" invalid={!!form.formState.errors.password} {...form.register('password')} />
            {pw && (
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
            <FieldError>{form.formState.errors.password?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" invalid={!!form.formState.errors.confirm} {...form.register('confirm')} />
            <FieldError>{form.formState.errors.confirm?.message}</FieldError>
          </div>
          <Button type="submit" className="w-full" size="lg" loading={reset.isPending} disabled={strength.score < 3}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
