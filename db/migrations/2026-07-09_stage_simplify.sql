-- Stage model simplified to New / Contacted / Interested / Booked / Voicemail / Follow-up.
-- Normalise any legacy stages (none existed at apply time, kept for safety/re-runs).
update leads set stage = case
  when stage = 'Won'     then 'Booked'
  when stage = 'Lost'    then 'Contacted'
  when stage = 'Not Now' then 'Follow-up'
  else stage end
where stage in ('Won','Lost','Not Now');

-- Update the CHECK constraint to the new stage set (the app writes Voicemail/Follow-up now).
alter table leads drop constraint if exists leads_stage_check;
alter table leads add constraint leads_stage_check
  check (stage = any (array['New','Contacted','Interested','Booked','Voicemail','Follow-up']));
