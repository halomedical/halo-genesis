-- Network catalog of shareable form layouts (metadata only; PDF bytes stay on each practice Drive).

create table if not exists public.shared_form_catalog (
  pdf_hash text primary key references public.form_templates (pdf_hash) on delete cascade,
  display_name text not null,
  document_type text not null,
  insurance_company_id text,
  shared_by text not null,
  is_public boolean not null default true,
  schema_version integer not null default 1,
  extraction_method text not null default 'unknown',
  import_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_form_catalog_document_type_idx
  on public.shared_form_catalog (document_type);

create index if not exists shared_form_catalog_insurance_idx
  on public.shared_form_catalog (insurance_company_id)
  where insurance_company_id is not null;

create index if not exists shared_form_catalog_public_idx
  on public.shared_form_catalog (is_public, document_type)
  where is_public = true;

comment on table public.shared_form_catalog is
  'Opt-out shared form registry keyed by pdf_hash. No PHI; shared_by is opaque practice key.';

alter table public.shared_form_catalog enable row level security;

drop policy if exists "service_role_all_shared_form_catalog" on public.shared_form_catalog;
create policy "service_role_all_shared_form_catalog"
  on public.shared_form_catalog
  for all
  to service_role
  using (true)
  with check (true);
