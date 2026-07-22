[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][UInt32]$ParentWindowId,
    [Parameter(Mandatory = $true)][UInt32]$MpvProcessId,
    [ValidateRange(100, 5000)][int]$TimeoutMilliseconds = 2000
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Coax {
    public static class EmbeddedWindow {
        public delegate bool EnumWindowCallback(IntPtr window, IntPtr parameter);

        [DllImport("user32.dll")]
        public static extern bool EnumChildWindows(IntPtr parent, EnumWindowCallback callback, IntPtr parameter);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    }
}
'@

$parentWindow = [IntPtr]::new([Int64]$ParentWindowId)
if (-not [Coax.EmbeddedWindow]::IsWindow($parentWindow)) {
    exit 2
}

$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
while ([DateTime]::UtcNow -lt $deadline) {
    $script:mpvWindow = [IntPtr]::Zero
    $callback = {
        param([IntPtr]$window, [IntPtr]$parameter)

        [UInt32]$ownerProcessId = 0
        [void][Coax.EmbeddedWindow]::GetWindowThreadProcessId($window, [ref]$ownerProcessId)
        if ($ownerProcessId -eq $MpvProcessId) {
            $script:mpvWindow = $window
            return $false
        }
        return $true
    }
    [void][Coax.EmbeddedWindow]::EnumChildWindows($parentWindow, $callback, [IntPtr]::Zero)

    if ($script:mpvWindow -ne [IntPtr]::Zero) {
        $hwndTop = [IntPtr]::Zero
        $swpNoSize = 0x0001
        $swpNoMove = 0x0002
        $swpNoActivate = 0x0010
        $swpShowWindow = 0x0040
        $flags = $swpNoSize -bor $swpNoMove -bor $swpNoActivate -bor $swpShowWindow
        if ([Coax.EmbeddedWindow]::SetWindowPos($script:mpvWindow, $hwndTop, 0, 0, 0, 0, $flags)) {
            exit 0
        }
        exit 3
    }
    Start-Sleep -Milliseconds 50
}

exit 4
