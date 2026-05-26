# HALO Development Pipeline (Monolith)

This document defines the working flow for the single-repo `halo-genesis` structure.

## Objectives

- Keep developer workflow simple in one repo.
- Allow many developers to work concurrently with minimal conflict.
- Keep behavior stable across staging and production.

## Repository Model

- Single repo: `halo-genesis`.
- Main app shell: `src/shell/src`.
- Extension modules: `src/shell/src/modules`.
- API/backend: `server`.
- Shared contracts/flags: `shared`.

## Branching Model

- Protected branches:
  - `main` (production)
  - `staging` (integration/testing)
- Working branches:
  - `feature/<area>-<short-description>`
  - `fix/<area>-<short-description>`
  - `hotfix/<area>-<short-description>` (urgent production fixes)

## Parallel Development Flow

1. Branch from `staging`.
2. Keep branch scope small (single feature/fix).
3. Open PR to `staging` early (draft PR allowed).
4. Re-sync branch with `staging` daily.
5. Merge when CI is green and review is complete.
6. Test in staging app.
7. Promote `staging` to `main` for production release.

## Merge and Quality Gates

Require for `staging` and `main`:

- PR required (no direct push).
- Build check required.
- At least one review.

Recommended CI checks:

- `npm run build`
- `npm run test:calendar`

## Conflict Reduction Rules

- Keep branches short-lived (1-3 days).
- Keep PRs focused and small.
- Coordinate before changing cross-cutting files (`shared`, auth, core API contracts).
- Use feature flags for incomplete UI/API work so safe increments can merge.

## Deployment Flow

- `staging` deploys to staging app.
- `main` deploys to production app.
- Validate critical paths on staging before promotion:
  - auth/login
  - patient workspace
  - admin-agent/scribe/billing feature visibility
  - per-user settings isolation
