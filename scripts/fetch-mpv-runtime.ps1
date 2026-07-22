[CmdletBinding()]
param(
    [string]$ManifestPath,
    [string]$Destination,
    [string]$DownloadDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $PSScriptRoot '..\runtime\mpv\windows-x64.json'
}
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $PSScriptRoot '..\runtime\mpv\bin\windows-x64'
}
if ([string]::IsNullOrWhiteSpace($DownloadDirectory)) {
    $DownloadDirectory = Join-Path $PSScriptRoot '..\runtime\mpv\downloads'
}

function Get-NormalizedSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-FullCommit {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    if ($Value -notmatch '^[a-f0-9]{40}$') {
        throw "$Name must be a full lowercase Git commit."
    }
}

$manifestPath = [System.IO.Path]::GetFullPath($ManifestPath)
$destination = [System.IO.Path]::GetFullPath($Destination)
$downloadDirectory = [System.IO.Path]::GetFullPath($DownloadDirectory)
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ($manifest.schemaVersion -ne 1 -or $manifest.status -ne 'pinned') {
    throw 'The mpv runtime manifest is not a pinned schema-version-1 manifest.'
}
if ($manifest.target.platform -ne 'win32' -or $manifest.target.arch -ne 'x64') {
    throw 'The mpv runtime manifest does not target Windows x64.'
}
if ($manifest.artifact.url -notmatch '^https://' -or $manifest.artifact.url -match '(?i)(^|[\/_-])latest([\/_-]|$)') {
    throw 'The artifact URL must be HTTPS and must not use a latest alias.'
}
if ($manifest.artifact.fileName -notmatch '^[^\\/]+\.7z$') {
    throw 'The artifact filename must be a leaf .7z filename.'
}
if ($manifest.artifact.sha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'The artifact SHA-256 is invalid.'
}
Assert-FullCommit 'mpv commit' $manifest.source.mpvCommit
Assert-FullCommit 'FFmpeg commit' $manifest.source.ffmpegCommit
Assert-FullCommit 'build-project commit' $manifest.source.buildProjectCommit

$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $tar -PathType Leaf)) {
    throw 'Windows tar.exe is required to extract the verified .7z archive.'
}

New-Item -ItemType Directory -Force -Path $downloadDirectory | Out-Null
$archivePath = Join-Path $downloadDirectory $manifest.artifact.fileName
$partialPath = "$archivePath.partial"

if (Test-Path -LiteralPath $partialPath) {
    Remove-Item -LiteralPath $partialPath -Force
}

if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
    $existingSha256 = Get-NormalizedSha256 $archivePath
    if ($existingSha256 -ne $manifest.artifact.sha256) {
        Remove-Item -LiteralPath $archivePath -Force
    }
}

if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    Write-Host "Downloading pinned mpv artifact: $($manifest.artifact.fileName)"
    Invoke-WebRequest -Uri $manifest.artifact.url -OutFile $partialPath -UseBasicParsing
    Move-Item -LiteralPath $partialPath -Destination $archivePath
}

$archiveSha256 = Get-NormalizedSha256 $archivePath
if ($archiveSha256 -ne $manifest.artifact.sha256) {
    Remove-Item -LiteralPath $archivePath -Force
    throw 'Downloaded mpv archive failed SHA-256 verification and was removed.'
}

$archiveLength = (Get-Item -LiteralPath $archivePath).Length
if ($archiveLength -ne [long]$manifest.artifact.sizeBytes) {
    throw 'Downloaded mpv archive has the expected hash but an unexpected length.'
}

$destinationParent = Split-Path -Parent $destination
New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
$staging = Join-Path $destinationParent ('.extract-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    Write-Host 'SHA-256 verified; extracting runtime.'
    & $tar -xf $archivePath -C $staging
    if ($LASTEXITCODE -ne 0) {
        throw "tar.exe extraction failed with exit code $LASTEXITCODE."
    }

    $mpvExecutables = @(Get-ChildItem -LiteralPath $staging -Filter 'mpv.exe' -File -Recurse)
    if ($mpvExecutables.Count -ne 1) {
        throw "Expected exactly one mpv.exe in the verified archive; found $($mpvExecutables.Count)."
    }

    $runtimeRoot = $mpvExecutables[0].Directory.FullName
    $mpvExeSha256 = Get-NormalizedSha256 $mpvExecutables[0].FullName
    $verification = [ordered]@{
        schemaVersion = 1
        status = 'verified'
        artifactSha256 = $archiveSha256
        manifestSha256 = Get-NormalizedSha256 $manifestPath
        mpvExeSha256 = $mpvExeSha256
        verifiedAt = [DateTime]::UtcNow.ToString('o')
    }
    $verification | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'verification.json') -Encoding UTF8

    if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
    }
    Move-Item -LiteralPath $runtimeRoot -Destination $destination
} finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}

Write-Host "Verified mpv runtime ready: $destination" -ForegroundColor Green
Write-Host "Artifact SHA-256: $archiveSha256"
