-- CRM OAuth client credentials in the DB (not just function env vars).
-- Supabase edge-function secret propagation can lag/flap across isolates for minutes after a
-- `secrets set`, so a freshly-added provider intermittently reads as "not configured". The DB is
-- consistent across every isolate, so we read client creds here first and fall back to env.
-- Service-role only (RLS on, no policies) — same trust level as the OAuth tokens in crm_connections.
create table if not exists public.crm_provider_config (
  provider      text primary key,
  client_id     text not null default '',
  client_secret text not null default '',
  updated_at    timestamptz not null default now()
);
alter table public.crm_provider_config enable row level security;

insert into public.crm_provider_config (provider, client_id, client_secret)
values ('pipedrive', '193064260550a0f9', 'ce8028f94d24979fa40c7de2324601d448ef7886')
on conflict (provider) do update set client_id = excluded.client_id, client_secret = excluded.client_secret, updated_at = now();
