-- Practice entitlements (Layer B): which modules each practice has.
-- Halo ops edits these tables directly; the app does not let users change modules.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- practices
-- ---------------------------------------------------------------------------
create table if not exists public.practices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists practices_slug_idx on public.practices (slug);

-- ---------------------------------------------------------------------------
-- practice_users: maps a signed-in Google email to exactly one practice
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
-- practice_features: module flags per practice (source of truth for access)
-- ---------------------------------------------------------------------------
create table if not exists public.practice_features (
  practice_id uuid not null references public.practices (id) on delete cascade,
  module text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (practice_id, module),
  constraint practice_features_module_check check (
    module in ('admissions', 'admin_agent', 'scribe', 'billing')
  )
);

create index if not exists practice_features_practice_id_idx on public.practice_features (practice_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
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
-- RLS: no direct client access; halo-genesis server uses service_role key
-- ---------------------------------------------------------------------------
alter table public.practices enable row level security;
alter table public.practice_users enable row level security;
alter table public.practice_features enable row level security;

-- No policies for anon/authenticated roles → only service_role bypasses RLS from the API server.

comment on table public.practices is 'Tenant practices; feature access is configured per practice in practice_features.';
comment on table public.practice_users is 'Maps user email (Google sign-in) to a practice.';
comment on table public.practice_features is 'Module entitlements per practice. Edit enabled flags here to turn features on/off.';
comment on column public.practice_features.module is 'admissions | admin_agent | scribe | billing';
