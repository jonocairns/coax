[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [int]$PlaybackTimeoutSeconds = 90,
    [int]$ShutdownTimeoutSeconds = 30,
    [string]$ControllerModel = 'None available',
    [ValidateSet('None', 'USB', 'Bluetooth', 'Xbox Wireless Adapter')]
    [string]$ControllerConnectionMode = 'None'
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
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 250
    }
    throw $FailureMessage
}

function Confirm-ObservedStep {
    param([Parameter(Mandatory = $true)][string]$Prompt)

    $response = Read-Host "$Prompt Type YES only after observing every repetition, or SKIP only when the required hardware is unavailable"
    if ($response -eq 'YES') { return $true }
    if ($response -eq 'SKIP') { return $false }
    throw "Native observation was not confirmed: $Prompt"
}

function Get-RecordedEvents {
    param([Parameter(Mandatory = $true)][string]$LogPath)

    if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { return @() }
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

function Test-NamedPipeReachable {
    param([Parameter(Mandatory = $true)][string]$PipePath)

    $prefix = '\\.\pipe\'
    if (-not $PipePath.StartsWith($prefix)) { throw 'Unexpected mpv pipe path.' }
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
    if (-not [Coax.NativeWindowInspector]::IsWindow($windowHandle)) { return $false }
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

$detectedControllerNames = @(
    Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.FriendlyName -match 'game controller|xbox|wireless controller|dualsense|dualshock' } |
        ForEach-Object { $_.FriendlyName } |
        Sort-Object -Unique
)
$controllerAvailable = $ControllerConnectionMode -ne 'None'
if ($controllerAvailable -and $ControllerModel -eq 'None available') {
    throw 'Specify the exact controller model when a controller connection mode is supplied.'
}
if (-not $controllerAvailable -and $detectedControllerNames.Count -gt 0) {
    throw 'A possible controller is present. Rerun with its exact -ControllerModel and -ControllerConnectionMode.'
}
Write-Host "M0 controller: $ControllerModel; connection mode: $ControllerConnectionMode" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
    Write-Host 'Slice 4 needs the existing private, ignored playback input.' -ForegroundColor Yellow
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
        throw 'The existing pinned runtime is missing. Run fetch-mpv-runtime.ps1 separately before Slice 4 acceptance.'
    }
    Write-Host 'Using the existing pinned runtime; Electron will recompute and verify its hashes before spawn.'

    if (-not $SkipInstall) {
        & corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "Frozen dependency install failed with exit code $LASTEXITCODE." }
    }

    $runId = 'slice4-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $runDirectory = Join-Path $repositoryRoot "artifacts\m0\$runId"
    New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'runtime\mpv\windows-x64.json') -Destination (Join-Path $runDirectory 'runtime-manifest.json')

    $previousRunId = $env:COAX_M0_RUN_ID
    $previousAcceptanceMode = $env:COAX_SLICE4_ACCEPTANCE
    $env:COAX_M0_RUN_ID = $runId
    $env:COAX_SLICE4_ACCEPTANCE = '1'
    $standardOutput = Join-Path $runDirectory 'electron-vite.stdout.txt'
    $standardError = Join-Path $runDirectory 'electron-vite.stderr.txt'
    try {
        $corepack = (Get-Command corepack).Source
        $devProcess = Start-Process -FilePath $corepack -ArgumentList @('pnpm', 'dev') -PassThru -RedirectStandardOutput $standardOutput -RedirectStandardError $standardError
    } finally {
        $env:COAX_M0_RUN_ID = $previousRunId
        $env:COAX_SLICE4_ACCEPTANCE = $previousAcceptanceMode
    }

    $logPath = Join-Path $runDirectory 'playback-events.jsonl'
    $requiredPlaybackEvents = @('start-file', 'file-loaded', 'playback-restart', 'video-reconfig', 'audio-reconfig')
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Timed out waiting for required playback events.' -Condition {
        $recorded = Get-RecordedEvents $logPath
        $seen = @($recorded | Where-Object { $_.event -eq 'mpv-event' } | ForEach-Object { $_.mpvEvent })
        @($requiredPlaybackEvents | Where-Object { $_ -notin $seen }).Count -eq 0
    }

    $initialMpv = Get-BundledMpvProcess -ExecutablePath $mpvPath
    if ($null -eq $initialMpv) { throw 'The running mpv process is not the verified bundled executable.' }
    $initialBoundary = Get-MpvProcessBoundary -MpvProcess $initialMpv
    $widMatchesElectronWindow = Test-WidBelongsToElectronWindow -Wid $initialBoundary.wid
    if (-not $widMatchesElectronWindow) { throw '--wid did not match a live Electron native host.' }

    $argumentsContainSensitiveValue = $false
    foreach ($sensitiveValue in $sensitiveValues) {
        if ($sensitiveValue.Length -ge 4 -and $initialBoundary.commandLine.Contains($sensitiveValue)) {
            $argumentsContainSensitiveValue = $true
        }
    }

    Add-Type -AssemblyName System.Windows.Forms
    $monitorCount = [System.Windows.Forms.Screen]::AllScreens.Count
    Write-Host "Path A interaction matrix begins with $monitorCount available monitor(s)." -ForegroundColor Cyan
    $interaction = [ordered]@{}
    $interaction.moveResize = Confirm-ObservedStep 'Move and resize Coax repeatedly with the overlay shown; confirm video and overlay remain parented, clipped, aligned, and correctly stacked.'
    $interaction.fullscreenCycles = Confirm-ObservedStep 'Complete ten fullscreen enter/exit cycles with the overlay shown and hidden; confirm no orphaning, inaccessibility, or incorrect stacking.'
    $interaction.monitorDpiRoundTrips = Confirm-ObservedStep 'Complete five round trips across every available monitor/DPI mode; confirm no persistent video or overlay geometry corruption.'
    if (-not $interaction.monitorDpiRoundTrips -and $monitorCount -gt 1) {
        throw 'Monitor/DPI coverage was skipped even though multiple monitors are available.'
    }
    $interaction.altTabCycles = Confirm-ObservedStep 'Complete ten Alt+Tab away/back cycles with the overlay shown; confirm the pair returns together and remains controllable.'
    $interaction.minimiseRestoreCycles = Confirm-ObservedStep 'Complete ten minimise/restore cycles with the overlay shown; confirm both layers return without a manual reset.'
    $interaction.displaySleepResume = Confirm-ObservedStep 'Complete one display sleep/resume cycle; confirm recovery feedback appears and the player remains controllable without restarting Coax.'

    $eventsBeforeOverlayCycles = Get-RecordedEvents $logPath
    $shownBefore = @($eventsBeforeOverlayCycles | Where-Object { $_.event -eq 'overlay-shown' -and $_.focusRequested }).Count
    $hiddenBefore = @($eventsBeforeOverlayCycles | Where-Object { $_.event -eq 'overlay-hidden' }).Count
    Read-Host 'Complete ten F8/Enter show then Escape/Back hide cycles, verifying focus transfer every time, then press Enter'
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Ten overlay show/focus and hide cycles were not recorded.' -Condition {
        $cycleEvents = Get-RecordedEvents $logPath
        $newShown = @($cycleEvents | Where-Object { $_.event -eq 'overlay-shown' -and $_.focusRequested }).Count - $shownBefore
        $newHidden = @($cycleEvents | Where-Object { $_.event -eq 'overlay-hidden' }).Count - $hiddenBefore
        $newShown -ge 10 -and $newHidden -ge 10
    }
    $interaction.overlayFocusCycles = Confirm-ObservedStep 'Confirm all ten overlay show/hide and focus-transfer cycles completed with zero failures requiring a window reset or app restart.'
    $interaction.pointerClickThrough = Confirm-ObservedStep 'With the overlay shown, confirm the panel controls accept pointer input and the transparent area intentionally passes pointer input through.'

    $requestsBeforeKeyboard = @(Get-RecordedEvents $logPath | Where-Object { $_.event -eq 'mpv-playlist-step-requested' }).Count
    Read-Host 'Using keyboard only, open the overlay, move focus with arrow keys, activate Previous or Next with Enter, then return with Escape; press Enter here afterward'
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Keyboard navigation did not produce a playlist intent.' -Condition {
        @(Get-RecordedEvents $logPath | Where-Object { $_.event -eq 'mpv-playlist-step-requested' }).Count -gt $requestsBeforeKeyboard
    }
    $interaction.keyboardNavigation = Confirm-ObservedStep 'Confirm keyboard arrows, accept, and back followed the overlay focus path independently without focus becoming trapped.'
    $interaction.feedback = Confirm-ObservedStep 'Confirm the overlay visibly showed fixed now/next placeholders plus immediate zap feedback; recovery feedback will be checked again during mpv replacement.'

    if ($controllerAvailable) {
        $interaction.controllerNavigation = Confirm-ObservedStep "Using $ControllerModel over $ControllerConnectionMode, confirm D-pad, accept, and back follow the same focus path without trapping focus."
    } else {
        $interaction.controllerNavigation = $null
        Write-Host 'Controller coverage remains open because no M0 controller is available.' -ForegroundColor Yellow
    }

    $eventsBeforeRapidTest = Get-RecordedEvents $logPath
    $requestsBeforeRapidTest = @($eventsBeforeRapidTest | Where-Object { $_.event -eq 'mpv-playlist-step-requested' }).Count
    Read-Host 'Run the fixed 30-change test using the Coax button or F9, then press Enter'
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Thirty rapid playlist requests were not recorded.' -Condition {
        @(Get-RecordedEvents $logPath | Where-Object { $_.event -eq 'mpv-playlist-step-requested' }).Count -ge ($requestsBeforeRapidTest + 30)
    }
    $rapidRequests = @(Get-RecordedEvents $logPath | Where-Object { $_.event -eq 'mpv-playlist-step-requested' } | Select-Object -Last 30)
    $finalGeneration = [int]($rapidRequests | Select-Object -Last 1).generation
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Newest requested generation did not become current.' -Condition {
        @(Get-RecordedEvents $logPath | Where-Object { $_.event -eq 'mpv-generation-current' -and $_.generation -eq $finalGeneration }).Count -gt 0
    }
    $interaction.rapidAlternatingLoads = Confirm-ObservedStep "Confirm the rapid test kept the overlay usable and finished visibly on newest generation $finalGeneration."

    $oldProcessId = [int]$initialMpv.ProcessId
    $killStartedAt = [DateTime]::UtcNow
    Stop-Process -Id $oldProcessId -Force
    Wait-Until -TimeoutSeconds 5 -FailureMessage 'Controlled mpv replacement did not start.' -Condition {
        @(Get-RecordedEvents $logPath | Where-Object { $_.event -eq 'mpv-replacement-started' }).Count -gt 0
    }
    $replacementStartWallMs = ([DateTime]::UtcNow - $killStartedAt).TotalMilliseconds
    if ($replacementStartWallMs -gt 1000) { throw "Replacement started after $replacementStartWallMs ms, exceeding one second." }
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Replacement did not spawn the verified executable.' -Condition {
        $script:replacementMpv = Get-BundledMpvProcess -ExecutablePath $mpvPath -ExcludedProcessIds @($oldProcessId)
        $null -ne $script:replacementMpv
    }
    $replacementBoundary = Get-MpvProcessBoundary -MpvProcess $script:replacementMpv
    if ($replacementBoundary.wid -ne $initialBoundary.wid) { throw 'Replacement mpv used a different native host.' }
    if ($replacementBoundary.pipePath -eq $initialBoundary.pipePath) { throw 'Replacement mpv reused the prior pipe.' }
    $interaction.mpvKillRecovery = Confirm-ObservedStep 'Confirm Electron stayed responsive, immediate recovery feedback was visible, and replacement returned embedded playback to a controllable state.'

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
    $logText = Get-Content -LiteralPath $logPath -Raw
    $logContainsSensitiveValue = $false
    foreach ($sensitiveValue in $sensitiveValues) {
        if ($sensitiveValue.Length -ge 4 -and $logText.Contains($sensitiveValue)) { $logContainsSensitiveValue = $true }
    }
    $orphanCheck = $events | Where-Object { $_.event -eq 'mpv-orphan-check' } | Select-Object -Last 1
    $initialPipeReachable = Test-NamedPipeReachable $initialBoundary.pipePath
    $replacementPipeReachable = Test-NamedPipeReachable $replacementBoundary.pipePath
    $overlayShown = @($events | Where-Object { $_.event -eq 'overlay-shown' -and $_.focusRequested }).Count - $shownBefore
    $overlayHidden = @($events | Where-Object { $_.event -eq 'overlay-hidden' }).Count - $hiddenBefore
    $focusToOverlay = @($events | Where-Object { $_.event -eq 'overlay-focus-transferred' -and $_.to -eq 'overlay' }).Count
    $focusToShell = @($events | Where-Object { $_.event -eq 'overlay-focus-transferred' -and $_.to -eq 'shell' }).Count
    $availableInteractionPassed = $interaction.moveResize -and $interaction.fullscreenCycles -and $interaction.altTabCycles -and $interaction.minimiseRestoreCycles -and $interaction.displaySleepResume -and $interaction.overlayFocusCycles -and $interaction.pointerClickThrough -and $interaction.keyboardNavigation -and $interaction.feedback -and $interaction.rapidAlternatingLoads -and $interaction.mpvKillRecovery
    if ($monitorCount -gt 1) { $availableInteractionPassed = $availableInteractionPassed -and $interaction.monitorDpiRoundTrips }
    if ($controllerAvailable) { $availableInteractionPassed = $availableInteractionPassed -and $interaction.controllerNavigation }

    $openCriteria = @()
    if (-not $interaction.monitorDpiRoundTrips) { $openCriteria += 'five monitor/DPI round trips' }
    if (-not $controllerAvailable) { $openCriteria += 'recorded controller D-pad, accept, and back path' }
    $nativeGateComplete = $availableInteractionPassed -and $openCriteria.Count -eq 0

    $result = [ordered]@{
        schemaVersion = 1
        runId = $runId
        chosenPath = 'A'
        controller = [ordered]@{
            model = $ControllerModel
            connectionMode = $ControllerConnectionMode
            available = $controllerAvailable
            detectedNames = $detectedControllerNames
        }
        monitorCount = $monitorCount
        interactionMatrix = $interaction
        overlayFocusedShowCount = $overlayShown
        overlayHideCount = $overlayHidden
        focusTransfersToOverlay = $focusToOverlay
        focusTransfersToShell = $focusToShell
        rapidRequestCount = $rapidRequests.Count
        finalRequestedGeneration = $finalGeneration
        finalGenerationAsserted = @($events | Where-Object { $_.event -eq 'mpv-generation-current' -and $_.generation -eq $finalGeneration }).Count -gt 0
        replacementStartWallMs = [Math]::Round($replacementStartWallMs, 1)
        verifiedBundledExecutable = $true
        widMatchedElectronWindow = $widMatchesElectronWindow
        streamOrCredentialInProcessArguments = $argumentsContainSensitiveValue
        streamOrCredentialInPersistedLog = $logContainsSensitiveValue
        namedPipeReachableAfterElectron = $initialPipeReachable -or $replacementPipeReachable
        applicationOrphanCheckPassed = ($null -ne $orphanCheck -and -not $orphanCheck.processAlive -and -not $orphanCheck.pipeReachable)
        availableInteractionPassed = $availableInteractionPassed
        nativeGateComplete = $nativeGateComplete
        openCriteria = $openCriteria
    }
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runDirectory 'acceptance.json') -Encoding UTF8

    if (-not $availableInteractionPassed -or $overlayShown -lt 10 -or $overlayHidden -lt 10 -or -not $result.finalGenerationAsserted -or $result.replacementStartWallMs -gt 1000 -or $result.streamOrCredentialInProcessArguments -or $result.streamOrCredentialInPersistedLog -or $result.namedPipeReachableAfterElectron -or -not $result.applicationOrphanCheckPassed) {
        throw "Slice 4 available native acceptance failed. Review ignored raw evidence under artifacts\m0\$runId."
    }

    if ($nativeGateComplete) {
        Write-Host "Slice 4 Path A native acceptance passed. Raw evidence: artifacts\m0\$runId" -ForegroundColor Green
    } else {
        Write-Host "Slice 4 Path A passed every available row; M0a remains incomplete: $($openCriteria -join '; '). Raw evidence: artifacts\m0\$runId" -ForegroundColor Yellow
    }
} finally {
    if ($null -ne $devProcess) {
        $devProcess.Refresh()
        if (-not $devProcess.HasExited) { & taskkill.exe /pid $devProcess.Id /t /f | Out-Null }
    }
    Pop-Location
}
