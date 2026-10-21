# CLAUDE.md — EMEET–OBS Bridge (Electron port)

Project brief for Claude Code. This repo is the **Electron/TypeScript rewrite** of a working PowerShell tool
(`OBS-Master-Controller.ps1` + `EMEET-Background.ps1`) that automates OBS Studio transitions and an EMEET PTZ camera
for live Zoom-based meeting productions. The PowerShell version is proven in production use. **Your job is to reproduce its
behaviour and timing exactly, not to redesign it.** Where this document says "must", it was learned the hard way.

---

## 0. Working with the owner (read first)

- The owner (Gi) is **not a developer**. For anything involving a terminal, installs, or running code, give **step-by-step
  novice instructions**: what to click, what to type, what output to expect. Don't assume tool familiarity.
- Be candid. If a requested change would break timing or reliability, say so before doing it.
- Never change timing values, the Fast Mode sequence, or the "resident worker" design (Section 6) without asking.
- Keep replies concise; put detail in code comments and docs, not chat.
- Windows 10/11 x64 only. The app drives a Windows GUI program (EMEET Studio, a Qt app) through Win32 messages.

---

## 1. What the app does

1. Connects to **OBS Studio** over the built-in **obs-websocket v5** server (`ws://localhost:4455`, no OBS plugin).
2. Watches Studio Mode events. Every OBS scene belongs to a **preset group** (e.g. "Stage / Speaker", "Reader", "Table").
3. When the program scene changes:
   - **Same preset group** → plain **1000 ms Fade**, camera untouched.
   - **Different preset group** → **1000 ms transition** *and* the matching **EMEET camera preset button is clicked ~200 ms into it**.
4. The EMEET camera preset is triggered by posting **background mouse clicks** to the EMEET Studio window (it is never
   brought to the foreground and never steals focus).
5. Must also react quickly when **another program** (e.g. Meeting Media Manager) switches the OBS program scene directly,
   without ever loading it into Preview.
6. Runs unattended: tray app, starts with Windows, single instance, file logging. The operator cannot see a console.

---

## 2. "Fast Mode" transition sequence (the core spec)

> Name coined by the owner: **Fast Mode**. All durations come from config; these are the shipped values.

Timeline for a **cross-group** switch (target scene belongs to a different preset than the current program scene):

```
t = 0 ms     Transition starts (operator pressed Transition, or OBS emitted SceneTransitionStarted)
             → controller computes fireAt = now + ptz.fireOffsetMs (200)
             → controller sends "<presetId>|<fireAtUnixMs>" to the PTZ worker (already running, already holding the window handle)
t ≈ 0–5 ms   worker receives it; waits until fireAt
t = 200 ms   worker posts WM_MOUSEMOVE / WM_LBUTTONDOWN / WM_LBUTTONUP to the EMEET preset button
t = 1000 ms  Transition ends (SceneTransitionEnded) → controller re-primes OBS for the next pair
```

Rules:

| Case | Behaviour |
|---|---|
| Intra-group switch (same preset) | `Fade`, 1000 ms. **No camera click.** |
| Cross-group switch | `Fade to Black` (configurable) 1000 ms. Camera click at +`fireOffsetMs` (default **200 ms**). |
| Program changed by another program without Preview (stale Preview) | **Quick-fire**: on `CurrentProgramSceneChanged`, if the new scene's group ≠ the group the camera was last sent to, click **immediately** (no offset). |
| Early guess was wrong (Preview stale, real target differs) | Quick-fire / confirmed-target logic corrects it right away with the right preset. |
| Camera already on that preset | **Do nothing** (dedupe via `cameraGroup` state). |
| Operator hits Transition with Program == Preview (same scene) | Treated as a **manual PTZ resync**: always click that scene's preset (`force`), even if `cameraGroup` already matches. |
| Scene not mapped to any preset | Treated as intra-group; never clicks. (`behavior.unknownScenePolicy: "intra"`) |
| Click fails / EMEET not found | Log an error; keep running; next switch retries. |

