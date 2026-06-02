# Practice entitlements (database)

Module access (Scribe, Billing, Admin Agent, Admissions) is controlled in **Supabase**, not in the app Settings screen.

## Tables

| Table | Purpose |
|-------|---------|
| `practices` | One row per clinic / practice |
| `practice_users` | Links a Google sign-in email → `practice_id` |
| `practice_features` | One row per practice with boolean module columns |

## Module columns (`practice_features`)

| Column | App feature |
|----------|-------------|
| `admissions` | Admissions board |
| `admin_agent` | Admin Agent panel + `/api/admin-agent` |
| `scribe` | Scribe tab, note generation, sessions |
| `billing` | Billing tab + billing API routes |

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
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # service_role — server only, never in the frontend
```

Apply migrations via Supabase CLI `supabase db push` or the SQL editor.

**Fastest path (recommended):** run **`20260601140000_ensure_practice_entitlements_tables.sql`** once — it creates `practice_users`, `practice_features`, and fixes `practices` (including `slug`).

If your old `practice_features` table has `module`/`enabled` rows, run:

- `20260602112000_practice_features_single_row.sql` (migrates existing rows to one row per practice)

Full history (optional):

1. `20260529120000_practice_entitlements.sql`
2. `20260601130000_practices_add_slug.sql` — if `slug` column missing
3. `20260601140000_ensure_practice_entitlements_tables.sql` — if `practice_users` / `practice_features` missing
4. `20260602112000_practice_features_single_row.sql` — convert old row-per-module features to single-row booleans

If Supabase is not configured, the API falls back to default modules (Scribe only) for all users.
