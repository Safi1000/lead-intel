-- Gmail send-on-behalf. Stores each user's Google OAuth tokens so the `gmail` edge function can
-- send email from their own mailbox (hamna@techxserve.com). Secrets live here, so RLS is enabled
-- with NO policies: only the service role (the edge function) can ever read/write. Browser clients
-- never see a refresh token — connection status is exposed only through the function's `status` action.
create table if not exists email_accounts (
  user_id       uuid primary key references profiles(id) on delete cascade,
  provider      text not null default 'gmail',
  email         text,
  refresh_token text not null,
  access_token  text,
  token_expiry  timestamptz,
  scopes        text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table email_accounts enable row level security;
-- Intentionally no policies → service role only.
