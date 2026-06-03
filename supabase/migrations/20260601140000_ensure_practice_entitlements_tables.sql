-- Idempotent bootstrap: creates missing entitlement tables and aligns `practices`.
-- Run this in Supabase SQL editor if seed fails with "practice_users does not exist".

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- practices (create or add missing columns)
-- ---------------------------------------------------------------------------
create table if not exists public.practices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.practices add column if not exists slug text;
alter table public.practices add column if not exists onboarding_completed_at timestamptz;
alter table public.practices add column if not exists created_at timestamptz default now();
alter table public.practices add column if not exists updated_at timestamptz default now();

update public.practices
set slug = coalesce(
  nullif(trim(slug), ''),
  trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(name), ''), 'practice'), '[^a-z0-9]+', '-', 'g')))
    || '-'
    || left(replace(id::text, '-', ''), 8)
)
where slug is null or trim(slug) = '';

alter table public.practices alter column slug set not null;

create unique index if not exists practices_slug_key on public.practices (slug);
create index if not exists practices_slug_idx on public.practices (slug);

-- ---------------------------------------------------------------------------
-- practice_users
-- ---------------------------------------------------------------------------
create table if not exists public.practice_users (
  practice_id uuid not null references public.practices (id) on delete cascade,
  email text not null,
  role text not null default 'clinician',
  created_at timestamptz not null default now(),
  primary key (practice_id, email),
  constraint practice_users_email_unique unique (email),
  constraint practice_users_email_lowercase check (email = lower(email))
);

create index if not exists practice_users_email_idx on public.practice_users (email);

-- ---------------------------------------------------------------------------
-- practice_features (one row per practice)
-- ---------------------------------------------------------------------------
create table if not exists public.practice_features (
  practice_id uuid not null references public.practices (id) on delete cascade,
  admissions boolean not null default false,
  admin_agent boolean not null default false,
  scribe boolean not null default false,
  billing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (practice_id)
);

create index if not exists practice_features_practice_id_idx on public.practice_features (practice_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists practices_set_updated_at on public.practices;
create trigger practices_set_updated_at
  before update on public.practices
  for each row execute function public.set_updated_at();

drop trigger if exists practice_features_set_updated_at on public.practice_features;
create trigger practice_features_set_updated_at
  before update on public.practice_features
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (server uses service_role; no anon policies)
-- ---------------------------------------------------------------------------
alter table public.practices enable row level security;
alter table public.practice_users enable row level security;
alter table public.practice_features enable row level security;

comment on table public.practices is 'Tenant practices; feature access is configured per practice in practice_features.';
comment on table public.practice_users is 'Maps user email (Google sign-in) to a practice.';
comment on table public.practice_features is 'One row per practice with boolean module entitlements.';
