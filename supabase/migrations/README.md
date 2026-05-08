# Layer B Configuration Schema

`/supabase/migrations` defines the Layer B configuration schema and tenant boundaries.

- Stores migration history for practice-scoped configuration data.
- Encodes `practice_id`-based Row Level Security (RLS) policies.
- Maintains deterministic, auditable evolution of configuration schema.

## Governance Guardrail
Agents write config. Humans write code. No agent has write access to Layer A or C. All data must be scoped by practice_id.
