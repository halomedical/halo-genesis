-- Human-in-the-loop PDF mapping corrections (no PHI in coordinates/metadata).
-- Prediction vs human-validated field boxes for POST /api/extract pipeline.
-- Future: org_id / tenant_id for medical forms may be added to extraction_runs and mapping_corrections.

create table public.extraction_runs (
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

create index extraction_runs_pdf_sha256_idx
  on public.extraction_runs (pdf_sha256);

create index extraction_runs_created_at_idx
  on public.extraction_runs (created_at desc);

create index extraction_runs_created_by_idx
  on public.extraction_runs (created_by);

create table public.mapping_corrections (
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

create index mapping_corrections_pdf_sha256_idx
  on public.mapping_corrections (pdf_sha256);

create index mapping_corrections_reviewer_id_idx
  on public.mapping_corrections (reviewer_id);

create index mapping_corrections_approved_at_idx
  on public.mapping_corrections (approved_at desc);

create table public.mapping_correction_fields (
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

create index mapping_correction_fields_correction_id_idx
  on public.mapping_correction_fields (correction_id);

create index mapping_correction_fields_pdf_sha256_idx
  on public.mapping_correction_fields (pdf_sha256);

create index mapping_correction_fields_field_id_idx
  on public.mapping_correction_fields (field_id);

create index mapping_correction_fields_pdf_sha256_field_id_idx
  on public.mapping_correction_fields (pdf_sha256, field_id);

-- RLS
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

/*
-- Example: one extraction run, one approval, two field rows (fictional UUIDs).

insert into public.extraction_runs (
  id,
  pdf_sha256,
  source_filename,
  pipeline_version,
  coordinate_system,
  semantic_model,
  matchmaker_model,
  prediction_json,
  physical_text_block_count,
  created_by
) values (
  '11111111-1111-4111-8111-111111111111',
  'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
  'sample-intake.pdf',
  '2025.06.1',
  'pdf_points_top_left_y_down',
  'gpt-4o-mini',
  'matchmaker-v2',
  '{
    "pipeline_version": "2025.06.1",
    "coordinate_system": "pdf_points_top_left_y_down",
    "semantic_schema": { "fields": [{ "id": "patient_name", "label": "Patient Name" }] },
    "mapped_fields": {
      "fields": [
        { "id": "patient_name", "page": 1, "x": 72, "y": 120, "width": 200, "height": 14 },
        { "id": "dob", "page": 1, "x": 72, "y": 150, "width": 100, "height": 14 }
      ]
    }
  }'::jsonb,
  42,
  null
);

insert into public.mapping_corrections (
  id,
  extraction_run_id,
  reviewer_id,
  pdf_sha256,
  pipeline_version,
  validated_json,
  edit_summary,
  notes
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  null,
  'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
  '2025.06.1',
  '{
    "fields": [
      { "id": "patient_name", "page": 1, "x": 72, "y": 120, "width": 200, "height": 14, "label": "Patient Name" },
      { "id": "dob", "page": 1, "x": 75, "y": 148, "width": 100, "height": 14, "label": "DOB" }
    ]
  }'::jsonb,
  '{"fields_moved": 1, "fields_added": 0, "fields_deleted": 0}'::jsonb,
  'Minor nudge on DOB box'
);

insert into public.mapping_correction_fields (
  correction_id,
  pdf_sha256,
  field_id,
  page,
  label,
  field_type,
  pred_x,
  pred_y,
  pred_width,
  pred_height,
  valid_x,
  valid_y,
  valid_width,
  valid_height,
  action
) values
(
  '22222222-2222-4222-8222-222222222222',
  'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
  'patient_name',
  1,
  'Patient Name',
  'text',
  72,
  120,
  200,
  14,
  72,
  120,
  200,
  14,
  'unchanged'
),
(
  '22222222-2222-4222-8222-222222222222',
  'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
  'dob',
  1,
  'DOB',
  'text',
  72,
  150,
  100,
  14,
  75,
  148,
  100,
  14,
  'move'
);
*/
