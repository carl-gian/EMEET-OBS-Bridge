# EMEET–OBS Bridge

A Windows tray app for live, Zoom-based meeting productions. It watches **OBS Studio** and, whenever the operator switches
to a scene that needs a different camera angle, it presses the matching **preset button in EMEET Studio** for the PTZ camera,
at the right moment during the transition, without ever stealing focus from the window you are working in.

> **Supported display: 1920 x 1080 (1080p) only, at the moment.**
> The camera clicks are sent to fixed screen positions inside the EMEET Studio window, and the shipped positions and window
> layout were measured on a 1080p screen. Other resolutions or display-scaling settings can make clicks miss their buttons
> (see [Screen resolution](#screen-resolution-1080p)). Windows 10/11 x64 only.

> **Made with AI.** This program was written with the help of AI (Claude, by Anthropic), working from my own specification
> and tested by me on a real production setup. It is provided as is; please test it on your own rig before relying on it in a live meeting.

## Screenshot of the Main Screen
<img width="1392" height="912" alt="Default Screen" src="https://github.com/user-attachments/assets/999d7904-63d1-4ca5-87ab-5e70a64c9cc5" />

<img width="1392" height="912" alt="Intro Page" src="https://github.com/user-attachments/assets/91fc478c-1a1b-4d94-942b-9b3967c77346" />

---

## Contents

1. [How it works](#how-it-works)
2. [Transition behaviour](#transition-behaviour)
3. [Features](#features)
4. [Settings reference](#settings-reference)
5. [Screen resolution (1080p)](#screen-resolution-1080p)
6. [Setup (first time)](#setup-first-time)
7. [Troubleshooting and logs](#troubleshooting-and-logs)
8. [Updates](#updates)
9. [For developers](#for-developers)

---

## How it works

```
 OBS Studio  --obs-websocket v5 (ws://localhost:4455)-->  EMEET–OBS Bridge  --background mouse clicks-->  EMEET Studio  -->  PTZ camera
 (Studio Mode)  <---- sets the transition to use ------                (tray app)
```

### Talking to OBS
- The app connects to OBS's **built-in WebSocket server** (obs-websocket 5.x, OBS 28+). No OBS plugin is needed.
- It listens for Studio Mode events: Preview changed, Program changed, transition started, transition ended, and so on.
- It reconnects forever. You can start the app before OBS, or restart OBS mid-meeting, and it picks up again and re-prepares itself.
- **Studio Mode must be on** in OBS. The app warns loudly if it is off.

### Preset groups
Every OBS scene is assigned to one of the EMEET presets (Preset 1, 2, 3 ...). Scenes sharing a preset form a **group**:
they use the same camera angle. For example: *Stage / Speaker* (close up, full stage, podium...), *Reader*, *Table*.
A scene that is not assigned to any preset is treated as "same group": it never moves the camera.

Scene names are matched in a forgiving way (different dash characters, extra spaces and upper/lower case are ignored), but
on startup the app checks each configured scene exists in OBS and logs any mismatch.

### Choosing the transition (priming)
OBS plays whatever transition is currently *selected* when the operator presses Transition. So the app **prepares OBS ahead of time**:
whenever Preview or Program changes, it works out whether the next switch is within one group or between groups and selects the
right transition and duration in OBS (skipping the request if OBS is already set that way). While a transition is playing it waits
and prepares the next one when the transition ends.

### Moving the camera (EMEET Studio)
- The app does not use any camera API. It **posts mouse messages directly to the EMEET Studio window** (move, button down, button up)
  at the screen position of the chosen preset button. The EMEET window is never brought to the front.
- A small resident helper (PowerShell) keeps the EMEET window handle ready, so a click takes tens of milliseconds, not seconds.
- Before clicking, the app checks the EMEET window: if it is minimised, moved or resized, it puts it back at the configured
  position (without taking focus) and keeps it behind other windows. If EMEET Studio is not running and its path is set, the app starts it.
- If a click fails or EMEET cannot be found, an error is logged, the app keeps running, and the next switch tries again.
- The app remembers which preset the camera was last sent to and **never repeats** a click for the same preset.

---

## Transition behaviour

| Situation | What happens |
|---|---|
| **Same preset group** (e.g. Close Up to Full Stage) | Plain **Fade**, 1000 ms. The camera is not touched. |
| **Different preset group**, *Fast Mode* | **Fade to Black** (configurable), 1000 ms. The EMEET preset is clicked as soon as the transition starts (configurable delay, default 0 ms), so the camera moves while the screen dips to black. |
| **Different preset group**, *Seamless Mode* | The operator picks the scene in Preview; the app swaps in a black scene. On Transition: 800 ms fade to black, **camera click when that fade ends**, hold 3000 ms for the camera to arrive, then 800 ms fade in to the chosen scene. Nothing of the camera movement is seen. |
| **Another program** switches the OBS Program scene directly (e.g. Meeting Media Manager), without using Preview | The app clicks the right preset as soon as OBS reports the new Program scene ("quick fire"). OBS reports this up to about 1 s into a 1000 ms fade; that is an OBS limit. |
| The early guess was wrong (Preview was stale) | The app corrects it immediately with the right preset. |
| Camera is already on that preset | Nothing happens. |
| Operator presses Transition when Program and Preview are the **same scene** | Treated as a **manual camera resync**: the preset for that scene is clicked even if the app thinks the camera is already there. |
| Scene not assigned to a preset | Treated as same-group; the camera is never clicked. |
| EMEET not found / click fails | Error logged, app keeps running, next switch retries. |

### Tracking (optional)
EMEET's auto-tracking can be switched per scene. Tick **Tracking** for a scene in the Scene Manager; after the preset click (plus a
short delay) the app clicks the EMEET tracking button on, and off again for scenes without it. You record the on/off button positions
in Settings > Camera.

---

## Features

**Automation**
- Automatic transition selection (Fade within a group, Fade to Black or Seamless between groups), durations editable.
- EMEET preset clicks timed against the transition, with de-duplication, correction of wrong guesses, and quick-fire for external scene changes.
- Manual **Resync camera** (tray menu, window button, or the OBS dock) to re-press the current scene's preset.
- Optional per-scene EMEET tracking on/off.
- Optionally opens OBS when the app starts (if it is not already running) and starts EMEET Studio when needed.

**Window and tray**
- Lives in the **system tray**. Closing or minimising the window hides it to the tray; it keeps running.
- **Hides in the tray at startup** (on by default; switch off in Settings > General to open the window at launch).
- Only one copy can run; starting it again brings the existing window forward.
- Tray menu: status, show window, resync camera, check for updates / restart to update, open logs folder, export diagnostics, quit (asks to confirm).
- Main window shows connection status for OBS and the camera, the Program/Preview scenes, the current EMEET preset, and a live log.

**Scene Manager and settings**
- Assign each OBS scene to a preset directly from the app; tick Tracking per scene.
- Choose how many presets you use (3 to 8); preset button coordinates are preloaded for all 8 and locked until you press **Edit presets**.
- A **Test click** button to check a coordinate against the real EMEET window.
- Settings are saved as a JSON file and edits made to the file by hand are picked up while the app is running.

**OBS dock**
- A small control panel you can place inside OBS (status, Resync, Open settings). It is served only on your own PC
  (`127.0.0.1:4577`), runs outside OBS so it cannot slow OBS or the camera timing, and only works while this app is running.

**Reliability and support**
- Reconnects to OBS indefinitely; survives OBS and EMEET restarts.
- Rolling log files (5 files x 5 MB) with timestamps; PTZ lines show the preset, window handle and timing so clicks can be audited.
- The first log line states the build number so you can confirm which version is running.
- **Export diagnostics**: one zip with logs, settings (password removed), versions and state, to send for support.
- **Dry run**: logs every decision but sends nothing to OBS or the camera. It is never saved and is off at every start.
- **Auto-update** from GitHub Releases (see [Updates](#updates)).

---

## Settings reference

Open the main window and press **Settings**.

| Tab | What is there |
|---|---|
| **General** | EMEET Studio path; OBS path; open OBS at app start; hide in the tray at app start; log detail (Debug/Info/Warn/Error); Dry run. |
| **OBS** | Server address, port, password (stored only on this PC), connect/request timeouts, and the name/URL to paste into OBS for the dock. |
| **Transition Rules** | Same-preset transition; different-preset mode (**Fast** or **Seamless**) with names and durations; camera click delay (Fast Mode); Seamless scene name, fade-out, hold and fade-in times; behaviour switches (Studio Mode warning, clear per-scene overrides on connect, prepare next transition after one ends, click the live scene's preset when connecting). |
| **Camera** | Preset button positions (screen pixels), preset count, tracking buttons, EMEET window position and size, keep EMEET behind other windows, and the master "Camera automation on" switch. |

Where the config file lives: `%APPDATA%\OBS Master Controller\config.json`. Logs are in the `logs` folder beside it (Open logs).

---

## Screen resolution (1080p)

The app clicks the EMEET preset buttons by **screen position**, and moves the EMEET window to a fixed position and size
(default: x 787, y 0, 1140 x 1039). These numbers assume a **1920 x 1080 display**.

- At present only **1080p is supported and tested**. Use Windows display scaling that matches how the numbers were measured; if you
  change the resolution or scaling, re-measure the preset button positions.
- On a different resolution the EMEET window may not fit at the configured size, and the buttons will be at different positions.
  Use Settings > Camera to edit the positions and use **Test click** to confirm each one, but this is not officially supported yet.
- Supporting other resolutions is planned work, not a current feature.

---

## Setup (first time)

1. Install the app, found in the release section. Windows may show a SmartScreen warning because the installer is not code-signed; choose "More info > Run anyway".
2. In **OBS**: Tools > WebSocket Server Settings > enable the server (default port 4455) and set a password. Turn on **Studio Mode**.
3. In **EMEET Studio**: set up your EMEET presets (positions) you want to use.
4. In **this app**: Settings > OBS, enter the address/port/password. Settings > General, set the EMEET Studio and OBS paths if you want them opened automatically.
5. Assign each scene to a preset in the Scene Manager. Check the EMEET preset positions in Settings > Camera (and press **Test click**).
6. Optional: add the dock to OBS (Settings > OBS shows the exact name and URL to paste into *Docks > Custom Browser Docks*).
7. Run the checks in `docs/TEST-CHECKLIST.md` on the real rig before a meeting.

---

## Troubleshooting and logs

| Symptom | Likely cause / fix |
|---|---|
| "OBS not connected" | OBS is closed, WebSocket server is off, or address/port/password is wrong. The app keeps retrying. |
| Warning about Studio Mode | Turn Studio Mode on in OBS. |
| Camera does not move | Camera automation switch is off, Dry run is on, EMEET Studio is not running, or preset coordinates are wrong (resolution not 1080p). Use **Test click**. |
| Camera moves too late | Check the log for `LATE by N ms` and the click delay setting. |
| Clicks land in the wrong place | Display is not 1080p / scaling changed. Re-measure positions. |
| A scene never moves the camera | It is not assigned to a preset, or its name does not match OBS exactly (look for the startup warning in the log). |

Press **Open logs** or use the tray menu to open the log folder; **Export diagnostics** creates a zip to share.

---

## Updates

Installed copies check GitHub Releases shortly after start and every 6 hours. A new version is downloaded in the background but is
**never installed automatically during use**: choose **Restart to update** in the tray menu when no meeting is running (otherwise it
installs the next time the app is quit). Publishing steps for the maintainer: `docs/RELEASING.md`.

---

## For developers

- Built with the assistance of AI (Claude, by Anthropic); the behaviour spec is in `CLAUDE.md`.
- Stack: Electron + TypeScript + React; `obs-websocket-js` for OBS; a resident `powershell.exe` helper (`resources/ptz-worker.ps1`) for Win32 clicks.
- `npm install`, `npm run dev` (camera clicks are mocked on macOS), `npm test`, `npm run typecheck`
- Try without OBS: `npm run fake-obs` in a second terminal (fake OBS on ws://localhost:4455, no password)
- Build the installer: `npm run dist:win` (on Windows or via GitHub Actions)
- Full behaviour spec: `CLAUDE.md`. Guides: `docs/`.
