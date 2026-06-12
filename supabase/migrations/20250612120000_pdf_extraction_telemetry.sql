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

-- Median duration for recent successful non-cache runs in a file-size band.
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