The cross-group transition kind is an **open decision** (see Section 12): currently `Fade to Black` (camera swing is hidden by
the dip to black) vs plain `Fade` (camera swing visible in the crossfade). Keep it config-driven.

---

## 3. Architecture to build

```
┌────────────────────────── Electron main process (Node, TypeScript) ──────────────────────────┐
│  ObsClient (obs-websocket-js v5)  ──events──▶  Controller (decision engine, state)           │
│                                                    │                                         │
│                                                    ├─▶ ObsPrimer (SetCurrentSceneTransition…)│
│                                                    └─▶ PtzDispatcher ──▶ EmeetDriver (Win32) │
│  ConfigStore (JSON, hot-reload) · Logger (file + ring buffer) · Tray · AutoStart · SingleInst │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                      Renderer (optional): status, last decisions, config editor, log tail
```

- **No child process per click. Ever.** `EmeetDriver` lives inside the long-running main process (or a long-lived worker
  thread/utility process) and keeps the window handle cached. See Section 6.
- Recommended stack: TypeScript, `obs-websocket-js` (v5 protocol), **`koffi`** (or `ffi-napi`) for `user32.dll` calls,
  `electron-builder` for packaging, `electron-log` or a simple rotating file logger.
- Keep the decision engine **pure and unit-testable** (inputs: scene names + config + state → outputs: decision + actions).
  The PowerShell version's `-SelfTest` / decision matrix and `-DryRun` should survive as tests / a "dry run" setting.

---

## 4. Configuration (JSON)

Single JSON file (user-editable, hot-reloaded where possible). **Preserve this layout** — the owner already has a config in it.
*Never commit the real OBS password; use a placeholder in the repo and load the real value from the user's config.*

```jsonc
{
  "presets": {                       // preset id -> label + where to click in the EMEET window
    "Preset1": { "label": "Stage / Speaker", "x": 929,  "y": 762 },
    "Preset2": { "label": "Reader",          "x": 1025, "y": 764 },
    "Preset3": { "label": "Table",           "x": 1119, "y": 765 },
    "Preset4": { "label": "Preset 4",        "x": 1216, "y": 762 },
    "Preset5": { "label": "Preset 5",        "x": 926,  "y": 862 },
    "Preset6": { "label": "Preset 6",        "x": 1027, "y": 862 },
    "Preset7": { "label": "Preset 7",        "x": 1121, "y": 864 },
    "Preset8": { "label": "Preset 8",        "x": 1222, "y": 859 }
    // A preset may instead have "clicks": [ {x,y,delayMs?,space?}, ... ] for multi-click sequences.
  },
  "scenes": {                        // exact OBS scene name -> preset id (same preset = same "group")
    "CLOSE UP----------(For talks only)": "Preset1",
    "FULL STAGE----------(For Prayers and Switching Speaker)": "Preset1",
    "SEMI-CLOSE UP----------(For Chairmans & Discussions)": "Preset1",
    "PODIUM & DISPLAY----------(For Displaying Pictures)": "Preset1",
    "READER SETUP---------- (Watchtower & CBS)": "Preset2",
    "TABLE ----------- (For Standing)": "Preset3",
    "TABLE CLOSE UP (For Sitting)": "Preset3",
    "PODIUM & TABLE----------(Ministry Part Counseling)": "Preset3"
  },
  "obs": { "uri": "ws://localhost:4455", "password": "<SET-LOCALLY>", "rpcVersion": 1,
           "requestTimeoutSec": 5, "connectTimeoutSec": 10 },
  "transitions": {
    "intraGroup": { "name": "Fade",          "kind": "fade_transition",          "durationMs": 1000, "settings": null },
    "crossGroup": { "name": "Fade to Black", "kind": "fade_to_color_transition", "durationMs": 1000,
                    "settings": { "color": 4278190080, "switch_point": 50 } }   // 0xFF000000 = opaque black (ARGB)
  },
  "ptz":   { "enabled": true, "fireOffsetMs": 200, "overlapPolicy": "restart", "syncOnStartup": false },
  "emeet": { "enabled": true, "processName": "Emeet", "windowTitleLike": "", "exePath": "",
             "layout": { "x": 787, "y": 0, "width": 1140, "height": 1039 },
             "launchTimeoutSec": 20, "coordSpace": "screen", "keepBehind": true,
             "sendToChildWindow": true, "sendMouseActivate": false,
             "clickHoldMs": 40, "clickDelayMs": 250 },
  "behavior": { "requireStudioMode": true, "clearSceneTransitionOverridesOnStart": true,
                "unknownScenePolicy": "intra", "reprimeOnTransitionEnd": true },
  "blackBridge": { "enabled": false, "sceneName": "BLACK SCREEN", "holdMs": 3000 },   // experimental, OFF; do not port first
  "logging": { "level": "Info", "console": true, "file": true }
}
```

