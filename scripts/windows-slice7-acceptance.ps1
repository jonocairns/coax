[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipVisualChecks,
    [switch]$LegallyUsableRealSportsSourceAvailable,
    [ValidateSet('All', 'Record', 'Progressive', 'Interlaced', 'WrongFieldOrder', 'Fallback', 'Soak')]
    [string]$Mode = 'All',
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

function Get-NumericSamples {
    param(
        [Parameter(Mandatory = $true)][object[]]$Events,
        [Parameter(Mandatory = $true)][string]$Property,
        [double]$MinimumElapsedMs = 0
    )
    return @(
        $Events |
            Where-Object {
                $_.event -eq 'mpv-performance-sample' -and
                $_.property -eq $Property -and
                $_.elapsedMs -ge $MinimumElapsedMs -and
                $_.value -is [ValueType]
            } |
            ForEach-Object {
                [ordered]@{ elapsedMs = [double]$_.elapsedMs; value = [double]$_.value }
            }
    )
}

function Get-CounterDelta {
    param(
        [Parameter(Mandatory = $true)][object[]]$Events,
        [Parameter(Mandatory = $true)][string]$Property,
        [double]$MinimumElapsedMs
    )
    $samples = @(Get-NumericSamples -Events $Events -Property $Property -MinimumElapsedMs $MinimumElapsedMs)
    if ($samples.Count -lt 2) { return $null }
    return [double]$samples[-1].value - [double]$samples[0].value
}

function Get-Median {
    param([Parameter(Mandatory = $true)][double[]]$Values)
    if ($Values.Count -eq 0) { return $null }
    $sorted = @($Values | Sort-Object)
    $middle = [Math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2 -eq 0) {
        return ([double]$sorted[$middle - 1] + [double]$sorted[$middle]) / 2
    }
    return [double]$sorted[$middle]
}

function Get-FittedSlopePerHour {
    param(
        [Parameter(Mandatory = $true)][object[]]$Samples,
        [Parameter(Mandatory = $true)][string]$ElapsedProperty,
        [Parameter(Mandatory = $true)][string]$ValueProperty
    )
    if ($Samples.Count -lt 2) { return $null }
    $sumX = 0.0
    $sumY = 0.0
    foreach ($sample in $Samples) {
        $sumX += [double]$sample[$ElapsedProperty]
        $sumY += [double]$sample[$ValueProperty]
    }
    $meanX = $sumX / $Samples.Count
    $meanY = $sumY / $Samples.Count
    $numerator = 0.0
    $denominator = 0.0
    foreach ($sample in $Samples) {
        $x = [double]$sample[$ElapsedProperty] - [double]$meanX
        $numerator += $x * ([double]$sample[$ValueProperty] - [double]$meanY)
        $denominator += $x * $x
    }
    if ($denominator -eq 0) { return $null }
    return [Math]::Round(($numerator / $denominator) * 3600, 3)
}

function Get-DescendantProcessIds {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)
    $all = @(Get-CimInstance Win32_Process)
    $known = New-Object 'System.Collections.Generic.HashSet[int]'
    $null = $known.Add($RootProcessId)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $all) {
            if ($known.Contains([int]$process.ParentProcessId) -and -not $known.Contains([int]$process.ProcessId)) {
                $null = $known.Add([int]$process.ProcessId)
                $changed = $true
            }
        }
    }
    return @($known)
}

