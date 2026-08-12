-- Convert `practice_features` from multi-row (module, enabled) to single-row booleans.
-- Safe to run after earlier migrations.

create table if not exists public.practice_features_new (
  practice_id uuid not null references public.practices (id) on delete cascade,
  admissions boolean not null default false,
  admin_agent boolean not null default false,
  scribe boolean not null default false,
  billing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (practice_id)
);

insert into public.practice_features_new (practice_id, admissions, admin_agent, scribe, billing)
select
  pf.practice_id,
  bool_or(case when pf.module = 'admissions' then pf.enabled else false end) as admissions,
  bool_or(case when pf.module = 'admin_agent' then pf.enabled else false end) as admin_agent,
  bool_or(case when pf.module = 'scribe' then pf.enabled else false end) as scribe,
  bool_or(case when pf.module = 'billing' then pf.enabled else false end) as billing
from public.practice_features pf
group by pf.practice_id
on conflict (practice_id) do update set
  admissions = excluded.admissions,
  admin_agent = excluded.admin_agent,
  scribe = excluded.scribe,
  billing = excluded.billing;

drop trigger if exists practice_features_set_updated_at on public.practice_features;
drop table if exists public.practice_features;
alter table public.practice_features_new rename to practice_features;
create index if not exists practice_features_practice_id_idx on public.practice_features (practice_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger practice_features_set_updated_at
  before update on public.practice_features
  for each row execute function public.set_updated_at();

alter table public.practice_features enable row level security;

comment on table public.practice_features is 'One row per practice with boolean module entitlements.';
