#Requires -Version 5.1
<#
================================================================================
 ptz-worker.ps1  -  resident EMEET click helper for OBS Master Controller
 Derived from the proven EMEET-Background.ps1 (same Win32 window handling and
 PostMessage background clicks), but started ONCE and kept running, so a click
 happens ~tens of ms after the command instead of 3-7 s (no per-click startup).

 Protocol (one command per line on STDIN, JSON):
   {"cmd":"ensure","emeet":{...}}
   {"cmd":"click","id":1,"label":"..","presetId":"Preset1","reason":"..",
    "fireAt":<unix ms or null>,"clicks":[{"x":1,"y":2,"delayMs":0,"space":"screen","note":".."}],"emeet":{...}}
   {"cmd":"list"}      list top-level windows (diagnostics)
   {"cmd":"ping"}
   {"cmd":"quit"}
 Output (one line each, STDOUT):
   READY
   LOG <HH:mm:ss.fff> <text>
   ENSURED 0x<hwnd>|<title>
   DONE {json}
   ERR {json}
 Everything here is ASCII on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI).
================================================================================
#>
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

function Out-Line { param([string]$s) [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Log { param([string]$m) Out-Line ('LOG {0} {1}' -f (Get-Date).ToString('HH:mm:ss.fff'), $m) }
function Now-Ms { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

# ----------------------------------------------------------------- Win32 ----
if (-not ('EmeetWin' -as [type])) {
$emeetSrc = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential)] public struct EmeetPoint { public int X; public int Y; }
[StructLayout(LayoutKind.Sequential)] public struct EmeetRect  { public int Left, Top, Right, Bottom; }

public static class EmeetWin {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out EmeetRect r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref EmeetPoint p);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref EmeetPoint p);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr ChildWindowFromPointEx(IntPtr h, EmeetPoint p, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

    public static List<IntPtr> TopLevel() {
        var list = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr l) { list.Add(h); return true; }, IntPtr.Zero);
        return list;
    }
    public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
    public static string Class(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
    public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
'@
    try { Add-Type -TypeDefinition $emeetSrc } catch { Out-Line ('FATAL could not compile Win32 helper: ' + $_.Exception.Message); exit 2 }
}
# Real pixels, not DPI-virtualised.
try { [void][EmeetWin]::SetProcessDPIAware() } catch { }

$script:hwnd = [IntPtr]::Zero
$ignoreClass = '^(IME|MSCTFIME|GDI\+ Hook|Default IME|tooltips_class|WorkerW|Progman)'

function Get-EmeetWindow {
    param($em)
    $procName = [string]$em.processName
    if (-not $procName) { $procName = 'Emeet' }
    if ($procName -notmatch '[\*\?]') { $procName = "*$procName*" }
    $titleLike = [string]$em.windowTitleLike
    $pids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like $procName } | ForEach-Object { [uint32]$_.Id })
    $cands = foreach ($h in [EmeetWin]::TopLevel()) {
        $cls = [EmeetWin]::Class($h); $ttl = [EmeetWin]::Title($h)
        if ($cls -match $ignoreClass) { continue }
        $byPid   = $pids -contains [EmeetWin]::Pid($h)
        $byTitle = $titleLike -and ($ttl -like $titleLike)
        if (-not ($byPid -or $byTitle)) { continue }
        if ([string]::IsNullOrWhiteSpace($ttl)) { continue }
        $r = New-Object EmeetRect; [void][EmeetWin]::GetWindowRect($h, [ref]$r)
        [pscustomobject]@{ H = $h; Vis = [EmeetWin]::IsWindowVisible($h); Area = [math]::Max(0, ($r.Right - $r.Left) * ($r.Bottom - $r.Top)) }
    }
    $best = $cands | Sort-Object @{Expression = 'Vis'; Descending = $true}, @{Expression = 'Area'; Descending = $true} | Select-Object -First 1
    if ($best) { return $best.H } else { return [IntPtr]::Zero }
}

