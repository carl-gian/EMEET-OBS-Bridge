# OBS Master Controller

Windows tray app: watches OBS Studio (Studio Mode) over obs-websocket v5, picks the right transition, and clicks the
matching EMEET Studio camera preset in the background. See `CLAUDE.md` for the full behaviour spec and `docs/` for guides.

- Get the installer: `docs/GET-THE-EXE.md`
- Test on the rig: `docs/TEST-CHECKLIST.md`
- Dev (macOS/Windows): `npm install`, `npm run dev` (camera clicks are mocked on macOS), `npm test`
- Try without OBS: `npm run fake-obs` in a second terminal (fake OBS on ws://localhost:4455, no password)