function Get-ResourceSample {
    param(
        [Parameter(Mandatory = $true)][int]$ElectronProcessId,
        [Parameter(Mandatory = $true)][string]$RuntimePath,
        [Parameter(Mandatory = $true)][Diagnostics.Stopwatch]$Stopwatch
    )
    $coaxProcesses = @(
        Get-DescendantProcessIds -RootProcessId $ElectronProcessId |
            ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } |
            Where-Object { $null -ne $_ -and $_.ProcessName -ne 'mpv' }
    )
    $native = Get-CimInstance Win32_Process -Filter "Name = 'mpv.exe'" |
        Where-Object {
            $_.ExecutablePath -and
            ([System.IO.Path]::GetFullPath($_.ExecutablePath) -eq [System.IO.Path]::GetFullPath($RuntimePath))
        } |
        Select-Object -First 1
    $mpv = if ($null -eq $native) { $null } else { Get-Process -Id $native.ProcessId -ErrorAction SilentlyContinue }
    if ($coaxProcesses.Count -eq 0 -or $null -eq $mpv) { return $null }
    $coaxWorking = ($coaxProcesses | Measure-Object -Property WorkingSet64 -Sum).Sum
    $coaxPrivate = ($coaxProcesses | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
    $coaxHandles = ($coaxProcesses | Measure-Object -Property HandleCount -Sum).Sum
    return [ordered]@{
        elapsedSeconds = [Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1)
        coaxWorkingSetMiB = [Math]::Round($coaxWorking / 1MB, 1)
        coaxPrivateMemoryMiB = [Math]::Round($coaxPrivate / 1MB, 1)
        coaxHandleCount = [int]$coaxHandles
        mpvWorkingSetMiB = [Math]::Round($mpv.WorkingSet64 / 1MB, 1)
        mpvPrivateMemoryMiB = [Math]::Round($mpv.PrivateMemorySize64 / 1MB, 1)
        mpvHandleCount = $mpv.HandleCount
        combinedPrivateMemoryMiB = [Math]::Round(($coaxPrivate + $mpv.PrivateMemorySize64) / 1MB, 1)
    }
}

function Read-VisualObservation {
    param([Parameter(Mandatory = $true)][string]$Prompt)
    if ($SkipVisualChecks) {
        return [ordered]@{ observed = $false; passed = $null; note = 'unobserved' }
    }
    $answer = Read-Host "$Prompt Type YES for pass or NO for fail"
    if ($answer -eq 'YES') {
        return [ordered]@{ observed = $true; passed = $true; note = 'user-confirmed' }
    }
    if ($answer -eq 'NO') {
        return [ordered]@{ observed = $true; passed = $false; note = 'user-rejected' }
    }
    return [ordered]@{ observed = $false; passed = $null; note = 'unobserved-invalid-response' }
}

function Test-MonotonicIncrease {
    param([Parameter(Mandatory = $true)][double[]]$Values)
    if ($Values.Count -lt 3) { return $false }
    for ($index = 1; $index -lt $Values.Count; $index += 1) {
        if ($Values[$index] -lt $Values[$index - 1]) { return $false }
    }
    return $Values[-1] -gt $Values[0]
}

