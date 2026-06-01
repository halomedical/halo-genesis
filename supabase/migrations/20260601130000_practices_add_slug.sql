-- Repair: older `practices` tables created without `slug` (IF NOT EXISTS skipped new columns).
-- Safe to run multiple times.

alter table public.practices
  add column if not exists slug text;

alter table public.practices
  add column if not exists onboarding_completed_at timestamptz;

alter table public.practices
  add column if not exists created_at timestamptz default now();

alter table public.practices
  add column if not exists updated_at timestamptz default now();

-- Backfill slug for existing rows (unique per practice id)
update public.practices
set slug = coalesce(
  nullif(trim(slug), ''),
  trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(name), ''), 'practice'), '[^a-z0-9]+', '-', 'g')))
    || '-'
    || left(replace(id::text, '-', ''), 8)
)
where slug is null or trim(slug) = '';

-- Enforce slug required going forward
alter table public.practices
  alter column slug set not null;

create unique index if not exists practices_slug_key on public.practices (slug);

comment on column public.practices.slug is 'Stable URL-safe id for ops scripts and seed SQL (e.g. demo-ortho).';
