import { createClient } from '@supabase/supabase-js'

// The project URL + publishable (anon) key are public client credentials — safe
// to ship in the browser. Env vars override for other environments.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://galylhveupjuatjkzora.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_ZDzPszYqSs7tn1kmUlxauA_Ds834ttL'

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
