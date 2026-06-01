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

insert into public.practice_features (practice_id, module, enabled)
select p.id, v.module, v.enabled
from public.practices p
cross join (
  values
    ('scribe', true),
    ('billing', true),
    ('admin_agent', false),
    ('admissions', false)
) as v(module, enabled)
where p.slug = 'demo-ortho'
on conflict (practice_id, module) do update set enabled = excluded.enabled;

-- Enable billing later for that practice:
-- update public.practice_features pf
-- set enabled = true
-- from public.practices p
-- where pf.practice_id = p.id and p.slug = 'demo-ortho' and pf.module = 'billing';
