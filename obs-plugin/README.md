# EMEET-OBS Bridge Transition (OBS plugin)

One OBS scene transition, installed and managed by the EMEET-OBS Bridge app:

**Scene A fades (500 ms) to a picture, holds it (3500 ms by default), then fades (500 ms) to the next scene.**

- Transition id: `emeet_bridge_hold_transition`
- Settings: `image_path`, `fade_ms` (default 800), `hold_ms` (default 3500), `plugin_version`
- The transition's length is `2 x fade_ms + hold_ms`; the plugin sets it itself (OBS's Duration box is greyed out for it).
- No picture, or a picture that cannot be read: plain black.

## Rules
- Built for **one** OBS version only (`obsVersion` in `buildspec.json`, now **32.2.2**, the latest stable).
- When a new stable OBS ships we build a plugin for that version and move forward. We never patch the plugin of an older OBS.
- Based on OBS Studio's own Fade to Color transition and obsproject/obs-plugintemplate. **GPL v2 or later** (see `LICENSE`).

## Build
Done by GitHub Actions (`.github/workflows/obs-plugin.yml` at the repo root), on Windows only:
- every push to `main` that touches `obs-plugin/` builds a downloadable test zip (Actions > the run > Artifacts);
- a tag `plugin-<version>` (must equal `version` in `buildspec.json`) also publishes a **pre-release** with the zip and `plugin-manifest.json`.

## Install by hand (for testing)
1. Close OBS.
2. Copy the `emeet-bridge-transition` folder from the zip into `C:\ProgramData\obs-studio\plugins\` (OBS 32 layout: `emeet-bridge-transition\bin\64bit\emeet-bridge-transition.dll` and `emeet-bridge-transition\data\...`).
3. Start OBS. In Scene Transitions click **+** and choose **EMEET Bridge (fade, hold on picture, fade)**.
4. Set a picture, fade and hold times. (The Bridge normally does this; the transition's duration follows by itself.)

## Layout note
OBS 33 changes the plugin folder layout (the DLL goes directly in the plugin folder) and OBS 34 stops loading plugins from Program Files. The manifest has a `layout` field so a future build can use the new layout.
