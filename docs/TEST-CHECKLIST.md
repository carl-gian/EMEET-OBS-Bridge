# Test checklist (on the real rig)

Tick each one, then export diagnostics and send it.

1. Start the app BEFORE OBS -> log says it is waiting; open OBS -> it connects by itself ("WebSocket connected", "Program = ...").
2. Cross-preset switch with Preview + Transition button -> `[PTZ] PTZ -> preset ... click in ~198 ms`, then a `[EMEET] click ...` line ~200 ms after `TRANSITION STARTED`.
3. Same-preset switch -> no click.
4. Switch the scene from Meeting Media Manager (no Preview) -> a click fires right after `Program -> ...` with the correct preset.
5. Press Transition with the same scene in Program and Preview -> click fires (manual resync) even if the camera is already there.
6. Rapid back-and-forth switching -> no duplicate clicks.
7. Close EMEET Studio, switch scenes -> an error is logged, nothing crashes. Start EMEET (or let the app start it) -> next switch works.
8. Restart OBS while the app runs -> it reconnects and re-primes.
9. Drag/minimise the EMEET window -> before the next click it goes back to its place without taking focus.
10. Tracking: set the tracking button X/Y, tick Enable Tracking + a scene's Tracking box -> switching to that scene clicks the tracking button; leaving it switches tracking off.
11. Black Bridge (optional): Settings > Transition Rules > Black Bridge, make a "BLACK SCREEN" scene in OBS.
12. Close the window -> app stays in the tray. Tray > Quit really quits.
