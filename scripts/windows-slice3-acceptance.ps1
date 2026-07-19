[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [int]$PlaybackTimeoutSeconds = 90,
    [int]$ShutdownTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Wait-Until {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Condition) {
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw $FailureMessage
}

function Confirm-ObservedStep {
    param([Parameter(Mandatory = $true)][string]$Prompt)

    $response = Read-Host "$Prompt Type YES only after observing all repetitions, or SKIP to retain it as an open criterion"
    if ($response -eq 'YES') {
        return $true
    }
    if ($response -eq 'SKIP') {
        return $false
    }
    throw "Native observation was not confirmed: $Prompt"
}

function Test-NamedPipeReachable {
    param([Parameter(Mandatory = $true)][string]$PipePath)

    $prefix = '\\.\pipe\'
    if (-not $PipePath.StartsWith($prefix)) {
        throw 'Captured mpv pipe path has an unexpected form.'
    }
    $client = New-Object System.IO.Pipes.NamedPipeClientStream('.', $PipePath.Substring($prefix.Length), [System.IO.Pipes.PipeDirection]::InOut)
    try {
        $client.Connect(250)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-RecordedEvents {
    param([Parameter(Mandatory = $true)][string]$LogPath)

    if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
        return @()
    }
    return @(
        Get-Content -LiteralPath $LogPath |
            Where-Object { $_.Length -gt 0 } |
            ForEach-Object { $_ | ConvertFrom-Json }
    )
}

function Get-BundledMpvProcess {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [int[]]$ExcludedProcessIds = @()
    )

    return Get-CimInstance Win32_Process -Filter "Name = 'mpv.exe'" |
        Where-Object {
            $_.ExecutablePath -and
            ([System.IO.Path]::GetFullPath($_.ExecutablePath) -eq [System.IO.Path]::GetFullPath($ExecutablePath)) -and
            $_.ProcessId -notin $ExcludedProcessIds
        } |
        Select-Object -First 1
}

function Get-MpvProcessBoundary {
    param([Parameter(Mandatory = $true)]$MpvProcess)

    $commandLine = [string]$MpvProcess.CommandLine
    $pipeMatch = [regex]::Match($commandLine, '--input-ipc-server=(\\\\\.\\pipe\\[^\s"]+)')
    $widMatch = [regex]::Match($commandLine, '--wid=([1-9][0-9]*)')
    if (-not $pipeMatch.Success -or -not $widMatch.Success) {
        throw 'The mpv command line did not contain the required private pipe and --wid embedding arguments.'
    }
    return [ordered]@{
        commandLine = $commandLine
        pipePath = $pipeMatch.Groups[1].Value
        wid = [UInt64]::Parse($widMatch.Groups[1].Value)
    }
}

function Test-WidBelongsToElectronWindow {
    param([Parameter(Mandatory = $true)][UInt64]$Wid)

    if (-not ('Coax.NativeWindowInspector' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Coax {
    public static class NativeWindowInspector {
        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    }
}
'@
    }
    $windowHandle = [IntPtr]::new([Int64]$Wid)
    if (-not [Coax.NativeWindowInspector]::IsWindow($windowHandle)) {
        return $false
    }
    [uint32]$ownerProcessId = 0
    [void][Coax.NativeWindowInspector]::GetWindowThreadProcessId($windowHandle, [ref]$ownerProcessId)
    $owner = Get-Process -Id $ownerProcessId -ErrorAction SilentlyContinue
    return $null -ne $owner -and $owner.ProcessName -eq 'electron'
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$inputPath = Join-Path $repositoryRoot 'config\local\playback.json'
$examplePath = Join-Path $repositoryRoot 'config\local\playback.example.json'
$runtimeDirectory = Join-Path $repositoryRoot 'runtime\mpv\bin\windows-x64'
$mpvPath = Join-Path $runtimeDirectory 'mpv.exe'
$runtimeVerificationPath = Join-Path $runtimeDirectory 'verification.json'

if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
    Write-Host 'Slice 3 needs the existing private, ignored playback input.' -ForegroundColor Yellow
    Write-Host "Copy $examplePath to the ignored local input path and replace streamUrl locally."
    Write-Host 'Do not paste the URL into chat, commit it, or place it in command arguments.'
    exit 2
}

$input = Get-Content -LiteralPath $inputPath -Raw | ConvertFrom-Json
if ($null -eq $input.streamUrl -or $input.streamUrl -notmatch '^https?://') {
    throw 'The private playback input must contain one HTTP(S) streamUrl.'
}
$streamUri = [Uri]$input.streamUrl
$sensitiveValues = @($input.streamUrl)
if ($streamUri.UserInfo) {
    $sensitiveValues += @($streamUri.UserInfo.Split(':') | Where-Object { $_.Length -gt 0 })
}
if ($streamUri.Query) {
    foreach ($pair in $streamUri.Query.TrimStart('?').Split('&')) {
        $parts = $pair.Split('=', 2)
        if ($parts.Count -eq 2 -and $parts[1].Length -gt 0) {
            $sensitiveValues += [Uri]::UnescapeDataString($parts[1])
        }
    }
}

Push-Location $repositoryRoot
$devProcess = $null
try {
    if (-not (Test-Path -LiteralPath $mpvPath -PathType Leaf) -or -not (Test-Path -LiteralPath $runtimeVerificationPath -PathType Leaf)) {
        throw 'The previously fetched and verified pinned runtime is missing. Run fetch-mpv-runtime.ps1 separately before Slice 3 acceptance.'
    }
    Write-Host 'Using the existing pinned runtime; Electron will recompute and verify its hashes before each spawn.'

    if (-not $SkipInstall) {
        & corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            throw "Frozen dependency install failed with exit code $LASTEXITCODE."
        }
    }

    $runId = 'slice3-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $runDirectory = Join-Path $repositoryRoot "artifacts\m0\$runId"
    New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'runtime\mpv\windows-x64.json') -Destination (Join-Path $runDirectory 'runtime-manifest.json')

    $previousRunId = $env:COAX_M0_RUN_ID
    $previousAcceptanceMode = $env:COAX_SLICE3_ACCEPTANCE
    $env:COAX_M0_RUN_ID = $runId
    $env:COAX_SLICE3_ACCEPTANCE = '1'
    $standardOutput = Join-Path $runDirectory 'electron-vite.stdout.txt'
    $standardError = Join-Path $runDirectory 'electron-vite.stderr.txt'
    try {
        $corepack = (Get-Command corepack).Source
        $devProcess = Start-Process -FilePath $corepack -ArgumentList @('pnpm', 'dev') -PassThru -RedirectStandardOutput $standardOutput -RedirectStandardError $standardError
    } finally {
        $env:COAX_M0_RUN_ID = $previousRunId
        $env:COAX_SLICE3_ACCEPTANCE = $previousAcceptanceMode
    }

    $logPath = Join-Path $runDirectory 'playback-events.jsonl'
    $requiredPlaybackEvents = @('start-file', 'file-loaded', 'playback-restart', 'video-reconfig', 'audio-reconfig')
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Timed out waiting for all required playback events.' -Condition {
        $recorded = Get-RecordedEvents $logPath
        $seen = @($recorded | Where-Object { $_.event -eq 'mpv-event' } | ForEach-Object { $_.mpvEvent })
        @($requiredPlaybackEvents | Where-Object { $_ -notin $seen }).Count -eq 0
    }

    $initialMpv = Get-BundledMpvProcess -ExecutablePath $mpvPath
    if ($null -eq $initialMpv) {
        throw 'The running mpv process is not the verified bundled executable.'
    }
    $initialBoundary = Get-MpvProcessBoundary -MpvProcess $initialMpv
    $widMatchesElectronWindow = Test-WidBelongsToElectronWindow -Wid $initialBoundary.wid
    if (-not $widMatchesElectronWindow) {
        throw '--wid did not match a live Electron top-level window handle.'
    }

    $argumentsContainSensitiveValue = $false
    foreach ($sensitiveValue in $sensitiveValues) {
        if ($sensitiveValue.Length -ge 4 -and $initialBoundary.commandLine.Contains($sensitiveValue)) {
            $argumentsContainSensitiveValue = $true
        }
    }

    Add-Type -AssemblyName System.Windows.Forms
    $monitorCount = [System.Windows.Forms.Screen]::AllScreens.Count
    Write-Host "Native interaction matrix begins with $monitorCount available monitor(s)." -ForegroundColor Cyan
    $interaction = [ordered]@{}
    $interaction.moveResize = Confirm-ObservedStep 'Move the Coax window and resize it repeatedly; confirm video stays parented and clipped throughout.'
    $interaction.fullscreenCycles = Confirm-ObservedStep 'Complete ten consecutive fullscreen enter/exit cycles (Toggle fullscreen or F11); confirm no orphaning, inaccessibility, or incorrect stacking.'
    $interaction.monitorDpiRoundTrips = Confirm-ObservedStep 'Complete five round trips across every available monitor/DPI mode; confirm no persistent geometry corruption.'
    $interaction.altTabCycles = Confirm-ObservedStep 'Complete ten Alt+Tab away/back cycles; confirm the player remains controllable without a manual reset.'
    $interaction.minimiseRestoreCycles = Confirm-ObservedStep 'Complete ten minimise/restore cycles; confirm the player remains controllable without a manual reset.'
    $interaction.displaySleepResume = Confirm-ObservedStep 'Complete one display sleep/resume cycle; confirm the player is controllable without restarting Coax.'

    $eventsBeforeRapidTest = Get-RecordedEvents $logPath
    $requestsBeforeRapidTest = @($eventsBeforeRapidTest | Where-Object { $_.event -eq 'mpv-playlist-step-requested' }).Count
    Read-Host 'Run the fixed 30-change test using the Coax button or F9, then press Enter'
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Thirty new rapid playlist requests were not recorded.' -Condition {
        $events = Get-RecordedEvents $logPath
        @($events | Where-Object { $_.event -eq 'mpv-playlist-step-requested' }).Count -ge ($requestsBeforeRapidTest + 30)
    }
    $eventsAfterRapidRequests = Get-RecordedEvents $logPath
    $rapidRequests = @($eventsAfterRapidRequests | Where-Object { $_.event -eq 'mpv-playlist-step-requested' } | Select-Object -Last 30)
    $finalGeneration = [int]($rapidRequests | Select-Object -Last 1).generation
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'The newest requested generation did not become the asserted current playlist position.' -Condition {
        $events = Get-RecordedEvents $logPath
        @($events | Where-Object { $_.event -eq 'mpv-generation-current' -and $_.generation -eq $finalGeneration }).Count -gt 0
    }
    $interaction.rapidAlternatingLoads = Confirm-ObservedStep "Confirm the rapid test finished on newest generation $finalGeneration and its final requested playlist entry is the visible/current selection."

    $oldProcessId = [int]$initialMpv.ProcessId
    $killStartedAt = [DateTime]::UtcNow
    Stop-Process -Id $oldProcessId -Force
    Wait-Until -TimeoutSeconds 5 -FailureMessage 'A controlled mpv replacement attempt did not start after process termination.' -Condition {
        $events = Get-RecordedEvents $logPath
        @($events | Where-Object { $_.event -eq 'mpv-replacement-started' }).Count -gt 0
    }
    $replacementStartedAt = [DateTime]::UtcNow
    $replacementStartWallMs = ($replacementStartedAt - $killStartedAt).TotalMilliseconds
    if ($replacementStartWallMs -gt 1000) {
        throw "The controlled replacement attempt started after $replacementStartWallMs ms, exceeding one second."
    }
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'The controlled replacement did not spawn the verified bundled executable.' -Condition {
        $script:replacementMpv = Get-BundledMpvProcess -ExecutablePath $mpvPath -ExcludedProcessIds @($oldProcessId)
        $null -ne $script:replacementMpv
    }
    $replacementBoundary = Get-MpvProcessBoundary -MpvProcess $script:replacementMpv
    if ($replacementBoundary.wid -ne $initialBoundary.wid) {
        throw 'Replacement mpv was not embedded into the same live Electron window.'
    }
    if ($replacementBoundary.pipePath -eq $initialBoundary.pipePath) {
        throw 'Replacement mpv reused the prior per-process pipe name.'
    }
    $interaction.mpvKillRecovery = Confirm-ObservedStep 'Confirm Electron remained responsive and the replacement attempt returned the embedded player to a controllable state.'

    Read-Host 'Close the Coax Electron window, then press Enter'
    Wait-Until -TimeoutSeconds $ShutdownTimeoutSeconds -FailureMessage 'Electron did not close within the shutdown timeout.' -Condition {
        $devProcess.Refresh()
        $devProcess.HasExited
    }

    $ownedProcessIds = @($oldProcessId, [int]$script:replacementMpv.ProcessId)
    Wait-Until -TimeoutSeconds $ShutdownTimeoutSeconds -FailureMessage 'An owned mpv process remained after Electron closed.' -Condition {
        @($ownedProcessIds | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) }).Count -eq 0
    }

    $events = Get-RecordedEvents $logPath
    $orphanChecks = @($events | Where-Object { $_.event -eq 'mpv-orphan-check' })
    $lastOrphanCheck = $orphanChecks | Select-Object -Last 1
    $logText = Get-Content -LiteralPath $logPath -Raw
    $logContainsSensitiveValue = $false
    foreach ($sensitiveValue in $sensitiveValues) {
        if ($sensitiveValue.Length -ge 4 -and $logText.Contains($sensitiveValue)) {
            $logContainsSensitiveValue = $true
        }
    }
    $initialPipeReachable = Test-NamedPipeReachable $initialBoundary.pipePath
    $replacementPipeReachable = Test-NamedPipeReachable $replacementBoundary.pipePath
    $geometrySamples = @($events | Where-Object { $_.event -eq 'window-geometry-synchronized' })
    $replacementStarted = $events | Where-Object { $_.event -eq 'mpv-replacement-started' } | Select-Object -Last 1
    $interactionMatrixPassed = @($interaction.Values | Where-Object { -not $_ }).Count -eq 0

    $result = [ordered]@{
        schemaVersion = 1
        runId = $runId
        verifiedBundledExecutable = $true
        widMatchedElectronWindow = $widMatchesElectronWindow
        monitorCount = $monitorCount
        interactionMatrix = $interaction
        interactionMatrixPassed = $interactionMatrixPassed
        geometrySampleCount = $geometrySamples.Count
        rapidRequestCount = $rapidRequests.Count
        finalRequestedGeneration = $finalGeneration
        finalGenerationAsserted = @($events | Where-Object { $_.event -eq 'mpv-generation-current' -and $_.generation -eq $finalGeneration }).Count -gt 0
        replacementAttemptElapsedMs = $replacementStarted.elapsedSinceFailureMs
        replacementStartWallMs = [Math]::Round($replacementStartWallMs, 1)
        replacementUsedFreshPipe = $replacementBoundary.pipePath -ne $initialBoundary.pipePath
        streamOrCredentialInProcessArguments = $argumentsContainSensitiveValue
        streamOrCredentialInPersistedLog = $logContainsSensitiveValue
        mpvProcessAliveAfterElectron = $false
        namedPipeReachableAfterElectron = $initialPipeReachable -or $replacementPipeReachable
        applicationOrphanCheckPassed = ($null -ne $lastOrphanCheck -and -not $lastOrphanCheck.processAlive -and -not $lastOrphanCheck.pipeReachable)
    }
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runDirectory 'acceptance.json') -Encoding UTF8

    if (-not $interactionMatrixPassed -or -not $result.finalGenerationAsserted -or $result.replacementAttemptElapsedMs -gt 1000 -or $result.streamOrCredentialInProcessArguments -or $result.streamOrCredentialInPersistedLog -or $result.namedPipeReachableAfterElectron -or -not $result.applicationOrphanCheckPassed) {
        throw "Slice 3 acceptance failed. Review ignored raw evidence under artifacts\m0\$runId."
    }

    Write-Host "Slice 3 native acceptance passed. Raw evidence: artifacts\m0\$runId" -ForegroundColor Green
} finally {
    if ($null -ne $devProcess) {
        $devProcess.Refresh()
        if (-not $devProcess.HasExited) {
            & taskkill.exe /pid $devProcess.Id /t /f | Out-Null
        }
    }
    Pop-Location
}
