# Halo Genesis Monolith

`halo-genesis` is now the single development repository for HALO.

## Structure
- `src/shell/src` - main React shell UI.
- `src/shell/src/modules` - extension modules (admin-agent, scribe, billing).
- `server` - Express API routes and services.
- `shared` - shared contracts and feature flag resolution.
- `registry` - extension catalog metadata.

## Run
- `npm run dev` - run API + shell in development.
- `npm run build` - build shell and server.
- `npm run test:calendar` - calendar smoke test.

## Branch Flow
- `main` - production.
- `staging` - integration/testing.
- `feature/*`, `fix/*` - all development branches.

Use `DEVELOPMENT_PIPELINE.md` for the team workflow.
