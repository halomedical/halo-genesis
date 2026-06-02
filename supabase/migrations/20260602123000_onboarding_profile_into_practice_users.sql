-- Move onboarding profile fields onto practice_users and drop legacy profile table.

alter table public.practice_users
  add column if not exists specialty_id uuid references public.specialties (id) on delete set null;

alter table public.practice_users
  add column if not exists subspecialty_id uuid references public.subspecialties (id) on delete set null;

alter table public.practice_users
  add column if not exists onboarding_completed_at timestamptz;

-- If legacy table exists, migrate values by email.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'user_onboarding_profiles'
  ) then
    update public.practice_users pu
    set
      role = coalesce(nullif(uop.role, ''), pu.role),
      specialty_id = coalesce(uop.specialty_id, pu.specialty_id),
      subspecialty_id = coalesce(uop.subspecialty_id, pu.subspecialty_id),
      onboarding_completed_at = coalesce(uop.completed_at, pu.onboarding_completed_at)
    from public.user_onboarding_profiles uop
    where pu.email = uop.email;
  end if;
end $$;

drop trigger if exists user_onboarding_profiles_set_updated_at on public.user_onboarding_profiles;
drop table if exists public.user_onboarding_profiles;

comment on column public.practice_users.specialty_id is 'Selected specialty for this user.';
comment on column public.practice_users.subspecialty_id is 'Selected subspecialty for this user.';
comment on column public.practice_users.onboarding_completed_at is 'Timestamp when onboarding was completed.';
