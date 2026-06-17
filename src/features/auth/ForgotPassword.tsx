import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { authApi } from '../../api/endpoints'
import { Button, FieldError, Input, Label } from '../../components/ui/primitives'
import { AuthLayout } from './AuthLayout'

const schema = z.object({ email: z.string().email('Enter a valid email') })
type FormData = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { email: '' } })
  const request = useMutation({ mutationFn: authApi.forgotPassword })

  if (request.isSuccess) {
    return (
      <AuthLayout title="Check your email">
        <div className="rounded-[12px] border border-[var(--color-border)] bg-slate-50 p-5 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--c-verified)]" />
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            If an account exists for that email, we’ve sent a password reset link. It expires in 30 minutes.
          </p>
        </div>
        <Link to="/login" className="mt-4 inline-block text-sm text-[var(--color-primary)] hover:underline">
          ← Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we’ll send a reset link.">
      <form onSubmit={form.handleSubmit((d) => request.mutate(d))} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" invalid={!!form.formState.errors.email} {...form.register('email')} />
          <FieldError>{form.formState.errors.email?.message}</FieldError>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={request.isPending}>
          Send reset link
        </Button>
        <Link to="/login" className="block text-center text-sm text-[var(--color-primary)] hover:underline">
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  )
}
