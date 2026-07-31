-- Beamer / Heimdall server-side control plane.
-- All access is mediated by halo-genesis with the server-only service role.

create extension if not exists "pgcrypto";

alter table public.practice_features
  add column if not exists beamer boolean not null default false;

-- Operational authority is separate from the user-editable clinical role used
-- by onboarding. Existing practices receive one deterministic initial owner.
alter table public.practice_users
  add column if not exists access_role text not null default 'member'
  check (access_role in ('owner', 'admin', 'member'));

with ranked_members as (
  select
    practice_id,
    email,
    row_number() over (partition by practice_id order by created_at asc, email asc) as member_rank
  from public.practice_users
)
update public.practice_users pu
set access_role = 'owner'
from ranked_members ranked
where pu.practice_id = ranked.practice_id
  and pu.email = ranked.email
  and ranked.member_rank = 1
  and pu.access_role = 'member';

comment on column public.practice_users.access_role is
  'Server-managed practice authority. Never writable from clinical onboarding payloads.';

create table if not exists public.beamer_practice_config (
  practice_id uuid primary key references public.practices (id) on delete cascade,
  google_subject_email text not null,
  patient_root_id text,
  shared_drive_id text,
  shared_drive_name text,
  review_folder_id text,
  provisioning_status text not null default 'not_started'
    check (provisioning_status in ('not_started', 'provisioning', 'ready', 'failed')),
  provisioning_error text,
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists beamer_practice_config_drive_id_key
  on public.beamer_practice_config (shared_drive_id)
  where shared_drive_id is not null;

create table if not exists public.beamer_enrollment_tokens (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices (id) on delete cascade,
  token_hash char(64) not null unique,
  created_by_email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  installation_id uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists beamer_enrollment_tokens_practice_idx
  on public.beamer_enrollment_tokens (practice_id, expires_at desc);
create unique index if not exists beamer_enrollment_tokens_one_live_per_practice_idx
  on public.beamer_enrollment_tokens (practice_id)
  where used_at is null and revoked_at is null;

create table if not exists public.beamer_devices (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices (id) on delete cascade,
  device_token_hash char(64) not null unique,
  installation_id uuid not null,
  display_name text not null,
  platform text not null default 'windows' check (platform = 'windows'),
  agent_version text,
  config_schema_version integer not null default 3 check (config_schema_version = 3),
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  pending_upload_count integer not null default 0 check (pending_upload_count >= 0),
  pending_review_count integer not null default 0 check (pending_review_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists beamer_devices_one_active_per_practice_idx
  on public.beamer_devices (practice_id)
  where revoked_at is null;
create unique index if not exists beamer_devices_installation_idx
  on public.beamer_devices (practice_id, installation_id)
  where revoked_at is null;

create index if not exists beamer_devices_token_hash_idx
  on public.beamer_devices (device_token_hash)
  where revoked_at is null;

create table if not exists public.beamer_practice_patients (
  practice_id uuid not null references public.practices (id) on delete cascade,
  patient_id text not null,
  verified_subject_email text not null,
  display_name text,
  verified_at timestamptz not null default now(),
  primary key (practice_id, patient_id)
);

create table if not exists public.beamer_assets (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices (id) on delete cascade,
  patient_id text,
  device_id uuid references public.beamer_devices (id) on delete set null,
  drive_file_id text not null,
  client_id text not null,
  source text not null check (source in ('windows', 'mobile')),
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'rejected')),
  processing_status text not null default 'processing'
    check (processing_status in ('uploading', 'processing', 'ready', 'failed')),
  captured_at timestamptz not null,
  uploaded_by_email text,
  review_reason_code text,
  reviewed_by_email text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practice_id, drive_file_id)
);
create unique index if not exists beamer_assets_client_id_key
  on public.beamer_assets (practice_id, source, client_id);

create index if not exists beamer_assets_recent_idx
  on public.beamer_assets (practice_id, captured_at desc);
create index if not exists beamer_assets_patient_approved_idx
  on public.beamer_assets (practice_id, patient_id, captured_at desc)
  where review_status = 'approved' and processing_status = 'ready';
create index if not exists beamer_assets_review_queue_idx
  on public.beamer_assets (practice_id, created_at desc)
  where review_status = 'pending_review';

drop trigger if exists beamer_practice_config_set_updated_at on public.beamer_practice_config;
create trigger beamer_practice_config_set_updated_at
  before update on public.beamer_practice_config
  for each row execute function public.set_updated_at();

drop trigger if exists beamer_devices_set_updated_at on public.beamer_devices;
create trigger beamer_devices_set_updated_at
  before update on public.beamer_devices
  for each row execute function public.set_updated_at();

drop trigger if exists beamer_assets_set_updated_at on public.beamer_assets;
create trigger beamer_assets_set_updated_at
  before update on public.beamer_assets
  for each row execute function public.set_updated_at();

alter table public.beamer_practice_config enable row level security;
alter table public.beamer_enrollment_tokens enable row level security;
alter table public.beamer_devices enable row level security;
alter table public.beamer_practice_patients enable row level security;
alter table public.beamer_assets enable row level security;

-- Existing projects may still auto-grant public-schema tables. Revoke client
-- access explicitly, then opt the server-only service role into the Data API.
revoke all on table public.beamer_practice_config from anon, authenticated;
revoke all on table public.beamer_enrollment_tokens from anon, authenticated;
revoke all on table public.beamer_devices from anon, authenticated;
revoke all on table public.beamer_practice_patients from anon, authenticated;
revoke all on table public.beamer_assets from anon, authenticated;

grant select, insert, update, delete on table public.beamer_practice_config to service_role;
grant select, insert, update, delete on table public.beamer_enrollment_tokens to service_role;
grant select, insert, update, delete on table public.beamer_devices to service_role;
grant select, insert, update, delete on table public.beamer_practice_patients to service_role;
grant select, insert, update, delete on table public.beamer_assets to service_role;

-- Atomically revoke any unused setup code and issue exactly one live code.
create or replace function public.beamer_create_enrollment(
  p_practice_id uuid,
  p_token_hash text,
  p_created_by_email text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update public.beamer_enrollment_tokens
  set revoked_at = now()
  where practice_id = p_practice_id and used_at is null and revoked_at is null;

  insert into public.beamer_enrollment_tokens (practice_id, token_hash, created_by_email, expires_at)
  values (p_practice_id, p_token_hash, lower(p_created_by_email), p_expires_at)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.beamer_create_enrollment(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.beamer_create_enrollment(uuid, text, text, timestamptz) to service_role;

-- Atomically consumes a one-time enrollment token, revokes the prior machine,
-- and installs exactly one new active Windows device for the practice.
create or replace function public.beamer_enroll_device(
  p_token_hash text,
  p_device_token_hash text,
  p_installation_id uuid,
  p_display_name text,
  p_agent_version text default null
)
returns table (
  practice_id uuid,
  device_id uuid,
  resumed boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_token public.beamer_enrollment_tokens%rowtype;
  v_device_id uuid;
begin
  select * into v_token
  from public.beamer_enrollment_tokens t
  where t.token_hash = p_token_hash
    and t.revoked_at is null
    and t.expires_at > now()
  for update;

  if not found then
    return;
  end if;

  if v_token.used_at is not null then
    if v_token.installation_id is distinct from p_installation_id then
      return;
    end if;
    update public.beamer_devices
    set device_token_hash = p_device_token_hash,
        display_name = left(p_display_name, 120),
        agent_version = nullif(left(coalesce(p_agent_version, ''), 64), '')
    where beamer_devices.practice_id = v_token.practice_id
      and installation_id = p_installation_id
      and revoked_at is null
    returning id into v_device_id;
    if v_device_id is null then return; end if;
    return query select v_token.practice_id, v_device_id, true;
    return;
  end if;

  update public.beamer_enrollment_tokens
  set used_at = now(), installation_id = p_installation_id
  where id = v_token.id;

  update public.beamer_devices
  set revoked_at = now()
  where beamer_devices.practice_id = v_token.practice_id
    and revoked_at is null;

  insert into public.beamer_devices (
    practice_id,
    device_token_hash,
    installation_id,
    display_name,
    platform,
    agent_version
  ) values (
    v_token.practice_id,
    p_device_token_hash,
    p_installation_id,
    left(p_display_name, 120),
    'windows',
    nullif(left(coalesce(p_agent_version, ''), 64), '')
  )
  returning id into v_device_id;

  return query
  select v_token.practice_id, v_device_id, false;
end;
$$;

revoke all on function public.beamer_enroll_device(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.beamer_enroll_device(text, text, uuid, text, text) to service_role;

comment on table public.beamer_enrollment_tokens is 'Hashed, expiring, single-use Heimdall device enrollment credentials.';
comment on table public.beamer_devices is 'One active Windows Heimdall agent per practice; historical rows are retained after revocation.';
comment on table public.beamer_assets is 'De-identified Beamer upload metadata only; never original filenames or OCR text.';
