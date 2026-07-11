-- External CRM integrations (#58). Per-org OAuth connection + push settings, plus a per-record sync
-- log so we never double-push and can show sync status. Tokens are secrets → RLS is enabled with
-- NO policies: only the service role (the `crm` edge function) can read/write. Clients never see
-- tokens; connection status is exposed only through the function's `status` action.
create table if not exists crm_connections (
  org_id               uuid    not null,
  provider             text    not null,          -- 'hubspot' | 'gohighlevel'
  access_token         text,
  refresh_token        text,
  token_expiry         timestamptz,
  external_account_id  text,                       -- hubspot portalId / ghl locationId
  account_label        text,
  auto_sync_qualified  boolean not null default false,  -- push every new qualified lead
  auto_sync_cold       boolean not null default false,  -- also push cold (non-qualified) leads
  connected_at         timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (org_id, provider)
);
alter table crm_connections enable row level security;

-- One row per (lead / cold place → CRM contact) push — dedup guard + status source.
create table if not exists crm_sync (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  provider     text not null,
  source_type  text not null,                      -- 'lead' | 'cold'
  source_id    text not null,                      -- leads.id (uuid) or sourced_places.place_id
  external_id  text,                               -- CRM contact id
  status       text not null default 'synced',     -- 'synced' | 'failed'
  error        text,
  synced_at    timestamptz not null default now(),
  unique (org_id, provider, source_type, source_id)
);
alter table crm_sync enable row level security;
create index if not exists crm_sync_lookup_idx on crm_sync (org_id, provider, source_type, source_id);
