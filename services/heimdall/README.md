# Heimdall agent (user-facing name: Beamer)

Heimdall is the internal Windows ingestion agent behind the **Beamer** feature.
Product UI, onboarding, emails, and support copy must say **Beamer**. Internal
service names, logs, package names, and engineering documentation may say
Heimdall.

The agent watches one configured local or removable-drive folder, waits for
completed writes, and sends supported images through the Beamer proxy. The
shipped proxy configuration is strictly non-recursive. Expected identifier text
is checked on images placed directly in the configured watch folder; a missing
identifier is sent to Beamer as `pending_review` without requiring special
folder routing. That folder may be an existing Fujifilm output directory or the
`Beamer\Inbox` created when a user chooses a drive root during setup.

Agent contract v1 proxies verified JPEG, PNG, WebP, HEIC, and HEIF images only.
Legacy PDF, DOCX, pass-through, and recursive special folders are disabled in
the shipped configuration. Enabling them requires an explicit design, approval,
and a compatible backend contract.

## Safety and reliability

- The agent authenticates only with a revocable, practice-scoped Beamer device
  token. Google Workspace delegation and Drive credentials remain server-side.
- The Beamer enrollment service provisions practice storage without returning
  Drive IDs, service-account keys, or domain-wide-delegation material.
- A fixed-size worker pool and bounded queue limit CPU/RAM growth during bursts.
- A crash-safe opaque spool journal retries idempotent proxy uploads with bounded
  exponential backoff; it contains no original filename or source path.
- Startup backlog processing covers files created while the service was offline.
- Every Windows image uploads to Beamer as `pending_review` without a patient.
  Identifier checks may add a review reason, but never auto-route an image.
  Review items are never permanently deleted by the rejection workflow.
- Routine logs use correlation hashes, not original filenames, patient names,
  OCR text, local paths, Drive IDs, or credential values.

Filename replacement does **not** remove identifiers visible inside a medical
image, EXIF fields, or DICOM metadata. Beamer must not be described as content
anonymisation without a separately reviewed metadata/content pipeline.

## Developer checks

From this directory:

```powershell
python -m compileall halo_sentry installer
python -c "import halo_sentry.config, halo_sentry.pipeline, halo_sentry.watcher"
python -m unittest discover -v
```

To reproduce the unsigned Windows agent executable from source:

```powershell
.\packaging\build-agent.ps1
```

This uses the checked-in PyInstaller spec and writes `dist\Heimdall.exe` plus a
SHA-256 file. It deliberately does not download/bundle NSSM or Tesseract and
does not sign or publish a release.

Do not run `python -m halo_sentry` without an approved synthetic directory, safe
test Shared Drive, non-production credentials, and explicit approval.

Production API and installer origins must use HTTPS. For synthetic local device
testing only, configuration and installer scripts also accept explicit HTTP
loopback origins: `http://localhost`, `http://127.0.0.1`, or `http://[::1]`
(with an optional port). Arbitrary HTTP hosts, LAN addresses, URL credentials,
paths, queries, and fragments are rejected.

## Windows installation

Production release packages contain a frozen `Heimdall.exe`, an approved NSSM
binary, and `installer/install.ps1`. A public bootstrap downloads a versioned
package, verifies its SHA-256 digest, and launches the installer. The user only
needs a one-time Beamer setup code, a local/removable watch location, and the
identifier(s) expected on their medical images. See [installer/README.md](installer/README.md).

`python -m halo_sentry` remains the source/development entry point.