# Slow path: find / launch / restore / place the EMEET window. Never takes focus (restores the previous foreground window).
function Ensure-EmeetWindow {
    param($em)
    $fg = [EmeetWin]::GetForegroundWindow()
    $h  = Get-EmeetWindow $em

    if ($h -eq [IntPtr]::Zero) {
        $exe = [string]$em.exePath
        if ([string]::IsNullOrWhiteSpace($exe)) { throw 'EMEET window not found and no EMEET Studio path is set (Settings > General).' }
        Log "EMEET not running -> launching $exe"
        Start-Process -FilePath $exe | Out-Null
        $timeout = [int]$em.launchTimeoutSec; if ($timeout -le 0) { $timeout = 20 }
        $deadline = (Get-Date).AddSeconds($timeout)
        while ($h -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 400; $h = Get-EmeetWindow $em }
        if ($h -eq [IntPtr]::Zero) { throw "EMEET window did not appear within $timeout s." }
        Start-Sleep -Milliseconds 800
    }

    if ([EmeetWin]::IsIconic($h) -or -not [EmeetWin]::IsWindowVisible($h) -or [EmeetWin]::IsZoomed($h)) {
        Log 'EMEET window minimised/hidden/maximised -> restoring (no activate).'
        [void][EmeetWin]::ShowWindow($h, 4)      # SW_SHOWNOACTIVATE
        if ([EmeetWin]::IsZoomed($h)) { [void][EmeetWin]::ShowWindow($h, 1) }   # SW_SHOWNORMAL
        Start-Sleep -Milliseconds 200
    }

    $x = [int]$em.layout.x; $y = [int]$em.layout.y; $w = [int]$em.layout.width; $hh = [int]$em.layout.height
    $r = New-Object EmeetRect; [void][EmeetWin]::GetWindowRect($h, [ref]$r)
    $ok = ($r.Left -eq $x) -and ($r.Top -eq $y) -and (($r.Right - $r.Left) -eq $w) -and (($r.Bottom - $r.Top) -eq $hh)
    if (-not $ok) {
        Log ("Layout is {0},{1} {2}x{3} -> moving to {4},{5} {6}x{7}" -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top), $x, $y, $w, $hh)
        [void][EmeetWin]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hh, 0x54)   # NOZORDER|NOACTIVATE|SHOWWINDOW
    }
    if ($em.keepBehind) {
        [void][EmeetWin]::SetWindowPos($h, [IntPtr]1, 0, 0, 0, 0, 0x13)             # HWND_BOTTOM, NOMOVE|NOSIZE|NOACTIVATE
    }
    if ($fg -ne [IntPtr]::Zero -and [EmeetWin]::GetForegroundWindow() -ne $fg) { [void][EmeetWin]::SetForegroundWindow($fg) }
    return $h
}

# Fast path (per click): cached handle is still visible, not minimised/maximised and exactly at the layout.
function Get-ReadyWindow {
    param($em)
    $h = $script:hwnd
    if ($h -ne [IntPtr]::Zero -and [EmeetWin]::IsWindow($h)) {
        if ([EmeetWin]::IsWindowVisible($h) -and -not [EmeetWin]::IsIconic($h) -and -not [EmeetWin]::IsZoomed($h)) {
            $r = New-Object EmeetRect; [void][EmeetWin]::GetWindowRect($h, [ref]$r)
            if (($r.Left -eq [int]$em.layout.x) -and ($r.Top -eq [int]$em.layout.y) -and (($r.Right - $r.Left) -eq [int]$em.layout.width) -and (($r.Bottom - $r.Top) -eq [int]$em.layout.height)) { return $h }
        }
    }
    $script:hwnd = Ensure-EmeetWindow $em
    return $script:hwnd
}

# ------------------------------------------------------ background click ----
function MakeLParam { param([int]$cx, [int]$cy) return [IntPtr][int64]((($cy -band 0xFFFF) -shl 16) -bor ($cx -band 0xFFFF)) }

function Send-BackgroundClick {
    param([IntPtr]$Top, [int]$cx, [int]$cy, [string]$Space, $em)
    $holdMs = [int]$em.clickHoldMs; if ($holdMs -le 0) { $holdMs = 40 }
    $p = New-Object EmeetPoint; $p.X = $cx; $p.Y = $cy
    if ($Space -ne 'screen') { [void][EmeetWin]::ClientToScreen($Top, [ref]$p) }
    $sx = $p.X; $sy = $p.Y

    $target = $Top
    if ($em.sendToChildWindow) {                         # descend to the deepest child HWND under the point
        for ($i = 0; $i -lt 8; $i++) {
            $q = New-Object EmeetPoint; $q.X = $sx; $q.Y = $sy
            [void][EmeetWin]::ScreenToClient($target, [ref]$q)
            $child = [EmeetWin]::ChildWindowFromPointEx($target, $q, 3)   # SKIPINVISIBLE | SKIPDISABLED
            if ($child -eq [IntPtr]::Zero -or $child -eq $target) { break }
            $target = $child
        }
    }
    $q = New-Object EmeetPoint; $q.X = $sx; $q.Y = $sy
    [void][EmeetWin]::ScreenToClient($target, [ref]$q)
    $lp = MakeLParam $q.X $q.Y
    Log ("click screen({0},{1}) -> hwnd 0x{2:X} [{3}] client({4},{5})" -f $sx, $sy, [int64]$target, [EmeetWin]::Class($target), $q.X, $q.Y)

    if ($em.sendMouseActivate) { [void][EmeetWin]::PostMessage($Top, 0x21, $Top, [IntPtr][int64](0x0201 -shl 16 -bor 1)) }  # WM_MOUSEACTIVATE
    [void][EmeetWin]::PostMessage($target, 0x0200, [IntPtr]::Zero, $lp)      # WM_MOUSEMOVE
    Start-Sleep -Milliseconds 20
    [void][EmeetWin]::PostMessage($target, 0x0201, [IntPtr]1, $lp)           # WM_LBUTTONDOWN (MK_LBUTTON)
    Start-Sleep -Milliseconds $holdMs
    [void][EmeetWin]::PostMessage($target, 0x0202, [IntPtr]::Zero, $lp)      # WM_LBUTTONUP
}