Config notes:
- Keys starting with `_` are comments/ignored. A scene pointing to an unknown preset is ignored with a warning.
- Only presets that have at least one scene become **groups**.
- `ptz.delayMs` (legacy, launch delay) is **obsolete** — do not port it. Timing is `fireOffsetMs` only.
- Preset x/y are **screen coordinates** (`coordSpace: "screen"`), tied to `emeet.layout`. If the window is not at `layout`,
  the driver moves it there first.

### Scene-name matching
OBS scene names here contain odd spacing and dashes. Match with a **normalized key**: replace Unicode dashes
(`U+2010–U+2015`, `U+2212`) with `-`, strip all whitespace, lower-case. Use the normalized key for **every** comparison
(config lookup, "same scene?", bridge checks). On startup, verify every configured scene exists in OBS with the **exact**
name and log mismatches as errors; log unmapped OBS scenes as "treated as intra-group".

---

## 5. OBS WebSocket specifics

- Protocol v5 (obs-websocket 5.x, OBS 28+). Tested on OBS 32.2.2 / obs-websocket 5.7.4. Auth via the standard challenge/salt.
- **Event subscription mask** = General (1<<0) | Scenes (1<<2) | Transitions (1<<4) | Ui (1<<10) = `1|4|16|1024`.
- **Studio Mode is required** (check `GetStudioModeEnabled`; error out if off when `requireStudioMode`).
- Events used:
  `CurrentPreviewSceneChanged`, `CurrentProgramSceneChanged`, `SceneTransitionStarted`, `SceneTransitionEnded`,
  `StudioModeStateChanged`, `CurrentSceneTransitionChanged`, `CurrentSceneTransitionDurationChanged`,
  `SceneListChanged` (warn), `ExitStarted` (warn; keep reconnecting).
- Requests used: `GetVersion`, `GetStudioModeEnabled`, `GetSceneList`, `GetCurrentProgramScene`, `GetCurrentPreviewScene`,
  `GetCurrentSceneTransition`, `GetSceneTransitionList` (resolve names), `SetCurrentSceneTransition`,
  `SetCurrentSceneTransitionDuration`, `SetCurrentSceneTransitionSettings`, per-scene transition override get/set (to clear overrides).
  Priming sends the three `Set…` requests as **one batch**.
- **Reconnect forever** with backoff. Never crash if OBS isn't running at launch; it must pick up when OBS starts.
- On session start: resolve configured transition names to real OBS transitions (by name, fall back by kind), clear any
  per-scene transition overrides (`clearSceneTransitionOverridesOnStart`), read Program/Preview, then prime.

### The priming model (how the right transition gets used)
OBS uses whatever transition is **currently selected** when the operator presses Transition. So the controller **primes**
OBS ahead of time: whenever Preview (or Program) changes and no transition is running, compute
`decision(program → preview)` and, if the selected transition name/duration differ, send the batch:
`SetCurrentSceneTransition(name)` + `SetCurrentSceneTransitionDuration(ms)` + (optionally) `SetCurrentSceneTransitionSettings`.
- Keep a cache of applied name/duration; skip no-op primes.
- While a transition is in flight, **defer** priming to `SceneTransitionEnded` (with a watchdog: clear the in-flight flag if
  stuck longer than `crossGroup.durationMs/1000 + 10` seconds).
