# Beamer integration plan

> Historical filename: this began as the Fuji integration plan. The product is
> **Beamer** in every user-facing surface. **Heimdall** is the internal name of
> the Windows agent under `services/heimdall`.

## Product vision

Beamer is Halo's practice-scoped medical-image ingestion and review feature. It
brings Windows and mobile uploads into one controlled catalogue so that the
same approved assets can later be selected in Scopes without duplicate files.

```text
Windows local/removable folder -> Heimdall -> authenticated Beamer upload API
Mobile Beamer tab (patient first) --------> authenticated Beamer upload API
                                           -> practice Shared Drive
                                           -> Beamer asset catalogue
                                           -> Review and approval
                                           -> Scopes (approved assets only)
```

Heimdall remains a separately packaged Windows service. It does not run inside
the browser or the Genesis Node process.

## Locked product decisions

- Halo controls the Google Workspace organisation used for provisioning.
- Onboarding creates or reuses one isolated Shared Drive named exactly
  `Beamer - <Practice Name>` from the canonical practice name.
- A practice may have one active Windows device. Replacing it revokes the old
  device before the new installation is activated.
- The Windows installer accepts a folder only on a fixed local drive or a
  removable drive. UNC paths, mapped network drives, and other remote roots are
  rejected.
- The installer asks which identifier text Heimdall should expect on medical
  images. User-facing examples use `Janet Johnson` and explain that identifiers
  can be visible text or metadata on a medical image.
- Mobile users select and confirm the patient before taking or choosing images.
- Every Windows item goes to a temporary Review workflow without a patient.
  Identifier checks may add a review reason, but do not auto-route. Items are
  not permanently deleted by the automated rejection path.
- Beamer shows workstation health and recent upload information: online/offline,
  version, last seen, last sync, patient, time, item count, source, and status.
- Only approved, patient-assigned Beamer assets are available to Scopes.
- Beamer owns ingestion, storage references, and review state. Scopes references
  the same approved Drive asset and catalogue row rather than copying it.

## Security and ownership boundary

### Halo backend

The server is the only component allowed to hold Google Workspace credentials.
It provisions the practice Shared Drive and Review folder, validates practice
and patient ownership, uploads content to Drive, and records non-secret asset
metadata. Workspace credentials must never enter a browser response, installer
argument, workstation configuration, Supabase client session, or log.

The server stores only hashes of one-time enrollment tokens and device tokens.
Enrollment tokens are short-lived and single-use. Device tokens are
practice-scoped, revocable, and accepted only by dedicated agent endpoints.

### Windows device

The workstation stores its revocable Beamer device token with restricted ACLs.
It must not receive a Google service-account JSON key, private key, Drive folder
ID, delegated Workspace credential, or general Halo user session. It uploads
bytes and minimal safe metadata through the Beamer API.

Allowed operational metadata includes agent version, capture time, byte size,
MIME type, coarse health, queue/retry counts, source, and a constrained review
reason code. Do not send original filenames, OCR text, detected identifier text,
patient names, local paths, credential material, or clinical content as
telemetry.

### Browser and mobile

Browser requests use the signed-in Halo session plus practice entitlement.
Practice membership and patient ownership are revalidated on the server. Mobile
file data is sent only after the user has selected a patient. Google
credentials and raw Drive identifiers are never exposed to the client.

### Supabase

Beamer control-plane and asset tables are server-only. RLS stays enabled;
`anon` and `authenticated` receive no direct table access. The Node backend uses
the service role and applies practice scoping on every operation.

## Implemented API contract

The branch uses version 1 of the agent contract and schema 3 of the local
Heimdall configuration:

- `GET /api/beamer/windows-installer/manifest` publishes the versioned HTTPS
  package URL, uppercase SHA-256 digest, supported platform information, and
  enrollment endpoint. It returns `503` until all release metadata is set.
