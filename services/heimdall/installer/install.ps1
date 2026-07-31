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
    [string]$WatchRoot,

    [Parameter()]
    [switch]$ConfirmExistingFilesForReview,

    [Parameter()]
    [string[]]$ExpectedImageIdentifier,

    [Parameter()]
    [string]$InstallRoot = "$env:ProgramData\Halo Medical\Heimdall",

    [Parameter()]
    [string]$ServiceName = 'HaloHeimdall'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Beamer installation requires Administrator approval.'
    }
}

function Select-WatchRoot {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = [Windows.Forms.FolderBrowserDialog]::new()
    $dialog.Description = 'Choose the existing Fujifilm output folder Beamer should monitor. If you choose a drive itself, Beamer will create Beamer\Inbox on it.'
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) {
        throw 'A watch folder is required.'
    }
    return $dialog.SelectedPath
}

function Assert-SupportedWatchRoot([string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        throw 'A watch folder is required.'
    }
    if ($PathValue.StartsWith('\\')) {
        throw 'Network paths are not supported. Choose a local or removable drive.'
    }
    $selected = [IO.Path]::GetFullPath($PathValue)
    $root = [IO.Path]::GetPathRoot($selected)
    $drive = [IO.DriveInfo]::new($root)
    if (-not $drive.IsReady) {
        throw 'The selected drive is not currently available.'
    }
    if ($drive.DriveType -notin @([IO.DriveType]::Fixed, [IO.DriveType]::Removable)) {
        throw 'Choose a folder on a local or removable drive.'
    }
    if ($drive.DriveFormat -ne 'NTFS') {
        throw 'Beamer requires an NTFS local or removable drive so access can be restricted safely.'
    }
    $usingDriveRoot = $selected.TrimEnd('\').Equals($root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
    $watchPath = if ($usingDriveRoot) {
        [IO.Path]::GetFullPath((Join-Path $root 'Beamer\Inbox'))
    }
    else {
        $selected
    }
    if ($watchPath.TrimEnd('\').Equals($root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Beamer cannot watch an entire filesystem root.'
    }
    $sensitiveRoots = @(
        $InstallRoot,
        $env:windir,
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)},
        $env:ProgramData
    ) | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
    foreach ($sensitive in $sensitiveRoots) {
        if ($watchPath.TrimEnd('\').StartsWith($sensitive + '\', [StringComparison]::OrdinalIgnoreCase) -or
            $watchPath.TrimEnd('\').Equals($sensitive, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Choose a drive or folder outside Windows, Program Files, ProgramData, and the Beamer installation files.'
        }
    }
    $createdNewDefaultInbox = $false
    if ($usingDriveRoot) {
        $defaultInboxExisted = Test-Path -LiteralPath $watchPath -PathType Container
        New-Item -ItemType Directory -Path $watchPath -Force | Out-Null
        $createdNewDefaultInbox = -not $defaultInboxExisted
    }
    elseif (-not (Test-Path -LiteralPath $watchPath -PathType Container)) {
        throw 'Choose an existing Fujifilm output folder, or choose a drive itself to create Beamer\Inbox.'
    }
    $watchItem = Get-Item -LiteralPath $watchPath -Force
    if (($watchItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'The selected watch folder cannot be a link or reparse point.'
    }
    $logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $root.TrimEnd('\') + "'")
    if (-not $logicalDisk.VolumeSerialNumber) {
        throw 'Could not read the selected drive volume identity.'
    }
    return [pscustomobject]@{
        Path = $watchPath
        VolumeSerial = [string]$logicalDisk.VolumeSerialNumber
        CreatedNewDefaultInbox = $createdNewDefaultInbox
    }
}

function Confirm-ExistingOutputFiles([string]$PathValue, [bool]$AlreadyConfirmed) {
    $enumerator = [IO.Directory]::EnumerateFiles(
        $PathValue,
        '*',
        [IO.SearchOption]::TopDirectoryOnly
    ).GetEnumerator()
    try {
        $hasExistingFiles = $enumerator.MoveNext()
    }
    finally {
        $enumerator.Dispose()
    }
    if (-not $hasExistingFiles -or $AlreadyConfirmed) {
        return
    }
    Write-Warning 'This folder already contains files. Supported medical images already present will enter Beamer Review when the service starts.'
    $confirmation = Read-Host 'Type YES to continue, or anything else to cancel'
    if ($confirmation -cne 'YES') {
        throw 'Beamer installation was cancelled before existing files were processed.'
    }
}

function Set-RestrictedAcl(
    [string]$PathValue,
    [string]$ServiceIdentity,
    [ValidateSet('Read', 'Modify')][string]$Access = 'Read',
    [switch]$Directory
) {
    $grant = if ($Access -eq 'Modify') {
        if ($Directory) { '(OI)(CI)(M)' } else { '(M)' }
    }
    else {
        if ($Directory) { '(OI)(CI)(RX)' } else { '(R)' }
    }
    & icacls.exe $PathValue '/inheritance:r' '/grant:r' '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' "$ServiceIdentity`:$grant" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not restrict permissions on $PathValue"
    }
}

Assert-Administrator

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    throw 'Beamer is already installed on this computer. Use the repair or replacement flow.'
}

$packageRoot = Split-Path -Parent $PSScriptRoot
$agentSource = Join-Path $packageRoot 'Heimdall.exe'
$nssmSource = Join-Path $packageRoot 'tools\nssm.exe'
$tesseractSource = Join-Path $packageRoot 'tools\tesseract\tesseract.exe'
if (-not (Test-Path -LiteralPath $agentSource -PathType Leaf)) {
    throw 'This release package does not contain the Beamer agent executable.'
}
if (-not (Test-Path -LiteralPath $nssmSource -PathType Leaf)) {
    throw 'This release package does not contain the approved NSSM executable.'
}
if (-not (Test-Path -LiteralPath $tesseractSource -PathType Leaf)) {
    throw 'This release package does not contain the approved Tesseract runtime.'
}

if (-not $WatchRoot) {
    $WatchRoot = Select-WatchRoot
}
$watchSelection = Assert-SupportedWatchRoot $WatchRoot
$WatchRoot = $watchSelection.Path
$watchVolumeSerial = $watchSelection.VolumeSerial
if (-not $watchSelection.CreatedNewDefaultInbox) {
    Confirm-ExistingOutputFiles -PathValue $WatchRoot -AlreadyConfirmed $ConfirmExistingFilesForReview.IsPresent
}

if (-not $ExpectedImageIdentifier) {
    $identifierText = Read-Host 'Enter identifying text expected on medical images (example: Janet Johnson)'
    $ExpectedImageIdentifier = @($identifierText)
}
$ExpectedImageIdentifier = @($ExpectedImageIdentifier | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($ExpectedImageIdentifier.Count -eq 0) {
    throw 'At least one expected medical-image identifier is required.'
}

if (-not $EnrollmentCode) {
    $EnrollmentCode = Read-Host 'Enter the one-time Beamer setup code'
}
if ([string]::IsNullOrWhiteSpace($EnrollmentCode)) {
    throw 'A one-time Beamer setup code is required.'
}

$binDirectory = Join-Path $InstallRoot 'bin'
$secretsDirectory = Join-Path $InstallRoot 'secrets'
$stateDirectory = Join-Path $InstallRoot 'state'
$logsDirectory = Join-Path $InstallRoot 'logs'
foreach ($directory in @($binDirectory, $secretsDirectory, $stateDirectory, $logsDirectory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
& icacls.exe $secretsDirectory '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Could not secure the Beamer secrets directory before credential provisioning.'
}

$enrollmentStatePath = Join-Path $stateDirectory 'enrollment.json'
if (Test-Path -LiteralPath $enrollmentStatePath -PathType Leaf) {
    $savedEnrollment = Get-Content -LiteralPath $enrollmentStatePath -Raw | ConvertFrom-Json
    $installationId = [string]$savedEnrollment.installationId
    $parsedInstallationId = [guid]::Empty
    if ($savedEnrollment.contractVersion -ne 1 -or -not [guid]::TryParse($installationId, [ref]$parsedInstallationId)) {
        throw 'Existing Beamer enrollment resume state is invalid.'
    }
}
else {
    $installationId = [guid]::NewGuid().ToString()
    $enrollmentState = [ordered]@{ contractVersion = 1; installationId = $installationId }
    $enrollmentTemp = $enrollmentStatePath + '.tmp'
    [IO.File]::WriteAllText($enrollmentTemp, ($enrollmentState | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $enrollmentTemp -Destination $enrollmentStatePath
}

$enrollmentUri = $ApiBaseUrl.TrimEnd('/') + '/api/beamer/agent/enroll'
$enrollmentBody = @{
    contractVersion = 1
    enrollmentToken = $EnrollmentCode
    installationId = $installationId
    displayName = 'Beamer Windows workstation'
    agentVersion = '2.0.0'
} | ConvertTo-Json
$enrollment = Invoke-RestMethod -Method Post -Uri $enrollmentUri -ContentType 'application/json' -Body $enrollmentBody
$EnrollmentCode = $null

foreach ($property in @('deviceId', 'deviceToken', 'practiceId', 'config')) {
    if (-not $enrollment.$property) {
        throw "Beamer enrollment did not return $property. Resume with installation ID $installationId."
    }
}
if ($enrollment.contractVersion -ne 1 -or
    $enrollment.config.configSchemaVersion -ne 3 -or
    $enrollment.config.uploadMode -ne 'proxy') {
    throw 'Beamer enrollment returned an unsupported agent contract.'
}

$agentPath = Join-Path $binDirectory 'Heimdall.exe'
$nssmPath = Join-Path $binDirectory 'nssm.exe'
Copy-Item -LiteralPath $agentSource -Destination $agentPath -Force
Copy-Item -LiteralPath $nssmSource -Destination $nssmPath -Force
$tesseractDirectory = Join-Path $binDirectory 'tesseract'
Copy-Item -LiteralPath (Split-Path -Parent $tesseractSource) -Destination $tesseractDirectory -Recurse -Force
$tesseractPath = Join-Path $tesseractDirectory 'tesseract.exe'

$deviceCredentialPath = Join-Path $secretsDirectory 'device-credential.txt'
[IO.File]::WriteAllText($deviceCredentialPath, [string]$enrollment.deviceToken, [Text.UTF8Encoding]::new($false))

$configPath = Join-Path $InstallRoot 'config.json'
$config = [ordered]@{
    config_schema_version = 3
    contract_version = 1
    watch_directory = $WatchRoot
    watch_volume_serial = $watchVolumeSerial
    api_base_url = $ApiBaseUrl.TrimEnd('/')
    device_id = [string]$enrollment.deviceId
    installation_id = $installationId
    device_credential_path = $deviceCredentialPath
    heartbeat_interval_seconds = [int]$enrollment.config.heartbeatIntervalSeconds
    max_upload_bytes = [int]$enrollment.config.maxUploadBytes
    agent_endpoints = [ordered]@{
        heartbeat = [string]$enrollment.config.endpoints.heartbeat
        uploads = [string]$enrollment.config.endpoints.uploads
    }
    log_file = (Join-Path $logsDirectory 'heimdall.log')
    state_directory = $stateDirectory
    processed_subdirectory = '_halo_processed'
    review_subdirectory = '_halo_review'
    delete_after_upload = $false
    max_workers = 2
    queue_capacity = 256
    startup_backlog_enabled = $true
    retry_initial_delay_seconds = 15
    retry_max_delay_seconds = 900
    retry_dispatch_interval_seconds = 5
    special_workflows = [ordered]@{
        enabled = $false
        expected_image_identifiers = $ExpectedImageIdentifier
        ocr_tesseract_cmd = $tesseractPath
    }
}
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

& $nssmPath install $ServiceName $agentPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'NSSM could not register the Beamer service.' }
& $nssmPath set $ServiceName AppDirectory $InstallRoot | Out-Null
& $nssmPath set $ServiceName AppEnvironmentExtra "HALO_SENTRY_CONFIG=$configPath" | Out-Null
& $nssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $nssmPath set $ServiceName AppExit Default Restart | Out-Null

$serviceIdentity = "NT SERVICE\$ServiceName"
& sc.exe config $ServiceName obj= $serviceIdentity password= '' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the restricted Beamer service identity.' }

Set-RestrictedAcl -PathValue $secretsDirectory -ServiceIdentity $serviceIdentity -Access Read -Directory
Set-RestrictedAcl -PathValue $stateDirectory -ServiceIdentity $serviceIdentity -Access Modify -Directory
Set-RestrictedAcl -PathValue $logsDirectory -ServiceIdentity $serviceIdentity -Access Modify -Directory
Set-RestrictedAcl -PathValue $configPath -ServiceIdentity $serviceIdentity

& icacls.exe $WatchRoot '/grant' "$serviceIdentity`:(OI)(CI)(M)" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Could not grant Beamer access to the selected watch folder.'
}

Start-Service -Name $ServiceName
Write-Host 'Beamer is installed and will start automatically with Windows.'
