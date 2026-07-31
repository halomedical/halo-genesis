# Halo Genesis Monolith

`halo-genesis` is the single development repository for HALO.

## Structure

- `src/shell/src` - main React shell UI and user-facing features.
- `src/shell/src/modules` - extension modules such as Admin Agent, Scribe, and Billing.
- `server` - Express API routes and services.
- `shared` - shared contracts and feature flag resolution.
- `registry` - extension catalog metadata.
- `services/heimdall` - internal Windows ingestion agent behind the user-facing **Beamer** feature.
- `supabase` - practice entitlements and server-only application data migrations.

The name **Heimdall** is internal. Users see **Beamer** everywhere in the app,
onboarding, installer copy, and support material.

## Run and validate

- `npm run dev` - run the API and shell in development.
- `npm run build` - build the shell and server.
- `npm run test:calendar` - run the calendar smoke test.
- `npm run test:beamer` - run Beamer payload-validation security checks.
- `npm run check:heimdall` - compile, safely import, and unit-test the Windows agent with synthetic data.

`check:heimdall` does not start the watcher, connect to Google Drive, use a real
Fujifilm output folder, or process clinical data.

## Beamer at a glance

Beamer provides two practice-scoped ingestion paths:

- A single Windows workstation runs Heimdall quietly as a startup service and
  watches one user-selected folder on a local or removable drive.
- A signed-in mobile user selects a patient first, then captures or chooses
  medical images in the Beamer tab.

Both paths use the Halo backend to authenticate and route uploads to the
practice's Halo-managed Shared Drive, named `Beamer - <Practice Name>`. Google
credentials remain server-side. Every Windows image waits in a temporary
Review workflow for explicit patient assignment; only approved assets are available to
Scopes. See [FUJI_INTEGRATION_PLAN.md](FUJI_INTEGRATION_PLAN.md) for the
architecture, implementation status, safety boundaries, and rollout gates.

## Branch flow

- `main` - production.
- `staging` - integration/testing.
- `feature/*`, `fix/*` - development branches.

Use [DEVELOPMENT_PIPELINE.md](DEVELOPMENT_PIPELINE.md) for the team workflow.
