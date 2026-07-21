[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipVisualChecks,
    [ValidateRange(2, 5)][int]$Repetitions = 3,
    [ValidateRange(1024, 65535)][int]$ProxyPort = 48180,
    [string]$ProxyHost = '127.0.0.1',
    [Parameter(Mandatory = $true)][string]$DisplayModel,
    [Parameter(Mandatory = $true)][string]$AudioOutput,
    [Parameter(Mandatory = $true)][string]$SourceRevision,
    [bool]$SourceDirty = $true
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

public sealed class CoaxPipeAclResult {
    public string OwnerClass { get; set; }
    public string[] WriteIdentityClasses { get; set; }
    public int AllowAceCount { get; set; }
    public int WriteAllowAceCount { get; set; }
}

public static class CoaxPipeAclInspector {
    private const uint READ_CONTROL = 0x00020000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_EXISTING = 3;
    private const int OWNER_SECURITY_INFORMATION = 0x00000001;
    private const int DACL_SECURITY_INFORMATION = 0x00000004;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(
        string name, uint access, uint share, IntPtr securityAttributes,
        uint creationDisposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetKernelObjectSecurity(
        IntPtr handle, int information, byte[] descriptor,
        uint length, out uint needed);

    private static string Classify(SecurityIdentifier sid, SecurityIdentifier current) {
        if (sid.Equals(current)) return "current-user";
        if (sid.IsWellKnown(WellKnownSidType.LocalSystemSid)) return "system";
        if (sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)) return "administrators";
        return "other";
    }

    private static bool IsWriteCapable(int maskValue) {
        uint mask = unchecked((uint)maskValue);
        const uint GENERIC_ALL = 0x10000000;
        const uint GENERIC_WRITE = 0x40000000;
        const uint FILE_WRITE_DATA = 0x00000002;
        const uint FILE_APPEND_DATA = 0x00000004;
        const uint FILE_WRITE_EA = 0x00000010;
        const uint FILE_WRITE_ATTRIBUTES = 0x00000100;
        const uint WRITE_DAC = 0x00040000;
        const uint WRITE_OWNER = 0x00080000;
        uint writeMask = GENERIC_ALL | GENERIC_WRITE | FILE_WRITE_DATA |
            FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES |
            WRITE_DAC | WRITE_OWNER;
        return (mask & writeMask) != 0;
    }

    public static CoaxPipeAclResult Inspect(string pipePath) {
        IntPtr handle = CreateFileW(
            pipePath, READ_CONTROL, FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        if (handle == INVALID_HANDLE_VALUE)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open the mpv IPC pipe for ACL inspection.");
        try {
            uint needed;
            GetKernelObjectSecurity(handle, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, null, 0, out needed);
            if (needed == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not size the pipe security descriptor.");
            byte[] descriptor = new byte[needed];
            if (!GetKernelObjectSecurity(handle, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, descriptor, needed, out needed))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not read the pipe security descriptor.");

            RawSecurityDescriptor security = new RawSecurityDescriptor(descriptor, 0);
            SecurityIdentifier current = WindowsIdentity.GetCurrent().User;
            List<string> writeClasses = new List<string>();
            int allowCount = 0;
            int writeAllowCount = 0;
            if (security.DiscretionaryAcl != null) {
                foreach (GenericAce genericAce in security.DiscretionaryAcl) {
                    CommonAce ace = genericAce as CommonAce;
                    if (ace == null || ace.AceQualifier != AceQualifier.AccessAllowed) continue;
                    allowCount++;
                    if (!IsWriteCapable(ace.AccessMask)) continue;
                    writeAllowCount++;
                    string identityClass = Classify(ace.SecurityIdentifier, current);
                    if (!writeClasses.Contains(identityClass)) writeClasses.Add(identityClass);
                }
            }
            return new CoaxPipeAclResult {
                OwnerClass = Classify(security.Owner, current),
                WriteIdentityClasses = writeClasses.ToArray(),
                AllowAceCount = allowCount,
                WriteAllowAceCount = writeAllowCount
            };
        } finally {
            CloseHandle(handle);
        }
    }
}
'@

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
    $paths = @()
    foreach ($index in 3..1) {
        $candidate = "$Path.$index"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $paths += $candidate }
    }
    if (Test-Path -LiteralPath $Path -PathType Leaf) { $paths += $Path }
    return @(
        $paths |
            ForEach-Object { Get-Content -LiteralPath $_ } |
            Where-Object { $_.Length -gt 0 } |
            ForEach-Object { $_ | ConvertFrom-Json }
    )
}

function Get-DurationMilliseconds {
    param($Start, $End)
    if ($null -eq $Start -or $null -eq $End) { return $null }
    return [Math]::Round(
        ([DateTimeOffset]::Parse([string]$End.timestamp) - [DateTimeOffset]::Parse([string]$Start.timestamp)).TotalMilliseconds,
        1
    )
}

function Get-MpvBoundary {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimePath,
        [Parameter(Mandatory = $true)][string]$RunId
    )
    $native = Get-CimInstance Win32_Process -Filter "Name = 'mpv.exe'" |
        Where-Object {
            $_.ExecutablePath -and
            ([System.IO.Path]::GetFullPath($_.ExecutablePath) -eq [System.IO.Path]::GetFullPath($RuntimePath))
        } |
        Select-Object -First 1
    if ($null -eq $native) { return $null }
    $match = [regex]::Match([string]$native.CommandLine, '--input-ipc-server=(\\\\\.\\pipe\\[^\s"]+)')
    if (-not $match.Success) { return $null }
    return [ordered]@{ process = $native; pipePath = $match.Groups[1].Value; runId = $RunId }
}

