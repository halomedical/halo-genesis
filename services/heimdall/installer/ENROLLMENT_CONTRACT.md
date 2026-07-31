# Beamer agent contract v1

The Windows agent never receives a Google Drive ID, service-account key, or
domain-wide-delegation credential. Genesis owns Workspace provisioning and
proxies practice-scoped image uploads.

`GET /api/beamer/windows-installer/manifest` returns contract version `1`,
product/version metadata, an HTTPS release URL and SHA-256, supported `x64`
architecture, minimum Windows version, and enrollment endpoint
`/api/beamer/agent/enroll`.

Before redemption, the installer atomically persists a random `installationId`.
It posts `{contractVersion:1,enrollmentToken,installationId,displayName,
agentVersion}`. Repeating the same token and installation ID safely resumes and
rotates/returns the device token. The schema-3 response contains only device and
practice IDs, the device token, upload limits, heartbeat interval, proxy mode,
and agent endpoint paths.

The device token is stored separately with a restricted ACL. Heartbeats post
only contract/schema/agent versions, pending upload/review counts, and sync time.

Each journal UUID is also the upload idempotency key. The agent sends raw raster
bytes to `POST /api/beamer/agent/files/:uploadId` with bearer authentication,
`Content-Length`, verified raster `Content-Type`, capture time, the fixed
`pending_review` status, and an optional non-identifying review reason. Safe v1
never sends patient IDs or OCR-derived identity. It also never sends original
filenames, OCR text, paths, Drive metadata, or Google credentials.

Server-side requirements include hashed short-lived enrollment tokens, one
active Windows device per practice, idempotent installation resume and upload,
strict raster magic/size validation, request-body log suppression, and routing
of every Windows image to the practice Review destination. Patient assignment
is an explicit authenticated Beamer action.
