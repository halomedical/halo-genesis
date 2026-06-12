-- =============================================================================
-- Halo Core (Supabase) — ADDITIVE ONLY
-- Form Intelligence: global PDF layout cache (no PHI, no practice_id).
-- Safe to run multiple times on an existing project. Does not DROP tables or data.
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- =============================================================================

-- Tables
create table if not exists public.form_templates (
  pdf_hash text primary key,
  schema_json jsonb not null,
  extraction_method text not null default 'matchmaker',
  schema_version integer not null default 1,
  hit_count bigint not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.form_templates is
  'Global layout flywheel: anonymous PDF fingerprints → perfected JSON schemas. No patient data.';

create index if not exists form_templates_updated_at_idx
  on public.form_templates (updated_at desc);

create table if not exists public.form_template_promotions (
  id uuid primary key default gen_random_uuid(),
  pdf_hash text not null references public.form_templates (pdf_hash) on delete cascade,
  promoted_by text,
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.form_template_promotions is
  'Optional audit trail when a layout is promoted to global cache (no PHI).';

-- RLS (backend service_role only; browser never queries these tables directly)
alter table public.form_templates enable row level security;
alter table public.form_template_promotions enable row level security;

drop policy if exists "service_role_all_form_templates" on public.form_templates;
create policy "service_role_all_form_templates"
  on public.form_templates
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_all_form_template_promotions" on public.form_template_promotions;
create policy "service_role_all_form_template_promotions"
  on public.form_template_promotions
  for all
  to service_role
  using (true)
  with check (true);

-- Hit counter (cache flywheel metrics)
create or replace function public.increment_form_template_hit(p_pdf_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.form_templates
  set
    hit_count = hit_count + 1,
    last_hit_at = now(),
    updated_at = now()
  where pdf_hash = p_pdf_hash;
end;
$$;

revoke all on function public.increment_form_template_hit(text) from public;
grant execute on function public.increment_form_template_hit(text) to service_role;

-- Layout correction telemetry (on save from Template Studio)
create table if not exists public.form_layout_corrections (
  id uuid primary key default gen_random_uuid(),
  pdf_hash text not null,
  baseline_extraction_method text,
  baseline_schema_version integer,
  field_changes jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  saved_by text,
  created_at timestamptz not null default now()
);

comment on table public.form_layout_corrections is
  'Per-save snapshots of field layout corrections (coordinates/labels only; no patient data).';

create index if not exists form_layout_corrections_pdf_hash_idx
  on public.form_layout_corrections (pdf_hash);

create index if not exists form_layout_corrections_created_at_idx
  on public.form_layout_corrections (created_at desc);

alter table public.form_layout_corrections enable row level security;

drop policy if exists "service_role_all_form_layout_corrections" on public.form_layout_corrections;
create policy "service_role_all_form_layout_corrections"
  on public.form_layout_corrections
  for all
  to service_role
  using (true)
  with check (true);

-- PDF extraction duration telemetry (no PHI): ETA flywheel for upload/extract UX.
create table if not exists public.pdf_extraction_telemetry (
  id uuid primary key default gen_random_uuid(),
  pdf_hash text,
  file_size_bytes bigint not null,
  duration_ms integer not null,
  cache_hit boolean not null default false,
  extraction_method text,
  flow text not null check (flow in ('extract_api', 'template_upload')),
  success boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.pdf_extraction_telemetry is
  'Per-run PDF schema extraction timing for padded ETA estimates. No patient data.';

create index if not exists pdf_extraction_telemetry_created_at_idx
  on public.pdf_extraction_telemetry (created_at desc);

create index if not exists pdf_extraction_telemetry_estimate_idx
  on public.pdf_extraction_telemetry (flow, cache_hit, file_size_bytes, created_at desc);

alter table public.pdf_extraction_telemetry enable row level security;

drop policy if exists "service_role_all_pdf_extraction_telemetry" on public.pdf_extraction_telemetry;
create policy "service_role_all_pdf_extraction_telemetry"
  on public.pdf_extraction_telemetry
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.median_pdf_extraction_duration_ms(
  p_file_size_bytes bigint,
  p_flow text,
  p_lookback interval default interval '90 days'
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    percentile_cont(0.5) within group (order by duration_ms)
  )::integer
  from public.pdf_extraction_telemetry
  where success = true
    and cache_hit = false
    and flow = p_flow
    and created_at >= now() - p_lookback
    and file_size_bytes >= (p_file_size_bytes * 0.5)::bigint
    and file_size_bytes <= (p_file_size_bytes * 1.5)::bigint;
$$;

revoke all on function public.median_pdf_extraction_duration_ms(bigint, text, interval) from public;
grant execute on function public.median_pdf_extraction_duration_ms(bigint, text, interval) to service_role;

-- Human-in-the-loop PDF mapping corrections (no PHI). Future: org_id/tenant_id on runs/corrections.
create table if not exists public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pdf_sha256 text not null,
  source_filename text,
  pipeline_version text,
  coordinate_system text,
  semantic_model text,
  matchmaker_model text,
  prediction_json jsonb not null,
  physical_text_block_count integer,
  pdf_storage_path text,
  created_by uuid references auth.users (id)
);

comment on table public.extraction_runs is
  'Snapshot of PDF coordinate extractor API response per run. Coordinates only; no patient data. Future: org_id/tenant_id.';

comment on column public.extraction_runs.pdf_storage_path is
  'Optional Supabase Storage object path; raw PDF bytes are not stored in Postgres.';

create index if not exists extraction_runs_pdf_sha256_idx
  on public.extraction_runs (pdf_sha256);

create index if not exists extraction_runs_created_at_idx
  on public.extraction_runs (created_at desc);

create index if not exists extraction_runs_created_by_idx
  on public.extraction_runs (created_by);

create table if not exists public.mapping_corrections (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.extraction_runs (id) on delete cascade,
  created_at timestamptz not null default now(),
  approved_at timestamptz not null default now(),
  reviewer_id uuid references auth.users (id),
  pdf_sha256 text not null,
  pipeline_version text,
  validated_json jsonb not null,
  edit_summary jsonb,
  notes text,
  constraint mapping_corrections_one_per_run_key unique (extraction_run_id)
);

comment on table public.mapping_corrections is
  'Human-approved field mapping for one extraction run. Future: org_id/tenant_id.';

create index if not exists mapping_corrections_pdf_sha256_idx
  on public.mapping_corrections (pdf_sha256);

create index if not exists mapping_corrections_reviewer_id_idx
  on public.mapping_corrections (reviewer_id);

create index if not exists mapping_corrections_approved_at_idx
  on public.mapping_corrections (approved_at desc);

create table if not exists public.mapping_correction_fields (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.mapping_corrections (id) on delete cascade,
  pdf_sha256 text not null,
  field_id text not null,
  page integer not null,
  label text,
  field_type text,
  pred_x double precision,
  pred_y double precision,
  pred_width double precision,
  pred_height double precision,
  valid_x double precision not null,
  valid_y double precision not null,
  valid_width double precision not null,
  valid_height double precision not null,
  action text check (
    action in ('unchanged', 'move', 'resize', 'add', 'delete', 'relabel')
  )
);

comment on table public.mapping_correction_fields is
  'Per-field prediction vs validated coordinates for analytics and model training.';

create index if not exists mapping_correction_fields_correction_id_idx
  on public.mapping_correction_fields (correction_id);

create index if not exists mapping_correction_fields_pdf_sha256_idx
  on public.mapping_correction_fields (pdf_sha256);

create index if not exists mapping_correction_fields_field_id_idx
  on public.mapping_correction_fields (field_id);

create index if not exists mapping_correction_fields_pdf_sha256_field_id_idx
  on public.mapping_correction_fields (pdf_sha256, field_id);

alter table public.extraction_runs enable row level security;
alter table public.mapping_corrections enable row level security;
alter table public.mapping_correction_fields enable row level security;

drop policy if exists "service_role_all_extraction_runs" on public.extraction_runs;
create policy "service_role_all_extraction_runs"
  on public.extraction_runs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "authenticated_insert_extraction_runs" on public.extraction_runs;
create policy "authenticated_insert_extraction_runs"
  on public.extraction_runs
  for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "authenticated_select_extraction_runs" on public.extraction_runs;
create policy "authenticated_select_extraction_runs"
  on public.extraction_runs
  for select
  to authenticated
  using (created_by = auth.uid());

drop policy if exists "service_role_all_mapping_corrections" on public.mapping_corrections;
create policy "service_role_all_mapping_corrections"
  on public.mapping_corrections
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "authenticated_insert_mapping_corrections" on public.mapping_corrections;
create policy "authenticated_insert_mapping_corrections"
  on public.mapping_corrections
  for insert
  to authenticated
  with check (
    reviewer_id = auth.uid()
    or exists (
      select 1
      from public.extraction_runs r
      where r.id = extraction_run_id
        and r.created_by = auth.uid()
    )
  );

drop policy if exists "authenticated_select_mapping_corrections" on public.mapping_corrections;
create policy "authenticated_select_mapping_corrections"
  on public.mapping_corrections
  for select
  to authenticated
  using (
    reviewer_id = auth.uid()
    or exists (
      select 1
      from public.extraction_runs r
      where r.id = extraction_run_id
        and r.created_by = auth.uid()
    )
  );

drop policy if exists "service_role_all_mapping_correction_fields" on public.mapping_correction_fields;
create policy "service_role_all_mapping_correction_fields"
  on public.mapping_correction_fields
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "authenticated_insert_mapping_correction_fields" on public.mapping_correction_fields;
create policy "authenticated_insert_mapping_correction_fields"
  on public.mapping_correction_fields
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.mapping_corrections mc
      left join public.extraction_runs r on r.id = mc.extraction_run_id
      where mc.id = correction_id
        and (
          mc.reviewer_id = auth.uid()
          or r.created_by = auth.uid()
        )
    )
  );

drop policy if exists "authenticated_select_mapping_correction_fields" on public.mapping_correction_fields;
create policy "authenticated_select_mapping_correction_fields"
  on public.mapping_correction_fields
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.mapping_corrections mc
      left join public.extraction_runs r on r.id = mc.extraction_run_id
      where mc.id = correction_id
        and (
          mc.reviewer_id = auth.uid()
          or r.created_by = auth.uid()
        )
    )
  );

grant select, insert on public.extraction_runs to authenticated;
grant select, insert on public.mapping_corrections to authenticated;
grant select, insert on public.mapping_correction_fields to authenticated;

create or replace view public.correction_field_deltas
with (security_invoker = true) as
select
  f.id,
  f.correction_id,
  f.pdf_sha256,
  f.field_id,
  f.page,
  f.action,
  f.pred_x,
  f.pred_y,
  f.pred_width,
  f.pred_height,
  f.valid_x,
  f.valid_y,
  f.valid_width,
  f.valid_height,
  (f.valid_x - f.pred_x) as dx,
  (f.valid_y - f.pred_y) as dy,
  (f.valid_width - f.pred_width) as dw,
  (f.valid_height - f.pred_height) as dh,
  (
    f.pred_x is not null
    and f.pred_y is not null
    and (abs(f.valid_x - f.pred_x) + abs(f.valid_y - f.pred_y)) > 2
  ) as moved
from public.mapping_correction_fields f;

grant select on public.correction_field_deltas to authenticated, service_role;
