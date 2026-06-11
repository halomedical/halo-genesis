-- Layout correction telemetry (no PHI): human edits vs baseline extraction for model improvement.

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
