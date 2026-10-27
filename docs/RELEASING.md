# Releasing an update

Installed copies check GitHub Releases 30 s after start and every 6 h. A new version downloads in the
background and is installed only when the operator picks **Restart to update** in the tray (or on next quit).

1. Add an entry for the new version at the top of `src/shared/changelog.ts` (plain-language, for the operator). It is shown once after the update. A test fails if it is missing.
2. Change `"version"` in `package.json` (e.g. `1.0.0` -> `1.1.0`). It must be higher than the installed one.
3. Commit and push to `main`.
4. Tag and push the tag:
   ```
   git tag v1.1.0
   git push origin v1.1.0
   ```
5. GitHub Actions ("Release Windows installer") builds and publishes the installer plus `latest.yml` to a Release.

Notes
- The repo must be **public** (or releases hosted elsewhere) or installed apps cannot download updates.
- Unsigned builds work but Windows SmartScreen may warn; code signing is a separate decision.
- The first build with this feature (0.2.1+) must be installed by hand; later versions update themselves.

## Releasing the OBS plugin (separate from the app)

The plugin lives in `obs-plugin/` and has its own releases. The app reads the newest `plugin-*` release's `plugin-manifest.json`.

1. Change `"version"` (and, for a new OBS, `"obsVersion"` and the pinned dependencies) in `obs-plugin/buildspec.json`.
2. Commit and push to `main`. The *Build OBS plugin* workflow builds a test zip (Actions > the run > Artifacts). Test it on the rig first.
3. Tag and push: `git tag plugin-1.0.1` then `git push origin plugin-1.0.1`. The tag **must** equal `plugin-` plus the version in `buildspec.json`, and must **never** start with `v` (that would start an app release).
4. The workflow publishes a **pre-release** with the zip and `plugin-manifest.json`. Installed apps pick it up within 6 hours (or on *Check again*).

Rules: one plugin per OBS version, built for the latest stable OBS only. When a new stable OBS ships, build a new plugin for it and move forward; never patch an older OBS's plugin.