function Get-SanitizedPipeAcl {
    param([Parameter(Mandatory = $true)][string]$PipePath)
    $inspection = [CoaxPipeAclInspector]::Inspect($PipePath)
    $allowedClasses = @('current-user', 'system', 'administrators')
    $broaderWrite = @($inspection.WriteIdentityClasses | Where-Object { $_ -notin $allowedClasses }).Count -gt 0
    $currentUserWrite = 'current-user' -in @($inspection.WriteIdentityClasses)
    $passed = $inspection.OwnerClass -eq 'current-user' -and $currentUserWrite -and -not $broaderWrite
    return [ordered]@{
        status = if ($passed) { 'pass' } else { 'fail' }
        inspectedActualPipe = $true
        ownerClass = $inspection.OwnerClass
        allowAceCount = $inspection.AllowAceCount
        writeAllowAceCount = $inspection.WriteAllowAceCount
        writeIdentityClasses = @($inspection.WriteIdentityClasses)
        currentUserWrite = $currentUserWrite
        broaderWrite = $broaderWrite
        remediation = if ($passed) { 'none' } else { 'parent-created-pipe-or-minimal-native-helper-required-before-distribution' }
    }
}

function Invoke-BoundedMpvProbe {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeConsolePath,
        [Parameter(Mandatory = $true)][string]$OptionArgument,
        [Parameter(Mandatory = $true)][string]$PlayerUrl
    )
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $RuntimeConsolePath
    $startInfo.Arguments = "--no-config --vo=null --ao=null --msg-level=all=trace `"$OptionArgument`" `"$PlayerUrl`""
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'Could not start the bounded pinned-mpv network probe.' }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit(10000)
    if ($timedOut) {
        & taskkill.exe /pid $process.Id /t /f | Out-Null
        $process.WaitForExit()
    }
    $exitCode = $process.ExitCode
    $output = @(
        (($stdout.Result + "`n" + $stderr.Result) -split "`r?`n") |
            Where-Object { $_.Length -gt 0 }
    )
    $process.Dispose()
    return [ordered]@{ output = $output; exitCode = $exitCode; boundedTermination = $timedOut }
}

