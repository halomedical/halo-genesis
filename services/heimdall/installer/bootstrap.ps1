[CmdletBinding()]
param(
    [Parameter()]
    [ValidateScript({
        try { $uri = [Uri]$_ } catch { throw 'ApiBaseUrl must be an absolute HTTPS origin or an HTTP loopback origin.' }
        $originOnly = $uri.IsAbsoluteUri -and -not $uri.UserInfo -and
            $uri.AbsolutePath -eq '/' -and -not $uri.Query -and -not $uri.Fragment
        $allowed = $uri.Scheme -eq 'https' -or
            ($uri.Scheme -eq 'http' -and $uri.Host -in @('localhost', '127.0.0.1', '::1'))
        if (-not ($originOnly -and $allowed)) {
            throw 'ApiBaseUrl must be an absolute HTTPS origin or an HTTP loopback origin for synthetic local testing.'
        }
        return $true
    })]
    [string]$ApiBaseUrl = 'https://app.halo.africa',

    [Parameter()]
    [string]$EnrollmentCode,

    [Parameter()]
    [switch]$ConfirmExistingFilesForReview
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$bootstrapTemp = Join-Path ([IO.Path]::GetTempPath()) ("beamer-" + [guid]::NewGuid())
$archivePath = Join-Path $bootstrapTemp 'beamer-windows.zip'
$extractPath = Join-Path $bootstrapTemp 'package'

try {
    New-Item -ItemType Directory -Path $bootstrapTemp | Out-Null
    $manifestUrl = $ApiBaseUrl.TrimEnd('/') + '/api/beamer/windows-installer/manifest'
    $manifest = Invoke-RestMethod -Method Get -Uri $manifestUrl
    if ($manifest.contractVersion -ne 1 -or
        $manifest.productName -ne 'Beamer for Windows' -or
        $manifest.enrollmentEndpoint -ne '/api/beamer/agent/enroll' -or
        -not $manifest.downloadUrl -or -not $manifest.sha256 -or
        'x64' -notin $manifest.supportedArchitectures) {
        throw 'The Beamer installer manifest is incomplete.'
    }
    $downloadUri = [Uri]$manifest.downloadUrl
    $allowedDownload = $downloadUri.IsAbsoluteUri -and -not $downloadUri.UserInfo -and
        ($downloadUri.Scheme -eq 'https' -or
            ($downloadUri.Scheme -eq 'http' -and $downloadUri.Host -in @('localhost', '127.0.0.1', '::1')))
    if (-not $allowedDownload) {
        throw 'The Beamer installer download must use HTTPS, except for an explicit loopback synthetic test server.'
    }

    Invoke-WebRequest -Uri $manifest.downloadUrl -OutFile $archivePath -UseBasicParsing
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actualHash -ne ([string]$manifest.sha256).ToUpperInvariant()) {
        throw 'The Beamer installer package failed SHA-256 verification.'
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
    $installer = Join-Path $extractPath 'installer\install.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw 'The verified package does not contain installer\install.ps1.'
    }

    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installer, '-ApiBaseUrl', $ApiBaseUrl)
    if ($EnrollmentCode) {
        $arguments += @('-EnrollmentCode', $EnrollmentCode)
    }
    if ($ConfirmExistingFilesForReview) {
        $arguments += '-ConfirmExistingFilesForReview'
    }
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Beamer installation failed with exit code $($process.ExitCode)."
    }
}
finally {
    if (Test-Path -LiteralPath $bootstrapTemp) {
        Remove-Item -LiteralPath $bootstrapTemp -Recurse -Force
    }
}