- `GET /api/beamer/windows-installer/bootstrap` serves the reviewed PowerShell
  bootstrap with `no-store` and `nosniff` headers.
- `POST /api/beamer/onboarding/start` is a signed-in, entitled practice-admin
  action. It provisions practice storage and creates the one-time setup token.
- `POST /api/beamer/agent/enroll` is the resumable, rate-limited device exchange.
  It returns only a revocable `deviceToken` and schema-3 proxy settings,
  including relative heartbeat and upload endpoints. It returns no Google key,
  Drive folder ID, or other Workspace routing secret.
- `POST /api/beamer/agent/heartbeat` accepts the device bearer token and coarse
  version, sync, queue, and Review counts.
- `POST /api/beamer/agent/files/:uploadId` accepts a bounded raw image body with
  an idempotent opaque upload ID. Safe `X-Beamer-*` headers carry capture time,
  review state/reason. Safe v1 rejects all Windows-supplied patient IDs; patient
  assignment happens only in Beamer Review.
- `POST /api/beamer/mobile/uploads` uses the authenticated browser session and
  requires a patient before upload.
- `PATCH /api/beamer/review/:uploadId` is a practice-admin approval/rejection
  action. Approval requires a verified patient.
- `GET /api/beamer/patients/:patientId/assets` and
  `GET /api/beamer/assets/:assetId/content` expose approved, practice-scoped
  assets to authorised consumers such as Scopes.

The raw agent upload accepts raster images only. Original filenames and OCR
text are not part of the HTTP contract.

## Windows onboarding and steady-state flow

1. Halo enables Beamer for the practice through its practice entitlement.
2. An authorised practice user starts onboarding in the Beamer tab.
3. The backend creates or reuses `Beamer - <Practice Name>` and its temporary
   Review folder, then issues a short-lived one-time setup token.
4. The user downloads a signed immutable Windows package or runs the published
   bootstrap command. The package digest and publisher signature are verified.
5. The installer requests administrator approval, the setup token, one local or
   removable watch folder, and the expected medical-image identifier variants.
6. The installer enrolls the workstation and receives only a revocable device
   token plus non-secret runtime configuration.
7. It installs the frozen Heimdall executable, OCR runtime, and service wrapper
   under the Halo program-data directory with restricted ACLs.
8. Heimdall starts with Windows, watches quietly, reports coarse health, and
   sends files through the Beamer API. A bounded worker pool and queue limit
   burst resource use; OCR can still cause temporary CPU and memory spikes.
9. Startup backlog and the crash-safe retry journal handle files created while
   the service is offline and transient upload failures.

The source/development entry point remains `python -m halo_sentry`. Never run it
against real folders or credentials during routine development.

## Review flow

Heimdall replaces a local source filename with the existing de-identified
format before upload:

```text
halo_<timestamp>_<uuid>.<extension>
```

Filename replacement alone does not remove identifying text visible inside an
image, EXIF fields, or DICOM metadata. Beamer must not be marketed as complete
content anonymisation.

For safe v1, the API stores every Windows item in the practice Review folder
and creates a `pending_review` asset without a patient. Identifier checks may
explain why attention is needed but never select or transmit a patient.
An authorised Beamer user previews it, selects the correct patient, and either:

- approves it, making it available to the patient's Beamer catalogue and
  Scopes; or
- rejects it, removing it from the active workflow without automatic permanent
  deletion.

Review-pending and rejected assets must never be returned by the Scopes asset
contract.

## Mobile flow

1. The user opens the Beamer sidebar tab.
2. The user searches for and confirms a patient.
3. The user takes images or chooses them from the gallery or local files.
4. The browser applies count/type/size checks; the server repeats all checks,
   verifies patient-practice ownership, and uploads into the practice Drive.
5. Successfully stored items are catalogued as approved mobile assets and shown
   in recent uploads.

The phone does not run Python or Heimdall and never receives Google or device
credentials.

## Scopes integration contract