- Re-prime on `SceneTransitionEnded` and on program change when `reprimeOnTransitionEnd`.
- `SetCurrentSceneTransitionSettings` fails with error **606** ("does not support custom settings") for transitions without
  settings — only send it when the resolved transition's kind equals the configured kind and it is configurable; treat 606 as non-fatal.
- Events `CurrentSceneTransitionChanged/DurationChanged` fired by our own priming just resync the cache; log as warnings only
  if they are unexpected.
- **Latch mismatch**: if `SceneTransitionStarted.transitionName` ≠ the transition the decision expected, the Preview cache
  was stale (another tool set Program directly). Log a warning and do **not** trust the Preview-based early fire.

---

## 6. PTZ / EMEET mechanism — the part that cost the most debugging

### 6.1 The big lesson: no process spawn per click
The first PowerShell version launched a new `powershell.exe` for every click. Startup (PowerShell + C# `Add-Type` compile
+ window lookup) took **3–7 seconds**, so the click landed after the transition (logs showed "LATE by 6772 ms").
Caching a compiled DLL helped a little; a **resident worker** fixed it (click ≈ tens of ms after the command).
**In the Electron app, hold the EMEET window handle in memory and call Win32 directly. No spawning, no shelling out.**

### 6.2 Scheduling
- Commands are `{ presetId, fireAtUnixMs? }`. `fireAtUnixMs` is an **absolute** wall-clock time (`Date.now()` based), not a
  relative delay, so startup/queue latency can't shift it.
- Worker: validate window → if `fireAt` in the future, sleep until it → click. If already past, click immediately and
  log `LATE by N ms`.
- Re-read preset x/y from config on **every** command (live edits apply without restart).
- Process commands **serially**. Latest-wins is acceptable (commands are ≥ hundreds of ms apart in practice).
- Don't block the OBS event loop: schedule with timers/async, don't busy-wait on the main thread.

### 6.3 Camera state + dedupe
Maintain `cameraGroup` = the preset last sent. `invokePtz(group, {fireAt?, force?})`:
1. If `!force && group === cameraGroup` → log "camera already on X" and return.
2. Else dispatch and set `cameraGroup = group` **at dispatch time** (so the confirm path dedupes against the early fire).
Initial `cameraGroup = null` so the first program change always clicks. Manual resync passes `force: true`.

### 6.4 EMEET window handling (Win32 via koffi)
Target: the **EMEET Studio** window (process name `Emeet`, Qt6, top-level class like `Qt683QWindowIcon`).
`ensureWindow()` (slow path, run at startup and whenever the cheap check fails):
1. Find the top-level window by process name (and/or title containing `windowTitleLike`). If absent and `exePath` is set,
   launch it and poll up to `launchTimeoutSec`; else error.
2. If minimized/hidden/maximized → `ShowWindow(SW_SHOWNOACTIVATE=4)`; if maximized → `ShowWindow(SW_SHOWNORMAL=1)`.
3. If `GetWindowRect` ≠ `emeet.layout` → `SetWindowPos(h, 0, x, y, w, h, SWP_NOZORDER|SWP_NOACTIVATE|SWP_SHOWWINDOW = 0x54)`.
4. If `keepBehind` → `SetWindowPos(h, HWND_BOTTOM=1, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE = 0x13)`.
5. Restore the previously focused window if focus changed (`GetForegroundWindow` before/after → `SetForegroundWindow`).

`getReadyWindow()` (fast path, per click): if cached handle is visible, not iconic, not zoomed, and its rect equals
`layout` → use it. Otherwise run `ensureWindow()` again.

`sendBackgroundClick(top, x, y, space)`:
1. Convert to **screen** coords (`space === "client"` → `ClientToScreen(top, p)`).
2. If `sendToChildWindow`: repeatedly (≤ 8 levels) `ScreenToClient(target)` → `ChildWindowFromPointEx(target, pt, CWP_SKIPINVISIBLE|CWP_SKIPDISABLED = 3)`
   and descend until no deeper child. The **deepest child HWND** under the point is the target.