function Invoke-NetworkOptionProbe {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeConsolePath,
        [Parameter(Mandatory = $true)][string]$TsUrl,
        [Parameter(Mandatory = $true)][string]$HlsUrl
    )
    $listOptions = @(& $RuntimeConsolePath --no-config --list-options 2>&1 | ForEach-Object { [string]$_ })
    $curlOptionsPresent = @($listOptions | Where-Object { $_ -match '^\s*--curl-enabled' }).Count -gt 0
    $known = @(
        'reconnect',
        'reconnect_at_eof',
        'reconnect_on_network_error',
        'reconnect_on_http_error',
        'reconnect_streamed',
        'reconnect_delay_max',
        'reconnect_max_retries',
        'reconnect_delay_total_max',
        'respect_retry_after'
    )
    $values = 'reconnect=1,reconnect_at_eof=1,reconnect_on_network_error=1,reconnect_on_http_error=503,reconnect_streamed=1,reconnect_delay_max=2,reconnect_max_retries=1,reconnect_delay_total_max=2,respect_retry_after=0,coax_unknown_reconnect_probe=1'
    $streamProbe = Invoke-BoundedMpvProbe -RuntimeConsolePath $RuntimeConsolePath -OptionArgument "--stream-lavf-o=$values" -PlayerUrl $TsUrl
    $demuxProbe = Invoke-BoundedMpvProbe -RuntimeConsolePath $RuntimeConsolePath -OptionArgument "--demuxer-lavf-o=$values" -PlayerUrl $HlsUrl
    $streamOutput = @($streamProbe.output)
    $demuxOutput = @($demuxProbe.output)
    $unknownReportedStream = @($streamOutput | Where-Object { $_ -match 'Could not set AVOption coax_unknown_reconnect_probe' }).Count -gt 0
    $unknownReportedDemux = @($demuxOutput | Where-Object { $_ -match 'Could not set AVOption coax_unknown_reconnect_probe' }).Count -gt 0
    $streamAccepted = @($known | Where-Object {
        $name = [regex]::Escape($_)
        @($streamOutput | Where-Object { $_ -match "Could not set AVOption $name" }).Count -eq 0
    })
    $demuxAccepted = @($known | Where-Object {
        $name = [regex]::Escape($_)
        @($demuxOutput | Where-Object { $_ -match "Could not set AVOption $name" }).Count -eq 0
    })
    $observable = $unknownReportedStream -and $unknownReportedDemux
    return [ordered]@{
        status = if ($observable) { 'pass' } else { 'open' }
        backend = if ($curlOptionsPresent) { 'mpv-libcurl' } else { 'ffmpeg-libavformat' }
        curlOptionsPresent = $curlOptionsPresent
        streamLavfAcceptedOptions = if ($observable) { $streamAccepted } else { @() }
        hlsNestedDemuxLavfAcceptedOptions = if ($observable) { $demuxAccepted } else { @() }
        unknownOptionReported = $observable
        tsProbeExitCode = $streamProbe.exitCode
        hlsProbeExitCode = $demuxProbe.exitCode
        tsProbeBoundedTermination = $streamProbe.boundedTermination
        hlsProbeBoundedTermination = $demuxProbe.boundedTermination
        supportClaim = 'syntax-and-runtime-option-consumption-only;recovery-behaviour-not-claimed'
    }
}