function Invoke-CoaxSportsRun {
    param(
        [Parameter(Mandatory = $true)][string]$RunName,
        [Parameter(Mandatory = $true)][string]$FixtureName,
        [Parameter(Mandatory = $true)][double]$ExpectedFps,
        [Parameter(Mandatory = $true)][int]$DurationSeconds,
        [Parameter(Mandatory = $true)][int]$WarmupSeconds,
        [Parameter(Mandatory = $true)][string]$ContentFieldOrder,
        [Parameter(Mandatory = $true)][string]$MetadataFieldOrder,
        [Parameter(Mandatory = $true)][string]$FieldOrderOverride,
        [Parameter(Mandatory = $true)][string]$VisualPrompt,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$RuntimePath,
        [switch]$ForceDeinterlaceFailure
    )
    $childRunId = "$script:runId-$RunName"
    if ($childRunId.Length -gt 64) {
        throw 'Internal Slice 7 child run identifier exceeds the structured logger limit.'
    }
    $childDirectory = Join-Path $RepositoryRoot "artifacts\m0\$childRunId"
    New-Item -ItemType Directory -Force -Path $childDirectory | Out-Null
    $fixturePath = Join-Path $RepositoryRoot "artifacts\m0\fixtures\$FixtureName"
    if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
        throw "Required ignored synthetic fixture is unavailable: $FixtureName"
    }

    $environmentNames = @(
        'COAX_M0_RUN_ID',
        'COAX_M0_PLAYBACK_PROFILE',
        'COAX_M0_FIELD_ORDER_OVERRIDE',
        'COAX_SLICE7_ACCEPTANCE',
        'COAX_SLICE7_AUTO_EXIT_SECONDS',
        'COAX_SLICE7_FIXTURE_NAME',
        'COAX_SLICE7_FORCE_DEINTERLACE_FAILURE',
        'COAX_SLICE7_FULLSCREEN'
    )
    $previous = [ordered]@{}
    foreach ($environmentName in $environmentNames) {
        $previous[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
    }

    $electronProcess = $null
    $resources = @()
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $env:COAX_M0_RUN_ID = $childRunId
        $env:COAX_M0_PLAYBACK_PROFILE = 'd3d11va'
        $env:COAX_M0_FIELD_ORDER_OVERRIDE = $FieldOrderOverride
        $env:COAX_SLICE7_ACCEPTANCE = '1'
        $env:COAX_SLICE7_AUTO_EXIT_SECONDS = [string]$DurationSeconds
        $env:COAX_SLICE7_FIXTURE_NAME = $FixtureName
        $env:COAX_SLICE7_FORCE_DEINTERLACE_FAILURE = if ($ForceDeinterlaceFailure) { '1' } else { '0' }
        $env:COAX_SLICE7_FULLSCREEN = '1'
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
        $visual = Read-VisualObservation -Prompt $VisualPrompt
        $deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds + 45)
        while ([DateTime]::UtcNow -lt $deadline) {
            $electronProcess.Refresh()
            if ($electronProcess.HasExited) { break }
            $sample = Get-ResourceSample -ElectronProcessId $electronProcess.Id -RuntimePath $RuntimePath -Stopwatch $stopwatch
            if ($null -ne $sample) { $resources += $sample }
            Start-Sleep -Seconds 5
        }
        $electronProcess.Refresh()
        if (-not $electronProcess.HasExited) { throw "$RunName did not auto-exit within its bound." }

        $events = @(Get-Events $logPath)
        $restart = $events |
            Where-Object { $_.event -eq 'mpv-event' -and $_.mpvEvent -eq 'playback-restart' } |
            Select-Object -First 1
        $warmElapsed = [double]$restart.elapsedMs + ($WarmupSeconds * 1000)
        $cadenceSamples = @(Get-NumericSamples -Events $events -Property 'estimated-vf-fps' -MinimumElapsedMs $warmElapsed)
        $cadenceValues = @($cadenceSamples | ForEach-Object { [double]$_.value })
        $medianFps = if ($cadenceValues.Count -eq 0) { $null } else { Get-Median -Values $cadenceValues }
        $avsyncSamples = @(Get-NumericSamples -Events $events -Property 'avsync' -MinimumElapsedMs $warmElapsed)
        $avsyncValues = @($avsyncSamples | ForEach-Object { [Math]::Abs([double]$_.value) })
        $avsyncSlopeSamples = @(
            $avsyncSamples |
                ForEach-Object { [ordered]@{ elapsedSeconds = [double]$_.elapsedMs / 1000; value = [double]$_.value } }
        )
        $frameInfo = @(
            $events |
                Where-Object { $_.event -eq 'mpv-frame-info-sample' -and $_.elapsedMs -ge $warmElapsed }
        )
        $diagnostics = @($events | Where-Object { $_.event -eq 'mpv-video-diagnostics' })
        $finalDiagnostics = $diagnostics | Select-Object -Last 1
        $inputMetadata = $diagnostics |
            Where-Object { $_.frameInterlaced -eq $true } |
            Select-Object -First 1
        $profile = $events | Where-Object { $_.event -eq 'mpv-sports-motion-profile-selected' } | Select-Object -Last 1
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
        $graphFailures = @(
            $events |
                Where-Object { $_.event -eq 'mpv-video-graph-command-result' -and $_.result -ne 'success' }
        )
        $orphan = $events | Where-Object { $_.event -eq 'mpv-orphan-check' } | Select-Object -Last 1
        $playback = @(Get-NumericSamples -Events $events -Property 'playback-time' -MinimumElapsedMs ([double]$restart.elapsedMs))
        $warmResources = @($resources | Where-Object { $_.elapsedSeconds -ge ($WarmupSeconds + 5) })
        $privateValues = @($warmResources | ForEach-Object { [double]$_.combinedPrivateMemoryMiB })
        $handleValues = @($warmResources | ForEach-Object { [double]($_.coaxHandleCount + $_.mpvHandleCount) })
        $privateSlope = if ($warmResources.Count -lt 2) { $null } else {
            Get-FittedSlopePerHour -Samples $warmResources -ElapsedProperty 'elapsedSeconds' -ValueProperty 'combinedPrivateMemoryMiB'
        }
        $firstPrivate = if ($privateValues.Count -eq 0) { $null } else { $privateValues[0] }
        $lastPrivate = if ($privateValues.Count -eq 0) { $null } else { $privateValues[-1] }
        $resourceThresholdPassed = $null
        if ($null -ne $firstPrivate -and $null -ne $lastPrivate -and $null -ne $privateSlope) {
            $resourceThresholdPassed =
                $lastPrivate -le ($firstPrivate * 1.15) -and
                $privateSlope -lt 10 -and
                -not (Test-MonotonicIncrease -Values $handleValues)
        }
        $metadataObserved = if ($null -eq $inputMetadata) { 'unavailable' } elseif ($inputMetadata.frameTff) { 'tff' } else { 'bff' }

        return [ordered]@{
            name = $RunName
            fixture = $FixtureName
            expectedFps = $ExpectedFps
            contentFieldOrder = $ContentFieldOrder
            metadataFieldOrder = $MetadataFieldOrder
            metadataObserved = $metadataObserved
            fieldOrderOverride = $FieldOrderOverride
            configuredDeinterlaceMode = $profile.deinterlaceMode
            configuredInterlacedOnly = $profile.interlacedOnly
            finalDeinterlacePath = $finalDiagnostics.deinterlacePath
            deinterlaceFilterAttached = $finalDiagnostics.deinterlaceFilterAttached
            softwareFallbackAttached = $finalDiagnostics.softwareDeinterlaceFallbackAttached
            actualHwdec = $finalDiagnostics.hwdecCurrent
            renderPath = $finalDiagnostics.renderPath
            sourceWidth = $finalDiagnostics.sourceWidth
            sourceHeight = $finalDiagnostics.sourceHeight
            outputWidth = $finalDiagnostics.outputWidth
            outputHeight = $finalDiagnostics.outputHeight
            duplicateOwnedFilterCount = $finalDiagnostics.duplicateOwnedFilterCount
            vsrRequested = $finalDiagnostics.vsrRequested
            vsrFilterAttached = $finalDiagnostics.vsrFilterAttached
            vsrConfirmed = $finalDiagnostics.vsrConfirmed
            cadence = [ordered]@{
                sampleCount = $cadenceValues.Count
                medianFps = if ($null -eq $medianFps) { $null } else { [Math]::Round($medianFps, 3) }
                withinHalfFps = $null -ne $medianFps -and [Math]::Abs($medianFps - $ExpectedFps) -le 0.5
                voDropDelta = Get-CounterDelta -Events $events -Property 'frame-drop-count' -MinimumElapsedMs $warmElapsed
                decoderDropDelta = Get-CounterDelta -Events $events -Property 'decoder-frame-drop-count' -MinimumElapsedMs $warmElapsed
                mistimedFrameDelta = Get-CounterDelta -Events $events -Property 'mistimed-frame-count' -MinimumElapsedMs $warmElapsed
                delayedFrameDelta = Get-CounterDelta -Events $events -Property 'vo-delayed-frame-count' -MinimumElapsedMs $warmElapsed
                repeatTrueSampleCount = @($frameInfo | Where-Object { $_.repeat -eq $true }).Count
            }
            avDrift = [ordered]@{
                sampleCount = $avsyncSamples.Count
                firstSeconds = if ($avsyncSamples.Count -eq 0) { $null } else { $avsyncSamples[0].value }
                lastSeconds = if ($avsyncSamples.Count -eq 0) { $null } else { $avsyncSamples[-1].value }
                maximumAbsoluteSeconds = if ($avsyncValues.Count -eq 0) { $null } else { ($avsyncValues | Measure-Object -Maximum).Maximum }
                slopeSecondsPerHour = if ($avsyncSlopeSamples.Count -lt 2) { $null } else { Get-FittedSlopePerHour -Samples $avsyncSlopeSamples -ElapsedProperty 'elapsedSeconds' -ValueProperty 'value' }
                totalCorrectionDelta = Get-CounterDelta -Events $events -Property 'total-avsync-change' -MinimumElapsedMs $warmElapsed
            }
            playbackTimeAdvance = if ($playback.Count -lt 2) { $null } else { [Math]::Round([double]$playback[-1].value - [double]$playback[0].value, 1) }
            sourceVideoReconfigCount = @($events | Where-Object { $_.event -eq 'mpv-video-reconfiguration' -and $_.reason -eq 'source-video-reconfig' }).Count
            filterVideoReconfigCount = @($events | Where-Object { $_.event -eq 'mpv-video-reconfiguration' -and $_.reason -eq 'filter-video-reconfig' }).Count
            graphFailureCount = $graphFailures.Count
            forcedFailureObserved = @($graphFailures | Where-Object { $_.result -eq 'forced-failure' }).Count -gt 0
            recoveryEventCount = $recoveries.Count
            manualRecoveryCount = 0
            resources = [ordered]@{
                sampleCount = $warmResources.Count
                firstCombinedPrivateMiB = $firstPrivate
                lastCombinedPrivateMiB = $lastPrivate
                combinedPrivateSlopeMiBPerHour = $privateSlope
                handlesMonotonicIncrease = Test-MonotonicIncrease -Values $handleValues
                prdWarmBaselineThresholdsPassed = $resourceThresholdPassed
            }
            visual = $visual
            cleanShutdown = $null -ne $orphan -and -not $orphan.processAlive -and -not $orphan.pipeReachable
        }
    } finally {
        $stopwatch.Stop()
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

$script:runId = 'slice7-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runDirectory = Join-Path $repositoryRoot "artifacts\m0\$script:runId"
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null

$fixtureDefinitions = @(
    [ordered]@{ name = 'clean-720p50.mkv'; available = $false; kind = 'inherited-slice6-progressive-50' },
    [ordered]@{ name = 'sports-720p50.mkv'; available = $false; kind = 'progressive-50' },
    [ordered]@{ name = 'sports-720p5994.mkv'; available = $false; kind = 'progressive-59.94' },
    [ordered]@{ name = 'sports-576i50-tff.mkv'; available = $false; kind = '576i50-tff' },
    [ordered]@{ name = 'sports-576i50-bff.mkv'; available = $false; kind = '576i50-bff' },
    [ordered]@{ name = 'sports-1080i50-tff.mkv'; available = $false; kind = '1080i50-tff' },
    [ordered]@{ name = 'sports-1080i50-bff.mkv'; available = $false; kind = '1080i50-bff' },
    [ordered]@{ name = 'sports-576i50-wrong-bff.mkv'; available = $false; kind = 'wrong-metadata' },
    [ordered]@{ name = 'sports-1080i50-wrong-tff.mkv'; available = $false; kind = 'wrong-metadata' },
    [ordered]@{ name = 'sports-soak-720p50.mkv'; available = $false; kind = '30-minute-soak' }
)
foreach ($fixture in $fixtureDefinitions) {
    $fixture.available = Test-Path -LiteralPath (Join-Path $repositoryRoot "artifacts\m0\fixtures\$($fixture.name)") -PathType Leaf
}

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
    $versionOutput = & $runtimeConsolePath --version
    $benchmarkConfiguration = [ordered]@{
        resultSeries = 'slice7-' + [DateTime]::UtcNow.ToString('yyyyMMdd')
        slice6SeriesReused = $false
        newSeriesReason = 'sports-source-configuration-changed'
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
    }
    $availableInputs = [ordered]@{
        syntheticFixtures = $fixtureDefinitions
        legallyUsableRealSportsSourceAvailable = [bool]$LegallyUsableRealSportsSourceAvailable
        realViewingNotes = 'unobserved'
    }

    $results = @()
    if ($Mode -in @('All', 'Progressive')) {
        $results += Invoke-CoaxSportsRun -RunName 'progressive-720p50' -FixtureName 'sports-720p50.mkv' -ExpectedFps 50 -DurationSeconds 55 -WarmupSeconds 10 -ContentFieldOrder 'progressive' -MetadataFieldOrder 'progressive' -FieldOrderOverride 'auto' -VisualPrompt 'Observe smooth expected 50 fps progressive motion with no persistent judder.' -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
        $results += Invoke-CoaxSportsRun -RunName 'progressive-720p5994' -FixtureName 'sports-720p5994.mkv' -ExpectedFps (60000 / 1001) -DurationSeconds 55 -WarmupSeconds 10 -ContentFieldOrder 'progressive' -MetadataFieldOrder 'progressive' -FieldOrderOverride 'auto' -VisualPrompt 'Observe smooth expected 59.94 fps progressive motion with no persistent judder.' -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
    }
    if ($Mode -in @('All', 'Interlaced')) {
        foreach ($definition in @(
            [ordered]@{ run = '576i50-tff'; fixture = 'sports-576i50-tff.mkv'; order = 'tff' },
            [ordered]@{ run = '576i50-bff'; fixture = 'sports-576i50-bff.mkv'; order = 'bff' },
            [ordered]@{ run = '1080i50-tff'; fixture = 'sports-1080i50-tff.mkv'; order = 'tff' },
            [ordered]@{ run = '1080i50-bff'; fixture = 'sports-1080i50-bff.mkv'; order = 'bff' }
        )) {
            $results += Invoke-CoaxSportsRun -RunName $definition.run -FixtureName $definition.fixture -ExpectedFps 50 -DurationSeconds 55 -WarmupSeconds 10 -ContentFieldOrder $definition.order -MetadataFieldOrder $definition.order -FieldOrderOverride 'auto' -VisualPrompt "Observe stable field-rate motion for $($definition.run) with no persistent combing or judder." -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
        }
    }
    if ($Mode -in @('All', 'WrongFieldOrder')) {
        foreach ($definition in @(
            [ordered]@{ prefix = '576i50-wrong-bff'; fixture = 'sports-576i50-wrong-bff.mkv'; content = 'tff'; metadata = 'bff' },
            [ordered]@{ prefix = '1080i50-wrong-tff'; fixture = 'sports-1080i50-wrong-tff.mkv'; content = 'bff'; metadata = 'tff' }
        )) {
            $results += Invoke-CoaxSportsRun -RunName "$($definition.prefix)-auto" -FixtureName $definition.fixture -ExpectedFps 50 -DurationSeconds 55 -WarmupSeconds 10 -ContentFieldOrder $definition.content -MetadataFieldOrder $definition.metadata -FieldOrderOverride 'auto' -VisualPrompt "Confirm that the intentionally wrong $($definition.metadata) metadata is visually diagnosable." -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
            $results += Invoke-CoaxSportsRun -RunName "$($definition.prefix)-override" -FixtureName $definition.fixture -ExpectedFps 50 -DurationSeconds 55 -WarmupSeconds 10 -ContentFieldOrder $definition.content -MetadataFieldOrder $definition.metadata -FieldOrderOverride $definition.content -VisualPrompt "Confirm that the explicit $($definition.content) override restores stable motion without persistent combing or judder." -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
        }
    }
    if ($Mode -in @('All', 'Fallback')) {
        $results += Invoke-CoaxSportsRun -RunName 'forced-fallback' -FixtureName 'sports-576i50-tff.mkv' -ExpectedFps 50 -DurationSeconds 55 -WarmupSeconds 10 -ContentFieldOrder 'tff' -MetadataFieldOrder 'tff' -FieldOrderOverride 'auto' -VisualPrompt 'Confirm playback remains visible and moving after the forced hardware-deinterlacing failure.' -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath -ForceDeinterlaceFailure
    }
    if ($Mode -in @('All', 'Soak')) {
        $results += Invoke-CoaxSportsRun -RunName 'thirty-minute-sports-soak' -FixtureName 'sports-soak-720p50.mkv' -ExpectedFps 50 -DurationSeconds 1845 -WarmupSeconds 30 -ContentFieldOrder 'progressive' -MetadataFieldOrder 'progressive' -FieldOrderOverride 'auto' -VisualPrompt 'Optional: confirm progressive motion is visually smooth at the start of the 30-minute controlled soak.' -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
    }

    $result = [ordered]@{
        schemaVersion = 1
        runId = $script:runId
        mode = $Mode
        benchmarkConfiguration = $benchmarkConfiguration
        availableInputs = $availableInputs
        visualChecksSkipped = [bool]$SkipVisualChecks
        results = $results
    }
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runDirectory 'acceptance.json') -Encoding UTF8
    Write-Host "Slice 7 native run completed. Raw evidence remains under the ignored native artifact tree." -ForegroundColor Green
} finally {
    Pop-Location
}