3. `ScreenToClient(target, p)`; `lParam = ((y & 0xFFFF) << 16) | (x & 0xFFFF)`.
4. `PostMessage(target, WM_MOUSEMOVE 0x0200, 0, lParam)` → wait **20 ms** →
   `PostMessage(target, WM_LBUTTONDOWN 0x0201, MK_LBUTTON=1, lParam)` → wait **`clickHoldMs` (40 ms)** →
   `PostMessage(target, WM_LBUTTONUP 0x0202, 0, lParam)`.
5. (Optional, off by default) `WM_MOUSEACTIVATE 0x21` to the top window when `sendMouseActivate`.
6. Multi-click presets: wait `clickDelayMs` (250 ms) between clicks unless a click has its own `delayMs`.

Proven log line shape: `click screen(1119,765) -> hwnd 0x20908 [Qt683QWindowIcon] client(324,734)`.

⚠ **DPI risk (Electron-specific):** the PowerShell tool called `SetProcessDPIAware()` so all coordinates are physical pixels.
Electron/Chromium is DPI-aware by default, but `screen.*` APIs may return DIPs. When calling Win32 use **physical pixel**
values only, and verify against a real click at 100% and at the owner's actual display scaling.

---

## 7. Event handling logic (port this faithfully)

State: `programScene`, `previewScene`, `transitionInFlight`, `pendingCrossCheck {origin, earlyGroup}`, `cameraGroup`,
`appliedTransitionName`, `appliedDurationMs`, `studioMode`.

```
onPreviewSceneChanged(scene):
    previewScene = scene
    if transitionInFlight: (watchdog) defer priming; return
    prime(decision(programScene → previewScene))

onTransitionStarted(transitionName):
    transitionInFlight = true
    d = decision(programScene → previewScene)
    if d.transitionName != transitionName: warn LATCH MISMATCH (preview may be stale)
    if normalize(d.origin) == normalize(d.target):           # Program == Preview, operator pressed Transition again
        invokePtz(group(d.origin), force=true)               # manual resync
        pendingCrossCheck = null; return
    pendingCrossCheck = { origin: programScene, earlyGroup: null }
    if d.isCrossGroup and d.transitionName == transitionName:   # EARLY FIRE (Fast Mode)
        pendingCrossCheck.earlyGroup = d.targetGroup
        invokePtz(d.targetGroup, fireAt = now + ptz.fireOffsetMs)

onProgramSceneChanged(scene):
    old = programScene; programScene = scene
    if normalize(old) != normalize(scene):
        g = group(scene)
        if g: invokePtz(g)                                   # QUICK-FIRE (immediate; deduped by cameraGroup)
    if pendingCrossCheck and old != scene:
        d = decision(old → scene)
        if pendingCrossCheck.earlyGroup:
            if earlyGroup != d.targetGroup: invokePtz(d.targetGroup)   # correct a wrong early guess
        elif d.isCrossGroup: invokePtz(d.targetGroup)
        pendingCrossCheck = null
    if !transitionInFlight and reprimeOnTransitionEnd: prime(decision(programScene → previewScene))

onTransitionEnded(transitionName):
    transitionInFlight = false
    if pendingCrossCheck:                                    # program-change event never arrived: verify
        cur = GetCurrentProgramScene(); if cur != origin: same correction logic as above
        pendingCrossCheck = null
    if reprimeOnTransitionEnd: prime(decision(programScene → previewScene))
```

`decision(origin → target)`: `og = group(origin)`, `tg = group(target)`;
`isCrossGroup = (og && tg && og != tg)` (or `og && !tg && unknownScenePolicy == "cross"`);
transition = `isCrossGroup ? transitions.crossGroup : transitions.intraGroup`.

Known timing caveat: for a switch made by **another program**, OBS reports the new scene via `CurrentProgramSceneChanged`
when it flips the program, which can be up to ~1 s into a 1000 ms fade. That is an OBS limitation of the quick-fire path.

---

## 8. Operational requirements (the PowerShell version had these; keep them)

