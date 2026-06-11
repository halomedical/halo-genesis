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
