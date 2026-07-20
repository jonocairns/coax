[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [int]$ProviderTimeoutSeconds = 45,
    [int]$PlaybackTimeoutSeconds = 90
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

function Get-Events {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
    return @(
        Get-Content -LiteralPath $Path |
            Where-Object { $_.Length -gt 0 } |
            ForEach-Object { $_ | ConvertFrom-Json }
    )
}

function Confirm-Observed {
    param([Parameter(Mandatory = $true)][string]$Prompt)
    $response = Read-Host "$Prompt Type YES only after observing the result"
    if ($response -ne 'YES') { throw "Native observation was not confirmed: $Prompt" }
    return $true
}

function Get-LeafStrings {
    param([Parameter(Mandatory = $true)]$Value)
    $values = New-Object System.Collections.Generic.List[string]
    if ($Value -is [string]) {
        if ($Value.Length -ge 4) { $values.Add($Value) }
    } elseif ($Value -is [System.Collections.IDictionary] -or $Value -is [PSCustomObject]) {
        foreach ($property in $Value.PSObject.Properties) {
            foreach ($item in @(Get-LeafStrings $property.Value)) { $values.Add($item) }
        }
    } elseif ($Value -is [System.Collections.IEnumerable]) {
        foreach ($entry in $Value) {
            foreach ($item in @(Get-LeafStrings $entry)) { $values.Add($item) }
        }
    }
    return $values.ToArray()
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$inputPath = Join-Path $repositoryRoot 'config\local\xtream.json'
$runtimePath = Join-Path $repositoryRoot 'runtime\mpv\bin\windows-x64\mpv.exe'
$runId = 'slice5-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runDirectory = Join-Path $repositoryRoot "artifacts\m0\$runId"
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null

$credentialsAvailable = Test-Path -LiteralPath $inputPath -PathType Leaf
Write-Host "Private Xtream credentials available: $credentialsAvailable" -ForegroundColor Cyan
if (-not $credentialsAvailable) {
    $unobserved = [ordered]@{
        schemaVersion = 1
        runId = $runId
        status = 'unobserved'
        credentialsAvailable = $false
        tsSampleAvailable = $false
        hlsSampleAvailable = $false
        reason = 'ignored Xtream development input was not available at run start'
        nativeProviderGatePassed = $false
    }
    $unobserved | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runDirectory 'acceptance.json') -Encoding UTF8
    Write-Host 'Native provider, MPEG-TS, and HLS rows remain unobserved. No credential value was read or recorded.' -ForegroundColor Yellow
    exit 0
}

$input = Get-Content -LiteralPath $inputPath -Raw | ConvertFrom-Json
if ($input.baseUrl -notmatch '^https?://' -or -not $input.username -or -not $input.password) {
    throw 'The ignored Xtream input does not match the required local schema.'
}
$sensitiveValues = @(Get-LeafStrings $input | Sort-Object -Unique)
$configuredFormats = @($input.outputFormats)
Write-Host "Configured TS candidate: $($configuredFormats -contains 'ts')"
Write-Host "Configured HLS candidate: $($configuredFormats -contains 'm3u8')"

if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
    throw 'The existing pinned Windows mpv runtime is missing. Run fetch-mpv-runtime.ps1 without replacing the manifest.'
}

