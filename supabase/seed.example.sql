-- Example: provision a practice and enable modules (run in Supabase SQL editor).
--
-- STEP 1 (once): run supabase/migrations/20260601140000_ensure_practice_entitlements_tables.sql
-- STEP 2: edit the email below, then run this file.

insert into public.practices (name, slug, onboarding_completed_at)
values ('Demo Orthopaedic Practice', 'demo-ortho', now())
on conflict (slug) do update set name = excluded.name;

insert into public.practice_users (practice_id, email, role)
select p.id, 'doctor@example.com', 'clinician'
from public.practices p
where p.slug = 'demo-ortho'
on conflict (email) do update
  set practice_id = excluded.practice_id;

insert into public.practice_features (practice_id, admissions, admin_agent, scribe, billing)
select p.id, false, false, true, true
from public.practices p
where p.slug = 'demo-ortho'
on conflict (practice_id) do update set
  admissions = excluded.admissions,
  admin_agent = excluded.admin_agent,
  scribe = excluded.scribe,
  billing = excluded.billing;

-- Enable billing later for that practice:
-- update public.practice_features
-- set billing = true
-- from public.practices p
-- where practice_features.practice_id = p.id and p.slug = 'demo-ortho';