- **Runs hidden**: tray icon only; no console/taskbar clutter. Tray menu: status, open logs, resync camera, dry-run toggle, quit.
- **Start with Windows** (login item) and **single instance** (`app.requestSingleInstanceLock()`), second launch focuses the first.
- **Logging**: timestamped (`YYYY-MM-DD HH:mm:ss.SSS [LEVEL]`) rolling file + in-app tail. Levels Debug/Info/Warn/Error.
  Separate the PTZ log lines (preset, hwnd, latency) so timing can be audited. The owner debugs from log files — make them informative.
- **Startup log must state the build/version** and whether the PTZ driver is ready, e.g.
  `BUILD x.y.z`, `PTZ driver ready (hwnd 0x…)`. (A stale hidden process once hid a bad deploy; a version line makes that obvious.)
- **Stop/restart cleanly**: quitting must release the window handle and cancel pending timers.
- **Modes**: `dryRun` (log decisions, send nothing), `selfTest` (diagnostics + decision matrix, then exit),
  `showMap` (print preset → x,y → scenes table), `resyncPtz` (click the current program scene's preset once).
- Config file location: next to the app (portable) or `%APPDATA%`; watch for changes and reload.

---

## 9. Expected log output (acceptance reference)

Healthy cross-group switch in Fast Mode:

```
[INFO ] TRANSITION STARTED 'Fade to Black'  (READER SETUP… -> PODIUM & DISPLAY…)
[INFO ] PTZ -> preset 'Preset1' (Stage / Speaker) sent to worker, click in 198 ms [early fire at transition start (click at +200 ms)]
[INFO ]         expecting CROSS-GROUP -> PTZ preset once confirmed
[EMEET] click screen(929,762) -> hwnd 0x… [Qt683QWindowIcon] client(134,731)
[EMEET] Preset 'Preset1' (Stage / Speaker): 1 click(s) sent, <100 ms after command arrived.
[INFO ]         CONFIRMED CROSS-GROUP  'READER SETUP…' -> 'PODIUM & DISPLAY…'
[INFO ]         Early PTZ click for 'Preset1' matches confirmed target - nothing more to do.
[INFO ] PRIME -> 'Fade' / 1000 ms   [transition ended (resync)]
```

Acceptance tests (manual, on the real rig):
1. Cross-group switch → click lands **≈200 ms** after `TRANSITION STARTED`, and well before `TRANSITION ENDED`.
2. Intra-group switch → **no** click.
3. Switch Program via another program with Preview untouched → click fires on the program-change event, correct preset.
4. Press Transition with Program == Preview → click fires (manual resync), even if camera already on that preset.
5. Rapid back-and-forth switching → no duplicate/extra clicks, `cameraGroup` stays correct.
6. Kill EMEET Studio, switch scenes → error logged, no crash; restart EMEET → next switch works (re-ensure window).
7. Start the app before OBS → it waits and connects when OBS appears. Restart OBS mid-session → it reconnects and re-primes.
8. Move/minimize the EMEET window → driver restores layout before clicking, without stealing focus.

---

## 10. Pitfalls already hit (do not repeat)

1. **Per-click process spawn** = 3–7 s latency. Use the in-process/resident driver.
2. **Relative delays drift** with startup time. Use absolute `fireAt` timestamps.
3. **Trusting Preview** breaks when another tool sets Program directly → always confirm with `CurrentProgramSceneChanged`, and quick-fire from that event.
4. **Double clicks**: early fire + confirm + quick-fire all happen for one switch. `cameraGroup` dedupe is what prevents repeats.
5. **Manual resync must bypass dedupe** (`force`).
6. **Config durations override code defaults.** The owner's config once still said 5800/500 ms while the code said 1000 — always log the resolved durations at startup.
7. **Stale background process** (old version still running hidden) silently ignored the new build. Log the build; enforce single instance; provide a "stop" path.
8. **Error 606** on `SetCurrentSceneTransitionSettings` for non-configurable transitions is benign; avoid sending when unsupported.
9. **Don't hold the click on the event loop**; OBS events must keep flowing during the 200 ms wait.
10. **Never bring EMEET to the foreground.** Background `PostMessage` only; restore the prior foreground window after any window move.

---

## 11. Suggested repo layout

```
src/
  main/            index.ts, tray.ts, autostart.ts, singleInstance.ts
  obs/             client.ts (connect/reconnect/auth), events.ts, primer.ts, sceneMap.ts
  core/            decision.ts (pure), controller.ts (state machine), ptzDispatcher.ts
  emeet/           win32.ts (koffi bindings), window.ts (ensure/ready), click.ts, driver.ts
  config/          schema.ts (zod), store.ts (load/validate/watch)
  log/             logger.ts
  renderer/        status UI (optional, later)
tests/             decision.test.ts, scheduler.test.ts, normalize.test.ts
```

Build order: **(1)** config + scene normalization + `decision()` with tests → **(2)** OBS client + priming (dry-run only) →
**(3)** EMEET driver with a standalone `click <preset>` CLI to validate Win32 clicking on the real rig → **(4)** wire Fast Mode
(early fire + quick-fire + dedupe + resync) → **(5)** tray/autostart/logging/packaging → **(6)** UI.

---

## 12. Open decisions (ask the owner; don't assume)

- **Cross-group transition**: `Fade to Black` @1000 ms (current) vs plain `Fade` @1000 ms.
- **`fireOffsetMs`**: 200 ms now; may be tuned per camera travel speed. Expose in UI.
- Should `cameraGroup` be re-synced on startup (`ptz.syncOnStartup`, default false) or when EMEET restarts?
- Black-bridge mode (hold on a black scene while the camera moves) exists in the PowerShell source but is **disabled** and
  unverified — leave out of v1.
- Multi-camera or multiple EMEET windows: out of scope for v1.
- Packaging/auto-update approach and code-signing (unsigned `.exe` may trigger SmartScreen/antivirus prompts).

---

## 13. Reference: original implementation

Source of truth for behaviour (PowerShell 5.1): `OBS-Master-Controller.ps1` (event loop, decision/priming, PTZ dispatch,
resident-worker client) and `EMEET-Background.ps1` (Win32 window handling, background click, `-Action Daemon` resident worker
listening on named pipe `EmeetPtzWorker`, receiving `"<presetId>|<fireAtUnixMs>"`). When the spec here and the PowerShell
disagree, **ask** — the PowerShell is what is proven on the live rig.


---

## 14. Owner-approved changes (2026-10-21, build 0.2.0) - these supersede the sections above

- **Fast Mode click delay defaults to 0 ms** (`ptz.fireOffsetMs`, was 200): the camera click is dispatched as soon as `SceneTransitionStarted` arrives. Still configurable (Settings > Transition Rules, with a help tip). Old configs that had 200 are migrated to 0 once (`configVersion` 2).
- **Black Bridge is now "Seamless Mode"** (not experimental; `transitions.crossGroupMode: "seamless"`, `seamless: {sceneName, fadeToBlackMs 800, holdMs 3000, fadeInMs 800}`). Sequence: operator picks a scene in Preview (remembered) -> app puts the BLACK scene in Preview -> on Transition: 800 ms fade to black -> **camera click fires when that fade ends** -> hold 3000 ms -> 800 ms fade to the remembered scene.
- **Camera helper is a resident `powershell.exe` running `resources/ptz-worker.ps1`** (JSON lines on stdin) - not koffi (section 3/6 notes about koffi are superseded; the "no per-click spawn" rule still holds).
- Presets: always Preset1..8 stored with coordinates; `presetCount` (3..8, default 3) decides how many are shown. Preset editing is locked in the UI until "Edit presets".
- Removed: import of the old PowerShell config, Start with Windows (a stale login item from older builds is cleared). Dry run lives in Settings > General, is never persisted (off at every start), and is not in the tray menu.
- Closing/minimizing hides to the tray; tray Quit asks for confirmation.
- Per-scene EMEET **tracking** clicks (Settings > Camera coordinates; `tracking.*`, `sceneTracking`).
