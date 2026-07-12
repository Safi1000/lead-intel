-- More CRM providers (Pipedrive, Zoho, Salesforce, generic Webhook) on top of HubSpot + GoHighLevel.
-- Some providers hand back a per-tenant API base (Pipedrive api_domain, Salesforce instance_url,
-- Zoho api_domain) that later contact-create calls must hit; the webhook provider stores a target URL
-- instead of OAuth tokens.
alter table public.crm_connections add column if not exists api_base    text;
alter table public.crm_connections add column if not exists webhook_url text;