# --------------------------------------------------------------- commands ----
function Do-Click {
    param($cmd)
    $recv = Now-Ms
    $em = $cmd.emeet
    $h = Get-ReadyWindow $em

    $late = 0
    if ($cmd.fireAt) {
        $wait = [long]$cmd.fireAt - (Now-Ms)
        if ($wait -gt 0) {
            Log "Ready - holding $wait ms to click at the scheduled moment."
            Start-Sleep -Milliseconds ([int]$wait)
        } else {
            $late = -$wait
            Log "Ready but LATE by $late ms - clicking now."
        }
    }

    $defDelay = [int]$em.clickDelayMs; if ($defDelay -le 0) { $defDelay = 250 }
    $coord = [string]$em.coordSpace; if (-not $coord) { $coord = 'screen' }
    $n = 0
    foreach ($c in @($cmd.clicks)) {
        $n++
        $d = 0
        if ($null -ne $c.delayMs) { $d = [int]$c.delayMs } elseif ($n -gt 1) { $d = $defDelay }
        if ($d -gt 0) { Start-Sleep -Milliseconds $d }
        $sp = $coord; if ($c.space) { $sp = [string]$c.space }
        Send-BackgroundClick $h ([int]$c.x) ([int]$c.y) $sp $em
    }
    $done = Now-Ms
    $res = @{ id = $cmd.id; label = [string]$cmd.label; presetId = $cmd.presetId; clicks = $n; lateMs = $late; afterCmdMs = ($done - $recv) }
    Out-Line ('DONE ' + ($res | ConvertTo-Json -Compress))
}

function Do-List {
    foreach ($h in [EmeetWin]::TopLevel()) {
        $t = [EmeetWin]::Title($h); if (-not $t) { continue }
        $r = New-Object EmeetRect; [void][EmeetWin]::GetWindowRect($h, [ref]$r)
        $pn = ''
        try { $pn = (Get-Process -Id ([int][EmeetWin]::Pid($h)) -ErrorAction SilentlyContinue).ProcessName } catch { }
        Log ('WIN {0,-20} vis={1,-5} {2},{3} {4}x{5} [{6}] "{7}"' -f $pn, [EmeetWin]::IsWindowVisible($h), $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top), [EmeetWin]::Class($h), $t)
    }
}

# ------------------------------------------------------------------- loop ----
Out-Line 'READY'
$stdin = [Console]::In
while ($true) {
    $line = $stdin.ReadLine()
    if ($null -eq $line) { break }                 # parent closed the pipe -> exit
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $cmd = $null
    try {
        $cmd = $line | ConvertFrom-Json
        switch ([string]$cmd.cmd) {
            'ping'   { Out-Line 'PONG' }
            'quit'   { break }
            'list'   { Do-List }
            'ensure' {
                $script:hwnd = Ensure-EmeetWindow $cmd.emeet
                Out-Line ('ENSURED 0x{0:X}|{1}' -f [int64]$script:hwnd, [EmeetWin]::Title($script:hwnd))
            }
            'click'  { Do-Click $cmd }
            default  { Log ('Unknown command: ' + [string]$cmd.cmd) }
        }
        if ([string]$cmd.cmd -eq 'quit') { break }
    } catch {
        $id = $null; if ($cmd) { $id = $cmd.id }
        $script:hwnd = [IntPtr]::Zero              # force a fresh window lookup next time
        Out-Line ('ERR ' + (@{ id = $id; cmd = [string]$cmd.cmd; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
}