Push-Location $repositoryRoot
$devProcess = $null
try {
    if (-not $SkipInstall) {
        & corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "Frozen dependency install failed with exit code $LASTEXITCODE." }
    }
    $previousRunId = $env:COAX_M0_RUN_ID
    $env:COAX_M0_RUN_ID = $runId
    try {
        $corepack = (Get-Command corepack).Source
        $devProcess = Start-Process -FilePath $corepack -ArgumentList @('pnpm', 'dev') -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'electron-vite.stdout.txt') -RedirectStandardError (Join-Path $runDirectory 'electron-vite.stderr.txt')
    } finally {
        $env:COAX_M0_RUN_ID = $previousRunId
    }

    $logPath = Join-Path $runDirectory 'playback-events.jsonl'
    Wait-Until -TimeoutSeconds $ProviderTimeoutSeconds -FailureMessage 'Timed out waiting for the provider result.' -Condition {
        $events = Get-Events $logPath
        @($events | Where-Object { $_.event -in @('provider-catalog-loaded', 'provider-catalog-failed') }).Count -gt 0
    }
    $events = Get-Events $logPath
    $catalogFailure = $events | Where-Object { $_.event -eq 'provider-catalog-failed' } | Select-Object -Last 1
    if ($null -ne $catalogFailure) {
        throw "Provider initialization stopped with sanitized kind '$($catalogFailure.failureKind)' and reason '$($catalogFailure.reason)'."
    }
    $catalog = $events | Where-Object { $_.event -eq 'provider-catalog-loaded' } | Select-Object -Last 1
    $tsAvailable = $catalog.mpegTsVariants -gt 0
    $hlsAvailable = $catalog.hlsVariants -gt 0
    Write-Host "Provider MPEG-TS sample available: $tsAvailable"
    Write-Host "Provider HLS sample available: $hlsAvailable"

    $tsObserved = $null
    $hlsObserved = $null
    if ($tsAvailable) {
        $tsObserved = Confirm-Observed 'Select an MPEG-TS-labelled channel in Coax and confirm visible video plus audible audio.'
    }
    if ($hlsAvailable) {
        $hlsObserved = Confirm-Observed 'Select an HLS-labelled channel in Coax and confirm visible video plus audible audio.'
    }
    $tsSatisfied = -not $tsAvailable -or $tsObserved
    $hlsSatisfied = -not $hlsAvailable -or $hlsObserved
    $requiredTransports = @()
    if ($tsAvailable) { $requiredTransports += 'mpeg-ts' }
    if ($hlsAvailable) { $requiredTransports += 'hls' }
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Required provider playback-restart events were not observed.' -Condition {
        $observed = Get-Events $logPath
        foreach ($transport in $requiredTransports) {
            $requests = @($observed | Where-Object { $_.event -eq 'provider-channel-requested' -and $_.transport -eq $transport })
            $restarts = @($observed | Where-Object { $_.event -eq 'mpv-event' -and $_.mpvEvent -eq 'playback-restart' })
            if (@($requests | Where-Object { $_.generation -in $restarts.generation }).Count -eq 0) { return $false }
        }
        return $true
    }

    $beforeRapid = @(Get-Events $logPath | Where-Object { $_.event -eq 'provider-channel-requested' }).Count
    $rapidObserved = Confirm-Observed 'Run “30 channel-ID changes” in Coax, confirm immediate feedback and that the newest request plays.'
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Thirty channel-ID requests were not observed.' -Condition {
        @(Get-Events $logPath | Where-Object { $_.event -eq 'provider-channel-requested' }).Count -ge ($beforeRapid + 30)
    }
    $rapid = @(Get-Events $logPath | Where-Object { $_.event -eq 'provider-channel-requested' } | Select-Object -Last 30)
    $finalGeneration = [int]($rapid | Select-Object -Last 1).generation
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Newest provider generation was not asserted current.' -Condition {
        @(Get-Events $logPath | Where-Object { $_.event -eq 'mpv-generation-current' -and $_.generation -eq $finalGeneration }).Count -gt 0
    }

    $mpvProcess = Get-CimInstance Win32_Process -Filter "Name = 'mpv.exe'" |
        Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -eq [System.IO.Path]::GetFullPath($runtimePath)) } |
        Select-Object -First 1
    if ($null -eq $mpvProcess) { throw 'The verified bundled mpv process was not running.' }
    $argumentsContainSensitive = $false
    $mpvCommandLine = [string]$mpvProcess.CommandLine
    foreach ($value in $sensitiveValues) {
        if ($mpvCommandLine.Contains($value)) { $argumentsContainSensitive = $true }
    }

    Read-Host 'Close the Coax window, then press Enter'
    Wait-Until -TimeoutSeconds 30 -FailureMessage 'Coax did not close cleanly.' -Condition {
        $devProcess.Refresh()
        $devProcess.HasExited
    }

    $events = Get-Events $logPath
    $logText = Get-Content -LiteralPath $logPath -Raw
    $logContainsSensitive = $false
    foreach ($value in $sensitiveValues) {
        if ($logText.Contains($value)) { $logContainsSensitive = $true }
    }
    $timings = @()
    foreach ($request in @($events | Where-Object { $_.event -eq 'provider-channel-requested' })) {
        $restart = $events | Where-Object { $_.event -eq 'mpv-event' -and $_.mpvEvent -eq 'playback-restart' -and $_.generation -eq $request.generation } | Select-Object -First 1
        if ($null -ne $restart) {
            $timings += [ordered]@{
                transport = $request.transport
                startupMs = [Math]::Round(([double]$restart.elapsedMs - [double]$request.elapsedMs), 1)
            }
        }
    }
    $result = [ordered]@{
        schemaVersion = 1
        runId = $runId
        status = 'observed'
        credentialsAvailable = $true
        categoriesNormalized = $catalog.categoriesNormalized
        categoriesSkipped = $catalog.categoriesSkipped
        channelsNormalized = $catalog.channelsNormalized
        channelsSkipped = $catalog.channelsSkipped
        tsSampleAvailable = $tsAvailable
        hlsSampleAvailable = $hlsAvailable
        tsPlaybackObserved = $tsObserved
        hlsPlaybackObserved = $hlsObserved
        startupTimings = $timings
        rapidRequestCount = $rapid.Count
        finalRequestedGeneration = $finalGeneration
        finalGenerationAsserted = $true
        credentialOrUrlInProcessArguments = $argumentsContainSensitive
        credentialOrUrlInPersistedLog = $logContainsSensitive
        nativeProviderGatePassed = $tsSatisfied -and $hlsSatisfied -and $rapidObserved -and -not $argumentsContainSensitive -and -not $logContainsSensitive -and $rapid.Count -eq 30
    }
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runDirectory 'acceptance.json') -Encoding UTF8
    if (-not $result.nativeProviderGatePassed) { throw 'Slice 5 native provider acceptance failed. Review ignored raw artifacts.' }
    Write-Host "Slice 5 available native provider rows passed. Raw evidence: artifacts\m0\$runId" -ForegroundColor Green
} finally {
    if ($null -ne $devProcess) {
        $devProcess.Refresh()
        if (-not $devProcess.HasExited) { & taskkill.exe /pid $devProcess.Id /t /f | Out-Null }
    }
    Pop-Location
}
