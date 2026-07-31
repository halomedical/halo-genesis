-- Example: provision a practice and enable modules (run in Supabase SQL editor).
--
-- STEP 1 (once): run supabase/migrations/20260601140000_ensure_practice_entitlements_tables.sql
--         and supabase/migrations/20260602120000_onboarding_orchestrator.sql
-- STEP 2: edit the email below, then run this file.

insert into public.practices (name, slug, onboarding_completed_at)
values ('Demo Orthopaedic Practice', 'demo-ortho', now())
on conflict (slug) do update set name = excluded.name;

insert into public.practice_users (practice_id, email, role, access_role)
select p.id, 'doctor@example.com', 'clinician', 'owner'
from public.practices p
where p.slug = 'demo-ortho'
on conflict (email) do update
  set practice_id = excluded.practice_id,
      role = excluded.role;

insert into public.practice_features (practice_id, admissions, admin_agent, scribe, billing, beamer)
select p.id, false, false, true, true, false
from public.practices p
where p.slug = 'demo-ortho'
on conflict (practice_id) do update set
  admissions = excluded.admissions,
  admin_agent = excluded.admin_agent,
  scribe = excluded.scribe,
  billing = excluded.billing,
  beamer = excluded.beamer;

update public.practice_users pu
set
  specialty_id = s.id,
  subspecialty_id = ss.id,
  onboarding_completed_at = now()
from public.specialties s
left join public.subspecialties ss on ss.key = 'ortho-shoulder'
where pu.email = 'doctor@example.com'
  and s.key = 'orthopedic';

-- Enable billing later for that practice:
-- update public.practice_features
-- set billing = true
-- from public.practices p
-- where practice_features.practice_id = p.id and p.slug = 'demo-ortho';

-- Enable Beamer only after the Workspace provisioner is configured server-side:
-- update public.practice_features
-- set beamer = true
-- from public.practices p
-- where practice_features.practice_id = p.id and p.slug = 'demo-ortho';
