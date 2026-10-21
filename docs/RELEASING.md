# Releasing an update

Installed copies check GitHub Releases 30 s after start and every 6 h. A new version downloads in the
background and is installed only when the operator picks **Restart to update** in the tray (or on next quit).

1. Change `"version"` in `package.json` (e.g. `0.2.1` -> `0.3.0`). It must be higher than the installed one.
2. Commit and push to `main`.
3. Tag and push the tag:
   ```
   git tag v0.3.0
   git push origin v0.3.0
   ```
4. GitHub Actions ("Release Windows installer") builds and publishes the installer plus `latest.yml` to a Release.

Notes
- The repo must be **public** (or releases hosted elsewhere) or installed apps cannot download updates.
- Unsigned builds work but Windows SmartScreen may warn; code signing is a separate decision.
- The first build with this feature (0.2.1+) must be installed by hand; later versions update themselves.
