# Test checklist (on the real rig)

Tick each one, then export diagnostics and send it.

1. Start the app BEFORE OBS -> log says it is waiting; open OBS -> it connects by itself ("WebSocket connected", "Program = ...").
2. Cross-preset switch with Preview + Transition button -> `TRANSITION STARTED`, then immediately `[PTZ] PTZ -> preset ... click now` and a `[EMEET] click ...` line (Fast Mode, delay 0 ms).
3. Same-preset switch -> no click.
4. Switch the scene from Meeting Media Manager (no Preview) -> a click fires right after `Program -> ...` with the correct preset.
5. Press Transition with the same scene in Program and Preview -> click fires (manual resync) even if the camera is already there.
6. Rapid back-and-forth switching -> no duplicate clicks.
7. Close EMEET Studio, switch scenes -> an error is logged, nothing crashes. Start EMEET (or let the app start it) -> next switch works.
8. Restart OBS while the app runs -> it reconnects and re-primes.
9. Drag/minimise the EMEET window -> before the next click it goes back to its place without taking focus.
10. Tracking: set the tracking button X/Y, tick Enable Tracking + a scene's Tracking box -> switching to that scene clicks the tracking button; leaving it switches tracking off.
11. Seamless Mode: make a "BLACK SCREEN" scene in OBS (black Color Source), choose Settings > Transition Rules > Seamless Mode. Pick a scene in Preview (log: `SEAMLESS ARMED`; Preview shows black), press Transition: fade to black 0.8 s -> `SEAMLESS BLACK reached - clicking the camera preset` -> 3 s hold -> 0.8 s fade to the picked scene -> `SEAMLESS complete`.
12. Close (X) or minimize -> window leaves the taskbar, app stays in the tray. Tray > Quit ... asks "Quit?"; Keep running does nothing, Quit really quits.
13. Camera tab: presets are locked until you press Edit presets; Add preset shows Preset 4..8 with coordinates filled in; Reset to defaults restores them.
14. General: Dry run is off after every restart; while on, a yellow banner shows and nothing is sent.
15. Make the window small: the page scrolls and the console log scrolls to the bottom.
