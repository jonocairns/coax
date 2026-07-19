[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'
$script:Failures = 0

function Write-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail
    )

    if ($Passed) {
        Write-Host "[ok]   $Name - $Detail"
    } else {
        Write-Host "[fail] $Name - $Detail" -ForegroundColor Red
        $script:Failures += 1
    }
}

function Invoke-Checked {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    try {
        & $Command
        Write-Check $Name ($LASTEXITCODE -eq 0) "exit code $LASTEXITCODE"
    } catch {
        Write-Check $Name $false $_.Exception.Message
    }
}

Write-Host 'Coax native Windows prerequisite check'
Write-Host "PowerShell: $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))"

$isNativeWindows = $env:OS -eq 'Windows_NT'
Write-Check 'Windows' $isNativeWindows "$([System.Environment]::OSVersion.VersionString); $env:PROCESSOR_ARCHITECTURE"

$git = Get-Command git -ErrorAction SilentlyContinue
Write-Check 'Git' ($null -ne $git) $(if ($git) { (& git --version) } else { 'not found on PATH' })

$node = Get-Command node -ErrorAction SilentlyContinue
$nodeVersion = $null
if ($node) {
    $nodeVersion = (& node --version).TrimStart('v')
}
$nodeMajor = if ($nodeVersion) { [int]($nodeVersion.Split('.')[0]) } else { 0 }
Write-Check 'Node.js' ($nodeMajor -eq 24) $(if ($nodeVersion) { "$nodeVersion (required major: 24)" } else { 'not found on PATH' })

$corepack = Get-Command corepack -ErrorAction SilentlyContinue
Write-Check 'Corepack' ($null -ne $corepack) $(if ($corepack) { (& corepack --version) } else { 'not found on PATH' })

if ($corepack) {
    Invoke-Checked 'pnpm via Corepack' { & corepack pnpm --version }
} else {
    Write-Check 'pnpm via Corepack' $false 'Corepack is required; no global pnpm install is performed'
}

if ($script:Failures -gt 0) {
    Write-Host "Prerequisite checks failed: $script:Failures" -ForegroundColor Red
    exit 1
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
    if (-not $SkipInstall) {
        Invoke-Checked 'Frozen dependency install' { & corepack pnpm install --frozen-lockfile }
    }

    Invoke-Checked 'Type-check' { & corepack pnpm typecheck }
    Invoke-Checked 'Lint' { & corepack pnpm lint }
    Invoke-Checked 'Unit tests' { & corepack pnpm test }
    Invoke-Checked 'Production build' { & corepack pnpm build }
    Invoke-Checked 'Electron executable' { & corepack pnpm exec electron --version }

    if (-not $SkipLaunch) {
        $previousSmokeValue = $env:COAX_SMOKE_TEST
        $env:COAX_SMOKE_TEST = '1'
        try {
            Invoke-Checked 'Development window smoke launch' { & corepack pnpm dev }
        } finally {
            $env:COAX_SMOKE_TEST = $previousSmokeValue
        }
    }
} finally {
    Pop-Location
}

if ($script:Failures -gt 0) {
    Write-Host "Coax checks failed: $script:Failures" -ForegroundColor Red
    exit 1
}

Write-Host 'All requested native Windows checks passed.' -ForegroundColor Green
exit 0
