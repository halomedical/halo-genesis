# Beamer Windows installer

The production experience is a public, copy/paste bootstrap command. The
bootstrap downloads a versioned release over HTTPS, verifies the SHA-256 value
published by Genesis, and starts the signed installer with elevation.

```powershell
& ([scriptblock]::Create((irm 'https://app.halo.africa/api/beamer/windows-installer/bootstrap'))) -ApiBaseUrl 'https://app.halo.africa'
```

The application generates both URLs from its current origin. Staging therefore
enrols against staging, and HTTP is accepted only for explicit loopback origins
during synthetic local testing; the bootstrap must never silently fall back to
production.

The setup code is entered into the elevated installer prompt so it is not saved
in shell history. Setup then asks the user to choose a folder on a fixed or
removable drive and enter the identifying text expected on their medical
images. `Janet Johnson` is documentation placeholder text only; the installer
does not use it as a default.

The installer rejects UNC/network and sensitive system locations. Selecting an
existing Fujifilm output folder watches that folder directly, avoiding exporter
routing changes. Selecting a drive root instead creates and watches
`Beamer\Inbox`. Beamer does not modify Fujifilm or its configuration.

If an existing selected folder already contains files, setup explicitly warns
that supported images will enter Beamer Review during startup backlog handling
and requires the user to type `YES`. Synthetic unattended tests may pass
`-ConfirmExistingFilesForReview`; never use that switch with unreviewed clinical
data. The installer records the removable/fixed volume identity, creates
schema-v3 configuration, writes the device token without a UTF-8 BOM, restricts
ACLs, registers NSSM
with a per-service virtual account, enables automatic startup/restart, and starts
the service. It does not require Python or manual JSON/Drive routing when the
release contains the frozen `Heimdall.exe` and approved `tools/nssm.exe`.

## Release contents

```text
Heimdall.exe
tools/nssm.exe
tools/tesseract/tesseract.exe
installer/install.ps1
```

Release automation must pin and verify NSSM and Tesseract provenance/licenses, freeze
`python -m halo_sentry` into `Heimdall.exe`, code-sign executables/scripts, scan
the package, upload it, and publish its SHA-256 manifest. Those release-signing
steps require Halo's certificate and CI secret store and are not performed by
this source-only branch.

`packaging\build-agent.ps1` and `packaging\heimdall.spec` reproduce the unsigned
agent executable without bundling NSSM or Tesseract. Release automation must add
those separately only after provenance and licensing review.

Do not test enrollment against production or start the service against a real
Fujifilm folder without explicit approval.

Production bootstrap, manifest, package, and enrollment traffic must use HTTPS.
The scripts accept HTTP only for explicit loopback hosts (`localhost`,
`127.0.0.1`, or `[::1]`) so developers can run a synthetic local test server.
This exception must never be used with real patient data or production tokens.