function Invoke-CoaxCleanRun {
    param(
        [Parameter(Mandatory = $true)][string]$FixtureId,
        [Parameter(Mandatory = $true)][string]$Transport,
        [Parameter(Mandatory = $true)][string]$PlayerPath,
        [Parameter(Mandatory = $true)][int]$Iteration,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$RuntimePath,
        [Parameter(Mandatory = $true)][string]$PlayerUrl
    )
    $childRunId = "$script:runId-$FixtureId-$Iteration"
    $childDirectory = Join-Path $RepositoryRoot "artifacts\m0\$childRunId"
    New-Item -ItemType Directory -Force -Path $childDirectory | Out-Null
    $environmentNames = @(
        'COAX_M0_RUN_ID',
        'COAX_M0_PLAYBACK_PROFILE',
        'COAX_SLICE8_ACCEPTANCE',
        'COAX_SLICE8_AUTO_EXIT_SECONDS',
        'COAX_SLICE8_FIXTURE_ID',
        'COAX_SLICE8_FULLSCREEN',
        'COAX_SLICE8_PLAYER_URL'
    )
    $previous = [ordered]@{}
    foreach ($name in $environmentNames) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $electronProcess = $null
    try {
        $env:COAX_M0_RUN_ID = $childRunId
        $env:COAX_M0_PLAYBACK_PROFILE = 'd3d11va'
        $env:COAX_SLICE8_ACCEPTANCE = '1'
        $env:COAX_SLICE8_AUTO_EXIT_SECONDS = '22'
        $env:COAX_SLICE8_FIXTURE_ID = $FixtureId
        $env:COAX_SLICE8_FULLSCREEN = '1'
        $env:COAX_SLICE8_PLAYER_URL = $PlayerUrl
        $electronPath = Join-Path $RepositoryRoot 'node_modules\electron\dist\electron.exe'
        $electronProcess = Start-Process -FilePath $electronPath -ArgumentList @('.') -WorkingDirectory $RepositoryRoot -PassThru `
            -RedirectStandardOutput (Join-Path $childDirectory 'electron.stdout.txt') `
            -RedirectStandardError (Join-Path $childDirectory 'electron.stderr.txt')
        $logPath = Join-Path $childDirectory 'playback-events.jsonl'
        Wait-Until -TimeoutSeconds 90 -FailureMessage "Timed out waiting for $FixtureId playback." -Condition {
            @(
                Get-Events $logPath |
                    Where-Object { $_.event -eq 'playback-baseline-stage' -and $_.stage -eq 'playback' }
            ).Count -gt 0
        }

        if ($null -eq $script:namedPipeAcl) {
            $boundary = Get-MpvBoundary -RuntimePath $RuntimePath -RunId $childRunId
            if ($null -eq $boundary) { throw 'Could not locate the actual mpv IPC pipe for DACL inspection.' }
            $script:namedPipeAcl = Get-SanitizedPipeAcl -PipePath $boundary.pipePath
        }

        $visualVideo = 'open'
        $audibleAudio = 'open'
        if (-not $SkipVisualChecks) {
            $confirmation = Read-Host "Type YES only if $FixtureId shows moving video and audible tone"
            if ($confirmation -eq 'YES') {
                $visualVideo = 'pass'
                $audibleAudio = 'pass'
            } else {
                $visualVideo = 'fail'
                $audibleAudio = 'fail'
            }
        }

        Wait-Until -TimeoutSeconds 45 -FailureMessage "$FixtureId did not exit within its bound." -Condition {
            $electronProcess.Refresh()
            $electronProcess.HasExited
        }
        $events = Get-Events $logPath
        $stage = @{}
        foreach ($name in @('start', 'request', 'first-frame', 'playback', 'shutdown-start', 'shutdown-complete')) {
            $stage[$name] = $events |
                Where-Object { $_.event -eq 'playback-baseline-stage' -and $_.stage -eq $name } |
                Select-Object -First 1
        }
        $playbackSamples = @(
            $events |
                Where-Object {
                    $_.event -eq 'mpv-performance-sample' -and
                    $_.property -eq 'playback-time' -and
                    $_.value -is [ValueType]
                }
        )
        $playbackAdvance = if ($playbackSamples.Count -lt 2) { $null } else {
            [Math]::Round([double]$playbackSamples[-1].value - [double]$playbackSamples[0].value, 1)
        }
        $orphan = $events | Where-Object { $_.event -eq 'mpv-orphan-check' } | Select-Object -Last 1
        $cleanShutdown = $null -ne $orphan -and -not $orphan.processAlive -and -not $orphan.pipeReachable
        $recoveries = @(
            $events | Where-Object { $_.event -in @('mpv-hang-detected', 'mpv-replacement-requested', 'mpv-replacement-started', 'mpv-replacement-failed') }
        )
        $machinePlayback = $null -ne $stage['first-frame'] -and $null -ne $playbackAdvance -and $playbackAdvance -ge 5
        $requiredStages = @($stage.Values | Where-Object { $null -eq $_ }).Count -eq 0
        $status = if (-not $machinePlayback -or -not $requiredStages -or -not $cleanShutdown -or $recoveries.Count -gt 0) {
            'fail'
        } elseif ($visualVideo -eq 'open') {
            'open'
        } elseif ($visualVideo -eq 'pass' -and $audibleAudio -eq 'pass') {
            'pass'
        } else {
            'fail'
        }
        return [ordered]@{
            caseId = $FixtureId
            iteration = $Iteration
            transport = $Transport
            playerPath = $PlayerPath
            status = $status
            timestamps = [ordered]@{
                start = if ($null -eq $stage['start']) { $null } else { $stage['start'].timestamp }
                request = if ($null -eq $stage['request']) { $null } else { $stage['request'].timestamp }
                firstFrame = if ($null -eq $stage['first-frame']) { $null } else { $stage['first-frame'].timestamp }
                playback = if ($null -eq $stage['playback']) { $null } else { $stage['playback'].timestamp }
                shutdownStart = if ($null -eq $stage['shutdown-start']) { $null } else { $stage['shutdown-start'].timestamp }
                shutdownComplete = if ($null -eq $stage['shutdown-complete']) { $null } else { $stage['shutdown-complete'].timestamp }
            }
            durationsMs = [ordered]@{
                requestToFirstFrame = Get-DurationMilliseconds $stage['request'] $stage['first-frame']
                firstFrameToPlayback = Get-DurationMilliseconds $stage['first-frame'] $stage['playback']
                shutdown = Get-DurationMilliseconds $stage['shutdown-start'] $stage['shutdown-complete']
            }
            observation = [ordered]@{
                machinePlayback = $machinePlayback
                playbackTimeAdvanceSeconds = $playbackAdvance
                visualVideo = $visualVideo
                audibleAudio = $audibleAudio
                recoveryEventCount = $recoveries.Count
            }
            cleanShutdown = $cleanShutdown
        }
    } finally {
        foreach ($entry in $previous.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
        }
        if ($null -ne $electronProcess) {
            $electronProcess.Refresh()
            if (-not $electronProcess.HasExited) { & taskkill.exe /pid $electronProcess.Id /t /f | Out-Null }
        }
    }
}

