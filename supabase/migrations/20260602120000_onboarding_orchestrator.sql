-- Onboarding orchestrator schema:
-- - Specialty + subspecialty taxonomy
-- - Default auto-enabled modules by specialty/subspecialty
-- - Per-user selected modules during onboarding

create extension if not exists "pgcrypto";

create table if not exists public.specialties (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.subspecialties (
  id uuid primary key default gen_random_uuid(),
  specialty_id uuid not null references public.specialties (id) on delete cascade,
  key text not null unique,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.specialty_module_defaults (
  specialty_id uuid primary key references public.specialties (id) on delete cascade,
  admissions boolean not null default false,
  admin_agent boolean not null default false,
  scribe boolean not null default false,
  billing boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.subspecialty_module_defaults (
  subspecialty_id uuid primary key references public.subspecialties (id) on delete cascade,
  admissions boolean not null default false,
  admin_agent boolean not null default false,
  scribe boolean not null default false,
  billing boolean not null default false,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists specialty_module_defaults_set_updated_at on public.specialty_module_defaults;
create trigger specialty_module_defaults_set_updated_at
  before update on public.specialty_module_defaults
  for each row execute function public.set_updated_at();

drop trigger if exists subspecialty_module_defaults_set_updated_at on public.subspecialty_module_defaults;
create trigger subspecialty_module_defaults_set_updated_at
  before update on public.subspecialty_module_defaults
  for each row execute function public.set_updated_at();

alter table public.specialties enable row level security;
alter table public.subspecialties enable row level security;
alter table public.specialty_module_defaults enable row level security;
alter table public.subspecialty_module_defaults enable row level security;

insert into public.specialties (key, label)
values
  ('orthopedic', 'Orthopedic'),
  ('urology', 'Urology'),
  ('general', 'General Practice')
on conflict (key) do update set label = excluded.label;

insert into public.subspecialties (specialty_id, key, label)
select s.id, t.key, t.label
from public.specialties s
join (
  values
    ('orthopedic', 'ortho-shoulder', 'Orthopedic - Shoulder'),
    ('orthopedic', 'ortho-knee', 'Orthopedic - Knee'),
    ('urology', 'urology-general', 'Urology - General')
) as t(specialty_key, key, label)
  on t.specialty_key = s.key
on conflict (key) do update set
  specialty_id = excluded.specialty_id,
  label = excluded.label;

insert into public.specialty_module_defaults (specialty_id, admissions, admin_agent, scribe, billing)
select s.id, v.admissions, v.admin_agent, v.scribe, v.billing
from public.specialties s
join (
  values
    ('orthopedic', true, false, true, true),
    ('urology', true, false, true, true),
    ('general', false, false, true, false)
) as v(specialty_key, admissions, admin_agent, scribe, billing)
  on v.specialty_key = s.key
on conflict (specialty_id) do update set
  admissions = excluded.admissions,
  admin_agent = excluded.admin_agent,
  scribe = excluded.scribe,
  billing = excluded.billing;

insert into public.subspecialty_module_defaults (subspecialty_id, admissions, admin_agent, scribe, billing)
select ss.id, v.admissions, v.admin_agent, v.scribe, v.billing
from public.subspecialties ss
join (
  values
    ('ortho-shoulder', true, false, true, true),
    ('ortho-knee', true, false, true, true),
    ('urology-general', true, false, true, true)
) as v(subspecialty_key, admissions, admin_agent, scribe, billing)
  on v.subspecialty_key = ss.key
on conflict (subspecialty_id) do update set
  admissions = excluded.admissions,
  admin_agent = excluded.admin_agent,
  scribe = excluded.scribe,
  billing = excluded.billing;

comment on table public.specialties is 'Clinical specialties shown during onboarding.';
comment on table public.subspecialties is 'Subspecialties linked to specialties (e.g. ortho shoulder/knee).';
comment on table public.specialty_module_defaults is 'Auto-enabled module defaults per specialty.';
comment on table public.subspecialty_module_defaults is 'Auto-enabled module defaults per subspecialty.';
