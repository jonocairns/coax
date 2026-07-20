[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [ValidateSet('All', 'Compare', 'Soak', 'Resolution', 'Fallback')]
    [string]$Mode = 'All',
    [ValidateSet('d3d11va', 'nvdec')]
    [string]$SoakProfile = 'd3d11va',
    [Parameter(Mandatory = $true)][string]$DisplayModel,
    [Parameter(Mandatory = $true)][string]$AudioOutput,
    [Parameter(Mandatory = $true)][string]$SourceRevision,
    [bool]$SourceDirty = $true
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Events {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
    return @(
        Get-Content -LiteralPath $Path |
            Where-Object { $_.Length -gt 0 } |
            ForEach-Object { $_ | ConvertFrom-Json }
    )
}

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

function Get-LastNumericSample {
    param(
        [Parameter(Mandatory = $true)][object[]]$Events,
        [Parameter(Mandatory = $true)][string]$Property,
        [double]$MinimumElapsedMs = 0
    )
    $sample = $Events |
        Where-Object {
            $_.event -eq 'mpv-performance-sample' -and
            $_.property -eq $Property -and
            $_.elapsedMs -ge $MinimumElapsedMs -and
            $_.value -is [ValueType]
        } |
        Select-Object -Last 1
    if ($null -eq $sample) { return $null }
    return [double]$sample.value
}

function Get-FirstNumericSample {
    param(
        [Parameter(Mandatory = $true)][object[]]$Events,
        [Parameter(Mandatory = $true)][string]$Property,
        [double]$MinimumElapsedMs = 0
    )
    $sample = $Events |
        Where-Object {
            $_.event -eq 'mpv-performance-sample' -and
            $_.property -eq $Property -and
            $_.elapsedMs -ge $MinimumElapsedMs -and
            $_.value -is [ValueType]
        } |
        Select-Object -First 1
    if ($null -eq $sample) { return $null }
    return [double]$sample.value
}

function Get-MpvResourceSample {
    param([Parameter(Mandatory = $true)][string]$RuntimePath)
    $native = Get-CimInstance Win32_Process -Filter "Name = 'mpv.exe'" |
        Where-Object {
            $_.ExecutablePath -and
            ([System.IO.Path]::GetFullPath($_.ExecutablePath) -eq [System.IO.Path]::GetFullPath($RuntimePath))
        } |
        Select-Object -First 1
    if ($null -eq $native) { return $null }
    $process = Get-Process -Id $native.ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    return [ordered]@{
        elapsedTimestamp = [DateTime]::UtcNow.ToString('o')
        workingSetMiB = [Math]::Round($process.WorkingSet64 / 1MB, 1)
        privateMemoryMiB = [Math]::Round($process.PrivateMemorySize64 / 1MB, 1)
        handleCount = $process.HandleCount
        cpuSeconds = [Math]::Round($process.CPU, 2)
    }
}

function Invoke-CoaxProfileRun {
    param(
        [Parameter(Mandatory = $true)][string]$RunName,
        [Parameter(Mandatory = $true)][ValidateSet('d3d11va', 'nvdec', 'software')][string]$Profile,
        [Parameter(Mandatory = $true)][string]$FixtureName,
        [Parameter(Mandatory = $true)][int]$DurationSeconds,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$RuntimePath,
        [switch]$ViewportCycle
    )
    $childRunId = "$script:runId-$RunName"
    $childDirectory = Join-Path $RepositoryRoot "artifacts\m0\$childRunId"
    New-Item -ItemType Directory -Force -Path $childDirectory | Out-Null
    $fixturePath = Join-Path $RepositoryRoot "artifacts\m0\fixtures\$FixtureName"
    if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
        throw "Required ignored synthetic fixture is unavailable: $FixtureName"
    }

    $previous = [ordered]@{}
    foreach ($environmentName in @(
        'COAX_M0_RUN_ID',
        'COAX_M0_PLAYBACK_PROFILE',
        'COAX_SLICE6_ACCEPTANCE',
        'COAX_SLICE6_AUTO_EXIT_SECONDS',
        'COAX_SLICE6_FIXTURE_NAME',
        'COAX_SLICE6_FULLSCREEN',
        'COAX_SLICE6_VIEWPORT_CYCLE'
    )) {
        $previous[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
    }

    $electronProcess = $null
    $resources = @()
    try {
        $env:COAX_M0_RUN_ID = $childRunId
        $env:COAX_M0_PLAYBACK_PROFILE = $Profile
        $env:COAX_SLICE6_ACCEPTANCE = '1'
        $env:COAX_SLICE6_AUTO_EXIT_SECONDS = [string]$DurationSeconds
        $env:COAX_SLICE6_FIXTURE_NAME = $FixtureName
        $env:COAX_SLICE6_FULLSCREEN = '1'
        $env:COAX_SLICE6_VIEWPORT_CYCLE = if ($ViewportCycle) { '1' } else { '0' }
        $electronPath = Join-Path $RepositoryRoot 'node_modules\electron\dist\electron.exe'
        if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) {
            throw 'The pinned Electron executable is unavailable. Run the frozen dependency install first.'
        }
        $electronProcess = Start-Process -FilePath $electronPath -ArgumentList @('.') -WorkingDirectory $RepositoryRoot -PassThru `
            -RedirectStandardOutput (Join-Path $childDirectory 'electron.stdout.txt') `
            -RedirectStandardError (Join-Path $childDirectory 'electron.stderr.txt')

        $logPath = Join-Path $childDirectory 'playback-events.jsonl'
        Wait-Until -TimeoutSeconds 90 -FailureMessage "Timed out waiting for $RunName playback." -Condition {
            @(
                Get-Events $logPath |
                    Where-Object { $_.event -eq 'mpv-event' -and $_.mpvEvent -eq 'playback-restart' }
            ).Count -gt 0
        }
        $deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds + 45)
        while ([DateTime]::UtcNow -lt $deadline) {
            $electronProcess.Refresh()
            if ($electronProcess.HasExited) { break }
            $sample = Get-MpvResourceSample -RuntimePath $RuntimePath
            if ($null -ne $sample) { $resources += $sample }
            Start-Sleep -Seconds 5
        }
        $electronProcess.Refresh()
        if (-not $electronProcess.HasExited) { throw "$RunName did not auto-exit within its bound." }

        $events = Get-Events $logPath
        $restart = $events |
            Where-Object { $_.event -eq 'mpv-event' -and $_.mpvEvent -eq 'playback-restart' } |
            Select-Object -First 1
        $warmElapsed = [double]$restart.elapsedMs + 30000
        $warmDropped = Get-FirstNumericSample -Events $events -Property 'frame-drop-count' -MinimumElapsedMs $warmElapsed
        $finalDropped = Get-LastNumericSample -Events $events -Property 'frame-drop-count'
        $warmDecoderDropped = Get-FirstNumericSample -Events $events -Property 'decoder-frame-drop-count' -MinimumElapsedMs $warmElapsed
        $finalDecoderDropped = Get-LastNumericSample -Events $events -Property 'decoder-frame-drop-count'
        $playbackSamples = @(
            $events |
                Where-Object {
                    $_.event -eq 'mpv-performance-sample' -and
                    $_.property -eq 'playback-time' -and
                    $_.elapsedMs -ge [double]$restart.elapsedMs -and
                    $_.value -is [ValueType]
                }
        )
        $firstPlaybackTime = if ($playbackSamples.Count -eq 0) { $null } else { [double]$playbackSamples[0].value }
        $lastPlaybackTime = if ($playbackSamples.Count -eq 0) { $null } else { [double]$playbackSamples[-1].value }
        $diagnostics = @($events | Where-Object { $_.event -eq 'mpv-video-diagnostics' })
        $finalDiagnostics = $diagnostics |
            Where-Object { $null -ne $_.sourceWidth -and $null -ne $_.viewportWidth } |
            Select-Object -Last 1
        $recoveries = @(
            $events |
                Where-Object {
                    $_.event -in @(
                        'mpv-hang-detected',
                        'mpv-replacement-requested',
                        'mpv-replacement-scheduled',
                        'mpv-replacement-started',
                        'mpv-replacement-failed'
                    )
                }
        )
        $orphan = $events | Where-Object { $_.event -eq 'mpv-orphan-check' } | Select-Object -Last 1
        $electronGpu = $events | Where-Object { $_.event -eq 'electron-gpu-diagnostics' } | Select-Object -Last 1
        $profileSelected = $events | Where-Object { $_.event -eq 'mpv-profile-selected' } | Select-Object -Last 1
        $scalerRequests = @($events | Where-Object { $_.event -eq 'mpv-scaler-requested' })
        $scalerFailures = @(
            $events |
                Where-Object { $_.event -eq 'mpv-scaler-command-result' -and $_.result -ne 'success' }
        )
        return [ordered]@{
            name = $RunName
            profile = $Profile
            fixture = $FixtureName
            durationSeconds = $DurationSeconds
            electronGpu = if ($null -eq $electronGpu) { $null } else { [ordered]@{
                activeGpu = $electronGpu.activeGpu
                driverVersion = $electronGpu.driverVersion
                hardwareAccelerationEnabled = $electronGpu.hardwareAccelerationEnabled
                videoDecodeFeature = $electronGpu.videoDecodeFeature
            } }
            selectedAdapter = $profileSelected.adapter
            requestedHwdec = $profileSelected.hwdecRequested
            actualHwdec = $finalDiagnostics.hwdecCurrent
            decoder = $finalDiagnostics.decoder
            renderPath = $finalDiagnostics.renderPath
            sourceWidth = $finalDiagnostics.sourceWidth
            sourceHeight = $finalDiagnostics.sourceHeight
            outputWidth = $finalDiagnostics.outputWidth
            outputHeight = $finalDiagnostics.outputHeight
            viewportWidth = $finalDiagnostics.viewportWidth
            viewportHeight = $finalDiagnostics.viewportHeight
            vsrRequested = $finalDiagnostics.vsrRequested
            vsrFilterAttached = $finalDiagnostics.vsrFilterAttached
            vsrConfirmed = $finalDiagnostics.vsrConfirmed
            vsrConfirmationSignal = $finalDiagnostics.vsrConfirmationSignal
            scaleFactor = $finalDiagnostics.scaleFactor
            warmVoDropped = $warmDropped
            finalVoDropped = $finalDropped
            voDroppedDeltaAfterWarmup = if ($null -eq $warmDropped -or $null -eq $finalDropped) { $null } else { $finalDropped - $warmDropped }
            decoderDroppedDeltaAfterWarmup = if ($null -eq $warmDecoderDropped -or $null -eq $finalDecoderDropped) { $null } else { $finalDecoderDropped - $warmDecoderDropped }
            playbackTimeAdvance = if ($null -eq $firstPlaybackTime -or $null -eq $lastPlaybackTime) { $null } else { [Math]::Round($lastPlaybackTime - $firstPlaybackTime, 1) }
            recoveryEventCount = $recoveries.Count
            scalerCommandFailureCount = $scalerFailures.Count
            scalerRequests = @($scalerRequests | ForEach-Object { [ordered]@{
                reason = $_.reason
                sourceWidth = $_.sourceWidth
                sourceHeight = $_.sourceHeight
                viewportWidth = $_.viewportWidth
                viewportHeight = $_.viewportHeight
                vsrRequested = $_.vsrRequested
                scaleFactor = $_.scaleFactor
            } })
            diagnosticStates = @($diagnostics | ForEach-Object { [ordered]@{
                reason = $_.reason
                sourceWidth = $_.sourceWidth
                sourceHeight = $_.sourceHeight
                outputWidth = $_.outputWidth
                outputHeight = $_.outputHeight
                viewportWidth = $_.viewportWidth
                viewportHeight = $_.viewportHeight
                actualHwdec = $_.hwdecCurrent
                vsrRequested = $_.vsrRequested
                vsrFilterAttached = $_.vsrFilterAttached
                scaleFactor = $_.scaleFactor
            } })
            resources = $resources
            cleanShutdown = $null -ne $orphan -and -not $orphan.processAlive -and -not $orphan.pipeReachable
        }
    } finally {
        foreach ($entry in $previous.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
        }
        if ($null -ne $electronProcess) {
            $electronProcess.Refresh()
            if (-not $electronProcess.HasExited) {
                & taskkill.exe /pid $electronProcess.Id /t /f | Out-Null
            }
        }
    }
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDirectory = Join-Path $repositoryRoot 'runtime\mpv\bin\windows-x64'
$runtimePath = Join-Path $runtimeDirectory 'mpv.exe'
$runtimeConsolePath = Join-Path $runtimeDirectory 'mpv.com'
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf) -or -not (Test-Path -LiteralPath $runtimeConsolePath -PathType Leaf)) {
    throw 'The existing pinned Windows mpv runtime is missing. Run fetch-mpv-runtime.ps1 without changing the manifest.'
}

