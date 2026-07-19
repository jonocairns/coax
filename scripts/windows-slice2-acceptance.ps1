[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [int]$PlaybackTimeoutSeconds = 60,
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

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$inputPath = Join-Path $repositoryRoot 'config\local\playback.json'
$examplePath = Join-Path $repositoryRoot 'config\local\playback.example.json'
$runtimeDirectory = Join-Path $repositoryRoot 'runtime\mpv\bin\windows-x64'
$mpvPath = Join-Path $runtimeDirectory 'mpv.exe'

if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
    Write-Host 'Slice 2 needs a private, ignored playback input.' -ForegroundColor Yellow
    Write-Host "Copy $examplePath to $inputPath and replace streamUrl locally."
    Write-Host 'Schema: { "streamUrl": "https://private.example/playlist" }'
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
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'fetch-mpv-runtime.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw "mpv fetch/verify failed with exit code $LASTEXITCODE."
    }

    if (-not $SkipInstall) {
        & corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            throw "Frozen dependency install failed with exit code $LASTEXITCODE."
        }
    }

    $runId = 'slice2-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $runDirectory = Join-Path $repositoryRoot "artifacts\m0\$runId"
    New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'runtime\mpv\windows-x64.json') -Destination (Join-Path $runDirectory 'runtime-manifest.json')

    $previousRunId = $env:COAX_M0_RUN_ID
    $env:COAX_M0_RUN_ID = $runId
    $standardOutput = Join-Path $runDirectory 'electron-vite.stdout.txt'
    $standardError = Join-Path $runDirectory 'electron-vite.stderr.txt'
    try {
        $corepack = (Get-Command corepack).Source
        $devProcess = Start-Process -FilePath $corepack -ArgumentList @('pnpm', 'dev') -PassThru -RedirectStandardOutput $standardOutput -RedirectStandardError $standardError
    } finally {
        $env:COAX_M0_RUN_ID = $previousRunId
    }

    $logPath = Join-Path $runDirectory 'slice2-events.jsonl'
    $requiredPlaybackEvents = @('start-file', 'file-loaded', 'playback-restart', 'video-reconfig', 'audio-reconfig')
    Wait-Until -TimeoutSeconds $PlaybackTimeoutSeconds -FailureMessage 'Timed out waiting for all required playback events.' -Condition {
        $recorded = Get-RecordedEvents $logPath
        $seen = @($recorded | Where-Object { $_.event -eq 'mpv-event' } | ForEach-Object { $_.mpvEvent })
        @($requiredPlaybackEvents | Where-Object { $_ -notin $seen }).Count -eq 0
    }

    $mpvProcess = Get-CimInstance Win32_Process -Filter "Name = 'mpv.exe'" |
        Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -eq [System.IO.Path]::GetFullPath($mpvPath)) } |
        Select-Object -First 1
    if ($null -eq $mpvProcess) {
        throw 'The running mpv process is not the verified bundled executable.'
    }

    $commandLine = [string]$mpvProcess.CommandLine
    $pipeMatch = [regex]::Match($commandLine, '--input-ipc-server=(\\\\\.\\pipe\\[^\s"]+)')
    if (-not $pipeMatch.Success) {
        throw 'Could not identify the private mpv IPC pipe in the process command line.'
    }
    $pipePath = $pipeMatch.Groups[1].Value
    $argumentsContainSensitiveValue = $false
    foreach ($sensitiveValue in $sensitiveValues) {
        if ($sensitiveValue.Length -ge 4 -and $commandLine.Contains($sensitiveValue)) {
            $argumentsContainSensitiveValue = $true
        }
    }

    $visualConfirmation = (Read-Host 'Use Previous/Next in Coax to test playlist channels, then confirm visible video and audible audio by typing YES') -eq 'YES'
    if (-not $visualConfirmation) {
        throw 'Visible video and audible audio were not confirmed.'
    }
    Read-Host 'Close the Coax Electron window, then press Enter'

    Wait-Until -TimeoutSeconds $ShutdownTimeoutSeconds -FailureMessage 'Electron did not close within the shutdown timeout.' -Condition {
        $devProcess.Refresh()
        $devProcess.HasExited
    }
    Wait-Until -TimeoutSeconds $ShutdownTimeoutSeconds -FailureMessage 'The owned mpv process remained after Electron closed.' -Condition {
        $null -eq (Get-Process -Id $mpvProcess.ProcessId -ErrorAction SilentlyContinue)
    }

    $events = Get-RecordedEvents $logPath
    $seenEvents = @($events | Where-Object { $_.event -eq 'mpv-event' } | ForEach-Object { $_.mpvEvent })
    $requiredAllEvents = @($requiredPlaybackEvents + 'end-file')
    $missingEvents = @($requiredAllEvents | Where-Object { $_ -notin $seenEvents })
    $processExitCaptured = @($events | Where-Object { $_.event -eq 'mpv-process-exit' }).Count -gt 0
    $orphanChecks = @($events | Where-Object { $_.event -eq 'mpv-orphan-check' })
    $lastOrphanCheck = $orphanChecks | Select-Object -Last 1
    $logText = Get-Content -LiteralPath $logPath -Raw
    $logContainsSensitiveValue = $false
    foreach ($sensitiveValue in $sensitiveValues) {
        if ($sensitiveValue.Length -ge 4 -and $logText.Contains($sensitiveValue)) {
            $logContainsSensitiveValue = $true
        }
    }
    $pipeReachable = Test-NamedPipeReachable $pipePath

    $result = [ordered]@{
        schemaVersion = 1
        runId = $runId
        verifiedBundledExecutable = $true
        visibleVideoAndAudibleAudio = $visualConfirmation
        requiredEventsCaptured = ($missingEvents.Count -eq 0 -and $processExitCaptured)
        missingEvents = $missingEvents
        processExitCaptured = $processExitCaptured
        streamOrCredentialInProcessArguments = $argumentsContainSensitiveValue
        streamOrCredentialInPersistedLog = $logContainsSensitiveValue
        mpvProcessAliveAfterElectron = $false
        namedPipeReachableAfterElectron = $pipeReachable
        applicationOrphanCheckPassed = ($null -ne $lastOrphanCheck -and -not $lastOrphanCheck.processAlive -and -not $lastOrphanCheck.pipeReachable)
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDirectory 'acceptance.json') -Encoding UTF8

    if (-not $result.requiredEventsCaptured -or $result.streamOrCredentialInProcessArguments -or $result.streamOrCredentialInPersistedLog -or $result.namedPipeReachableAfterElectron -or -not $result.applicationOrphanCheckPassed) {
        throw "Slice 2 acceptance failed. Review ignored raw evidence under artifacts\m0\$runId."
    }

    Write-Host "Slice 2 native acceptance passed. Raw evidence: artifacts\m0\$runId" -ForegroundColor Green
} finally {
    if ($null -ne $devProcess) {
        $devProcess.Refresh()
        if (-not $devProcess.HasExited) {
            & taskkill.exe /pid $devProcess.Id /t /f | Out-Null
        }
    }
    Pop-Location
}
