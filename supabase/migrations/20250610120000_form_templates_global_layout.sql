-- Layer B: Global PDF layout memory (no PHI).
-- Stores perfected field coordinates keyed by content hash of the blank PDF.
-- Practice-specific template manifests and PDF bytes remain on Google Drive (Layer A).

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

-- Optional: track which hash versions were promoted (audit without PHI)
create table if not exists public.form_template_promotions (
  id uuid primary key default gen_random_uuid(),
  pdf_hash text not null references public.form_templates (pdf_hash) on delete cascade,
  promoted_by text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.form_templates enable row level security;
alter table public.form_template_promotions enable row level security;

-- Service role (halo-genesis backend) reads/writes; anon/authenticated clients have no direct access.
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