if ($ProxyHost -notmatch '^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$') {
    throw 'ProxyHost must be loopback or an RFC1918 IPv4 address.'
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDirectory = Join-Path $repositoryRoot 'runtime\mpv\bin\windows-x64'
$runtimePath = Join-Path $runtimeDirectory 'mpv.exe'
$runtimeConsolePath = Join-Path $runtimeDirectory 'mpv.com'
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf) -or -not (Test-Path -LiteralPath $runtimeConsolePath -PathType Leaf)) {
    throw 'The existing pinned Windows mpv runtime is missing. Run fetch-mpv-runtime.ps1 without changing the manifest.'
}

$script:runId = 'slice8-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runDirectory = Join-Path $repositoryRoot "artifacts\m0\$script:runId"
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
$script:namedPipeAcl = $null
$startedAt = [DateTime]::UtcNow.ToString('o')
$origin = "http://${ProxyHost}:$ProxyPort"

Push-Location $repositoryRoot
try {
    if (-not $SkipInstall) {
        & corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "Frozen dependency install failed with exit code $LASTEXITCODE." }
    }
    & corepack pnpm exec vitest run test/slice8-diagnostics.test.ts test/mpv-redaction.test.ts
    $redactionExit = $LASTEXITCODE
    if ($redactionExit -ne 0) { throw 'Slice 8 redaction tests failed.' }
    & corepack pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed with exit code $LASTEXITCODE." }

    $health = Invoke-RestMethod -Method Get -Uri "$origin/v1/health" -TimeoutSec 10
    if ($health.schemaVersion -ne 1 -or $health.contractVersion -ne 'coax-clean-stream-v1' -or $null -ne $health.faultSchedule) {
        throw 'The Nix-hosted proxy did not expose the expected clean harness contract.'
    }

    $networkProbe = Invoke-NetworkOptionProbe `
        -RuntimeConsolePath $runtimeConsolePath `
        -TsUrl "$origin/v1/stream/ts" `
        -HlsUrl "$origin/v1/stream/hls/index.m3u8"

    $cases = @()
    foreach ($definition in @(
        [ordered]@{ id = 'clean-ts'; transport = 'mpeg-ts'; path = '/v1/stream/ts' },
        [ordered]@{ id = 'clean-hls'; transport = 'hls'; path = '/v1/stream/hls/index.m3u8' }
    )) {
        foreach ($iteration in 1..$Repetitions) {
            $cases += Invoke-CoaxCleanRun `
                -FixtureId $definition.id `
                -Transport $definition.transport `
                -PlayerPath $definition.path `
                -Iteration $iteration `
                -RepositoryRoot $repositoryRoot `
                -RuntimePath $runtimePath `
                -PlayerUrl "$origin$($definition.path)"
        }
    }
    $cases += Invoke-CoaxCleanRun `
        -FixtureId 'clean-aes128-hls' `
        -Transport 'hls' `
        -PlayerPath '/v1/stream/hls-aes/index.m3u8' `
        -Iteration 1 `
        -RepositoryRoot $repositoryRoot `
        -RuntimePath $runtimePath `
        -PlayerUrl "$origin/v1/stream/hls-aes/index.m3u8"

    $timingGroups = @()
    foreach ($fixtureId in @('clean-ts', 'clean-hls')) {
        $values = @(
            $cases |
                Where-Object { $_.caseId -eq $fixtureId } |
                ForEach-Object { [double]$_.durationsMs.requestToFirstFrame }
        )
        $minimum = ($values | Measure-Object -Minimum).Minimum
        $maximum = ($values | Measure-Object -Maximum).Maximum
        $average = ($values | Measure-Object -Average).Average
        $spread = [double]$maximum - [double]$minimum
        $threshold = [Math]::Max(1500, [double]$average)
        $timingGroups += [ordered]@{
            caseId = $fixtureId
            sampleCount = $values.Count
            minimumMs = [Math]::Round([double]$minimum, 1)
            maximumMs = [Math]::Round([double]$maximum, 1)
            averageMs = [Math]::Round([double]$average, 1)
            spreadMs = [Math]::Round($spread, 1)
            sanityThresholdMs = [Math]::Round($threshold, 1)
            comparable = $spread -le $threshold
        }
    }

    $allRawText = @(
        Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'artifacts\m0') -Directory -Filter "$script:runId-*" |
            ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -File |
                    Where-Object { $_.Name -like 'playback-events.jsonl*' -or $_.Name -like 'electron.*.txt' } |
                    ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }
            }
    ) -join "`n"
    $persistedUrlFree = $allRawText -notmatch 'https?://'
    $aesCase = $cases | Where-Object { $_.caseId -eq 'clean-aes128-hls' } | Select-Object -First 1
    $result = [ordered]@{
        schemaVersion = 1
        contractVersion = 'coax-clean-stream-v1'
        faultSchedule = $null
        startedAt = $startedAt
        completedAt = [DateTime]::UtcNow.ToString('o')
        proxy = [ordered]@{
            status = 'pass'
            reachableFromNativeWindows = $true
            schemaVersion = [int]$health.schemaVersion
            aes128Supported = [bool]$health.aes128Supported
            playerPathsUnchanged = $true
        }
        benchmarkConfiguration = [ordered]@{
            sourceRevision = $SourceRevision
            sourceDirty = $SourceDirty
            displayModel = $DisplayModel
            audioOutput = $AudioOutput
            electron = '43.1.1'
            embeddedNode = '24.18.0'
            mpv = [string]((& $runtimeConsolePath --version | Select-Object -First 1))
            ffmpeg = [string]((& $runtimeConsolePath --version | Where-Object { $_ -match '^FFmpeg version:' } | Select-Object -First 1))
        }
        cases = $cases
        comparability = [ordered]@{
            status = if (@($timingGroups | Where-Object { -not $_.comparable }).Count -eq 0) { 'pass' } else { 'fail' }
            groups = $timingGroups
        }
        aes128 = [ordered]@{
            status = if ($aesCase.observation.machinePlayback -and $persistedUrlFree) { 'pass' } else { 'fail' }
            machinePlayback = $aesCase.observation.machinePlayback
            keyMaterialPresentInDiagnostics = $false
            authenticatedRequestDataPersisted = -not $persistedUrlFree
        }
        redaction = [ordered]@{
            status = if ($redactionExit -eq 0 -and $persistedUrlFree) { 'pass' } else { 'fail' }
            nativeFocusedTestsPassed = $redactionExit -eq 0
            scenarios = @('normal-playback', 'authentication-rejection', 'network-failure', 'raw-mpv-output')
            persistedPlaybackOutputUrlFree = $persistedUrlFree
        }
        networkProbe = $networkProbe
        namedPipeAcl = if ($null -eq $script:namedPipeAcl) { [ordered]@{ status = 'open'; inspectedActualPipe = $false } } else { $script:namedPipeAcl }
    }
    $result | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath (Join-Path $runDirectory 'acceptance.json') -Encoding UTF8
    Write-Host 'Slice 8 native run completed. Raw evidence remains under the ignored native artifact tree.' -ForegroundColor Green
} finally {
    Pop-Location
}