$script:runId = 'slice6-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runDirectory = Join-Path $repositoryRoot "artifacts\m0\$script:runId"
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null

Push-Location $repositoryRoot
try {
    if (-not $SkipInstall) {
        & corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "Frozen dependency install failed with exit code $LASTEXITCODE." }
    }
    & corepack pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed with exit code $LASTEXITCODE." }
    $os = Get-CimInstance Win32_OperatingSystem
    $nvidia = Get-CimInstance Win32_VideoController |
        Where-Object { $_.Name -match 'NVIDIA.*RTX' } |
        Select-Object -First 1
    if ($null -eq $nvidia) { throw 'The target NVIDIA RTX adapter was not found.' }
    $adapterOutput = & $runtimeConsolePath --no-config --vo=gpu-next --gpu-api=d3d11 --gpu-context=d3d11 --d3d11-adapter=help --idle=no 2>&1
    $adapterOutput | Set-Content -LiteralPath (Join-Path $runDirectory 'adapter-probe.txt') -Encoding UTF8
    $adapters = @(
        $adapterOutput | ForEach-Object {
            if ($_ -match '^Adapter ([0-9]+): vendor: ([0-9]+), description: (.+)$') {
                [ordered]@{ index = [int]$Matches[1]; vendorId = [int]$Matches[2]; description = $Matches[3] }
            }
        }
    )
    $versionOutput = & $runtimeConsolePath --version
    $benchmarkConfiguration = [ordered]@{
        sourceRevision = $SourceRevision
        sourceDirty = $SourceDirty
        windows = "$($os.Caption) build $($os.BuildNumber)"
        gpu = $nvidia.Name
        nvidiaDriver = $nvidia.DriverVersion
        displayModel = $DisplayModel
        displayMode = "$($nvidia.CurrentHorizontalResolution)x$($nvidia.CurrentVerticalResolution) at $($nvidia.CurrentRefreshRate) Hz"
        audioOutput = $AudioOutput
        electron = '43.1.1'
        embeddedNode = '24.18.0'
        mpv = [string]($versionOutput | Select-Object -First 1)
        ffmpeg = [string]($versionOutput | Where-Object { $_ -match '^FFmpeg version:' } | Select-Object -First 1)
        adapters = $adapters
    }

    $results = @()
    if ($Mode -in @('All', 'Compare')) {
        foreach ($profile in @('d3d11va', 'nvdec', 'software')) {
            $results += Invoke-CoaxProfileRun -RunName "compare-$profile" -Profile $profile `
                -FixtureName 'clean-720p50.mkv' -DurationSeconds 45 `
                -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
        }
    }
    if ($Mode -in @('All', 'Resolution')) {
        $results += Invoke-CoaxProfileRun -RunName 'resolution-change' -Profile $SoakProfile `
            -FixtureName 'resolution-change-50.mpegts' -DurationSeconds 25 `
            -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath -ViewportCycle
    }
    if ($Mode -in @('All', 'Fallback')) {
        $results += Invoke-CoaxProfileRun -RunName 'forced-fallback' -Profile 'd3d11va' `
            -FixtureName 'hwdec-fallback-720p50.mkv' -DurationSeconds 25 `
            -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
    }
    if ($Mode -in @('All', 'Soak')) {
        $results += Invoke-CoaxProfileRun -RunName 'ten-minute-soak' -Profile $SoakProfile `
            -FixtureName 'clean-720p50.mkv' -DurationSeconds 635 `
            -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
    }

    $result = [ordered]@{
        schemaVersion = 1
        runId = $script:runId
        mode = $Mode
        benchmarkConfiguration = $benchmarkConfiguration
        results = $results
    }
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runDirectory 'acceptance.json') -Encoding UTF8
    Write-Host "Slice 6 native run completed. Raw evidence: artifacts\m0\$script:runId" -ForegroundColor Green
} finally {
    Pop-Location
}
