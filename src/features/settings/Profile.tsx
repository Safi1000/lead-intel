import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsApi } from '../../api/endpoints'
import { Button, Card, FieldError, Input, Label } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'
import { passwordStrength } from '../auth/AuthLayout'

const profileSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email required'),
  timezone: z.string(),
  language: z.string(),
})
type ProfileForm = z.infer<typeof profileSchema>

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']

export function ProfileSettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['profile'], queryFn: settingsApi.getProfile })
  const form = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), values: data as ProfileForm | undefined })

  const save = useMutation({
    mutationFn: (d: ProfileForm) => settingsApi.updateProfile(d),
    onSuccess: () => { toast.success('Profile saved'); qc.invalidateQueries({ queryKey: ['profile'] }) },
    onError: () => toast.error('Couldn’t save profile'),
  })

  if (isLoading) return <LoadingState />

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="p-6">
        <h2 className="text-[16px] font-semibold">Profile</h2>
        <form onSubmit={form.handleSubmit((d) => save.mutate(d))} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register('name')} invalid={!!form.formState.errors.name} />
              <FieldError>{form.formState.errors.name?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...form.register('email')} invalid={!!form.formState.errors.email} />
              <FieldError>{form.formState.errors.email?.message}</FieldError>
              <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Changing email requires re-verification.</p>
            </div>
            <div>
              <Label htmlFor="timezone">Timezone</Label>
              <select id="timezone" {...form.register('timezone')} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] px-2 text-sm">
                {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="language">Language</Label>
              <select id="language" {...form.register('language')} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] px-2 text-sm">
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>Save changes</Button>
          </div>
        </form>
      </Card>

      <ChangePassword />
    </div>
  )
}

const pwSchema = z
  .object({ current: z.string().min(1, 'Required'), next: z.string().min(12, 'At least 12 characters'), confirm: z.string() })
  .refine((d) => d.next === d.confirm, { path: ['confirm'], message: 'Passwords don’t match' })
type PwForm = z.infer<typeof pwSchema>

function ChangePassword() {
  const form = useForm<PwForm>({ resolver: zodResolver(pwSchema), defaultValues: { current: '', next: '', confirm: '' } })
  const next = form.watch('next')
  const strength = passwordStrength(next)
  const save = useMutation({
    mutationFn: (d: PwForm) => settingsApi.changePassword({ current: d.current, next: d.next }),
    onSuccess: () => { toast.success('Password changed'); form.reset() },
    onError: () => toast.error('Couldn’t change password'),
  })
  useEffect(() => { if (save.isSuccess) form.reset() }, [save.isSuccess, form])

  return (
    <Card className="p-6">
      <h2 className="text-[16px] font-semibold">Change password</h2>
      <form onSubmit={form.handleSubmit((d) => save.mutate(d))} className="mt-4 space-y-4">
        <div>
          <Label htmlFor="current">Current password</Label>
          <Input id="current" type="password" {...form.register('current')} invalid={!!form.formState.errors.current} />
          <FieldError>{form.formState.errors.current?.message}</FieldError>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="next">New password</Label>
            <Input id="next" type="password" {...form.register('next')} invalid={!!form.formState.errors.next} />
            {next && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Strength: {strength.label}</p>}
            <FieldError>{form.formState.errors.next?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="confirm">Confirm</Label>
            <Input id="confirm" type="password" {...form.register('confirm')} invalid={!!form.formState.errors.confirm} />
            <FieldError>{form.formState.errors.confirm?.message}</FieldError>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={strength.score < 3}>Update password</Button>
        </div>
      </form>
    </Card>
  )
}
