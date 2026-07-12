-- Per-connection custom-field mapping. HubSpot property names are deterministic, but Pipedrive
-- assigns a random hash key per custom field, so we must remember what we created. Reset to null on
-- (re)connect so the schema re-provisions (e.g. after a scope upgrade).
alter table public.crm_connections add column if not exists field_map jsonb;
