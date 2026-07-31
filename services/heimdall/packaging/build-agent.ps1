[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$serviceRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $serviceRoot '.build'
$venvRoot = Join-Path $buildRoot 'venv'
$python = Join-Path $venvRoot 'Scripts\python.exe'
$output = Join-Path $serviceRoot 'dist\Heimdall.exe'

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    python -m venv $venvRoot
}

& $python -m pip install --disable-pip-version-check --require-virtualenv `
    -r (Join-Path $serviceRoot 'requirements.txt') `
    -r (Join-Path $serviceRoot 'requirements-build.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install Heimdall build dependencies.' }

Push-Location $serviceRoot
try {
    & $python -m PyInstaller --noconfirm --clean `
        --distpath (Join-Path $serviceRoot 'dist') `
        --workpath (Join-Path $serviceRoot 'build') `
        (Join-Path $serviceRoot 'packaging\heimdall.spec')
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed to build Heimdall.exe.' }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $output -PathType Leaf)) {
    throw 'PyInstaller completed without producing dist\Heimdall.exe.'
}

$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToUpperInvariant()
[IO.File]::WriteAllText(
    (Join-Path $serviceRoot 'dist\Heimdall.sha256'),
    "$hash  Heimdall.exe`n",
    [Text.UTF8Encoding]::new($false)
)
Write-Host "Built unsigned Heimdall.exe (SHA-256: $hash)."
Write-Warning 'Code signing, malware scanning, NSSM/Tesseract provenance, and release packaging remain CI/release steps.'