Scopes requests approved assets by practice and patient. The backend returns
only safe catalogue metadata and serves content through a practice-scoped,
authenticated endpoint. Scopes can preview, select, reorder, and assign these
assets during its workflow while retaining the original Beamer asset ID and
Drive reference server-side.

At minimum, each catalogue row records:

- practice and patient IDs;
- source (`windows` or `mobile`) and optional Windows device ID;
- server-side Drive file reference;
- MIME type and byte size;
- capture/upload timestamps;
- processing and review status;
- constrained review reason; and
- reviewer and review timestamp where applicable.

Original filenames, OCR text, and patient names are not catalogue fields.

## Repository layout

```text
halo-genesis/
|-- services/heimdall/          # internal Windows agent and installer source
|-- server/routes/beamer.ts     # browser and agent HTTP boundary
|-- server/services/beamer*.ts  # orchestration, storage, Workspace/Drive
|-- src/shell/src/features/beamer/
|-- supabase/migrations/        # server-only Beamer schema
|-- registry/extensions.json    # heimdall-agent-v1, displayed as Beamer
`-- shared/                     # feature and API contracts
```

The imported service retains a `SOURCE_REVISION` provenance record. Local
configurations, tokens, keys, logs, runtime state, patient data, DICOM files,
OCR output, and release binaries remain ignored by Git.

## Safe validation

Run the root checks:

```powershell
npm run build
npm run test:calendar
npm run test:beamer
npm run check:heimdall
```

CI runs Node 20 and a separate Windows/Python 3.11 Heimdall job. The Heimdall
job installs the pinned-range requirements, compiles and imports the agent,
runs synthetic unit tests, and parses all installer PowerShell files.

Before reporting a branch ready for review, also run:

```powershell
git diff --check
git status --short --branch
git diff --stat
```

Do not start the live Heimdall service, apply a production migration, provision
a real Shared Drive, process clinical data, create a release, commit, or push
without the approval required for that action.

## Production-readiness gates

This feature branch is an implementation and review branch, not a production
release. Production rollout remains blocked until all of the following are
completed and evidenced:

- The final Heimdall transport uses the device-token Beamer upload proxy; no
  Google key or Drive routing ID is installed on the workstation.
- The Windows artifact is reproducible, immutable, SHA-256 published, code
  signed, malware-scanned, and served only over HTTPS.
- Installer download, repair, uninstall, update, rollback, device replacement,
  removable-drive absence, and service recovery are tested on supported Windows
  versions.
- Enrollment and upload endpoints have rate limits, replay protection, bounded
  request sizes, safe logging, device revocation, and audit events.
- The Supabase migration has been reviewed and applied to a non-production
  project; RLS and grants have been verified directly.
- Workspace domain-wide delegation uses a dedicated least-privilege identity;
  Shared Drive ownership, naming collisions, membership, and quota failures are
  tested in a Halo test Workspace.
- Mobile uploads use streaming or another bounded transport appropriate for
  production payloads and are tested on supported mobile browsers.
- Review retention, rejection, recovery, and final deletion policy are approved
  and implemented. Rejection alone is not deletion.
- Synthetic end-to-end tests cover onboarding, one-device enforcement,
  replacement/revocation, offline recovery, duplicate events, retry exhaustion,
  Review approval, mobile upload, and Scopes access isolation.
- Privacy and security review confirms that no filename, OCR content, local
  path, Google credential, or cross-practice asset leaks through APIs or logs.
- Resource measurements are recorded during idle operation, OCR, large files,
  and burst ingestion. "Lightweight" may be claimed only from those results.

## Branch and release flow

Development lives on `feature/fuji-integration`, branched from `staging`. The
historical branch name does not change the product name. Before any first push,
confirm the repository root, branch, upstream, remote URL, status, and complete
diff. Open the PR into `staging`, require both CI jobs and review, then validate
on a non-production Halo/Workspace environment before considering promotion to
`main`.
