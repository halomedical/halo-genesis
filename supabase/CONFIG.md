# Practice entitlements (database)

Module access (Scribe, Billing, Admin Agent, Admissions, Beamer) is controlled in **Supabase**, not in the app Settings screen.

## Tables

| Table | Purpose |
|-------|---------|
| `practices` | One row per clinic / practice |
| `practice_users` | Links a Google sign-in email → `practice_id` |
| `practice_features` | One row per practice with boolean module columns |
| `specialties` / `subspecialties` | Onboarding taxonomy for specialty and subspecialty |
| `specialty_module_defaults` / `subspecialty_module_defaults` | Auto-enabled modules by specialty/subspecialty |
| `practice_users` | User-practice mapping + role/specialty/subspecialty onboarding fields |

`practice_users.role` is clinical/onboarding profile data and is user-editable.
Operational authority uses the separate server-managed `access_role` column
(`owner`, `admin`, or `member`). Never authorize Beamer administration from
the clinical `role` field.

## Module columns (`practice_features`)

| Column | App feature |
|----------|-------------|
| `admissions` | Admissions board |
| `admin_agent` | Admin Agent panel + `/api/admin-agent` |
| `scribe` | Scribe tab, note generation, sessions |
| `billing` | Billing tab + billing API routes |
| `beamer` | Beamer tab, mobile uploads, and one Heimdall Windows device |

Beamer's control-plane tables (`beamer_practice_config`, `beamer_enrollment_tokens`,
`beamer_devices`, `beamer_practice_patients`, and `beamer_assets`) are server-only.
Their migration enables RLS, explicitly revokes `anon`/`authenticated`, and grants
Data API access only to `service_role`.

## Turn a feature on or off

```sql
update public.practice_features pf
set billing = true
where practice_id = (
  select practice_id from public.practice_users where email = 'doctor@practice.co.za'
);
```

## Add a new user to an existing practice

```sql
insert into public.practice_users (practice_id, email)
select id, 'newuser@practice.co.za'
from public.practices
where slug = 'demo-ortho';
```

## New practice (minimal)

See `seed.example.sql`.

## Server env

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=   # service_role — server only, never in the frontend
```

Apply migrations via Supabase CLI `supabase db push` or the SQL editor.

**Fastest path (recommended):** run **`20260601140000_ensure_practice_entitlements_tables.sql`** once — it creates `practice_users`, `practice_features`, and fixes `practices` (including `slug`).

If your old `practice_features` table has `module`/`enabled` rows, run:

- `20260602112000_practice_features_single_row.sql` (migrates existing rows to one row per practice)
- `20260602120000_onboarding_orchestrator.sql` (adds onboarding orchestrator tables + starter specialties)

Full history (optional):

1. `20260529120000_practice_entitlements.sql`
2. `20260601130000_practices_add_slug.sql` — if `slug` column missing
3. `20260601140000_ensure_practice_entitlements_tables.sql` — if `practice_users` / `practice_features` missing
4. `20260602112000_practice_features_single_row.sql` — convert old row-per-module features to single-row booleans
5. `20260602120000_onboarding_orchestrator.sql` — onboarding profile + specialty/subspecialty defaults
6. `20260602121000_drop_user_module_preferences.sql` — remove duplicate per-user module table; use practice_features only
7. `20260602123000_onboarding_profile_into_practice_users.sql` — move onboarding profile fields into practice_users

If Supabase is not configured, the API falls back to default modules (Scribe only) for all users.

Shared Drive provisioning also requires the server-only `BEAMER_WORKSPACE_*`
variables documented in `.env.example`. No Workspace credentials belong in
Supabase rows, browser code, installer arguments, or logs.

The current Windows proxy-ingestion contract is intentionally raster-only:
JPEG, PNG, WebP, HEIC, and HEIF are accepted after MIME, size, and magic-byte
validation. PDF, DOCX, DICOM, and generic pass-through uploads are disabled
until they receive separate privacy, content-validation, and review designs.
