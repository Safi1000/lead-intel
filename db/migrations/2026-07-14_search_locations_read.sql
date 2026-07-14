-- search_locations is non-sensitive reference data (the city pool shown in the Sourcing
-- country picker). RLS was enabled with no policies, so browser reads returned nothing and
-- the picker hung on "Loading coverage…". Allow any signed-in user to read it. Writes stay
-- service-role only (the engine seeds it), which bypasses RLS regardless.
create policy "authenticated can read search_locations"
  on public.search_locations
  for select
  to authenticated
  using (true);
