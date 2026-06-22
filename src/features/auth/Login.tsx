import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { authApi } from '../../api/endpoints'
import { useAuthStore } from '../../stores/authStore'
import { markSession, queryClient } from '../../app/providers'
import { normalizeError } from '../../api/client'
import { Button, FieldError, Input, Label } from '../../components/ui/primitives'
import { AuthLayout } from './AuthLayout'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional(),
})
type FormData = z.infer<typeof schema>

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const returnTo = params.get('returnTo')
  const { status, setSession } = useAuthStore()

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', remember: true },
  })

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: async (res) => {
      useAuthStore.getState().setToken(res.access_token)
      markSession()
      const me = await authApi.me()
      setSession({
        accessToken: res.access_token,
        user: me.user,
        client: me.client,
        role: me.role,
        flags: me.feature_flags,
        permissions: me.permissions,
        tosAcceptedAt: me.tos_accepted_at,
      })
      await queryClient.invalidateQueries()
      navigate(returnTo || '/home', { replace: true })
    },
  })

  useEffect(() => {
    if (login.error) form.setError('password', { message: normalizeError(login.error).message })
  }, [login.error, form])

  if (status === 'authenticated') return <Navigate to="/home" replace />

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Enter your credentials to continue.">
      <form onSubmit={form.handleSubmit((d) => login.mutate(d))} className="space-y-4" noValidate>
        {login.isError && (
          <div className="flex items-start gap-2 rounded-[8px] border border-red-200 bg-red-50 p-3 text-[13px] text-[var(--c-unverified-text)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{normalizeError(login.error).message}</span>
          </div>
        )}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" invalid={!!form.formState.errors.email} {...form.register('email')} />
          <FieldError>{form.formState.errors.email?.message}</FieldError>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="mb-1.5 text-[13px] text-[var(--color-primary)] hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" invalid={!!form.formState.errors.password} {...form.register('password')} />
          <FieldError>{form.formState.errors.password?.message}</FieldError>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...form.register('remember')} />
          Remember me
        </label>
        <Button type="submit" className="w-full" size="lg" loading={login.isPending}>
          Sign in
        </Button>
        <p className="rounded-[8px] bg-slate-50 p-3 text-center text-[12px] text-[var(--color-text-muted)]">
          Sign in with the account your administrator created for you.
        </p>
      </form>
    </AuthLayout>
  )
}
