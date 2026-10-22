// What's new. Newest first. Add an entry here for EVERY release (a test fails if the current version has none).
// Shown to the operator once, the first time the app starts after an update (and always under Help > What's new).

export interface ChangelogEntry {
  version: string
  date: string // YYYY-MM-DD
  items: string[] // short, plain-language, operator-facing
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.4',
    date: '2026-10-23',
    items: [
      'Seamless Mode has been taken out for now. If you were using it, the app switches you to Fast Mode. A better replacement is being built.',
      'The Fast Mode fade (Fade to Black) is still there, with its duration and switch point settings.'
    ]
  },
  {
    version: '1.0.3',
    date: '2026-10-22',
    items: [
      'Seamless Mode can show a holding card: choose a picture in Settings > Transition Rules and it is shown while the camera moves. With no picture the screen is plain black.',
      'The app now creates the holding scene in OBS for you, so you no longer have to build a "BLACK SCREEN" scene by hand.',
      'Fast Mode (Fade to Black) has a new Switch point setting and a "slow camera" button, so the fade can last long enough for a slow camera to finish moving.',
      'The different-preset options in Settings are now called Transition Modes.'
    ]
  },
  {
    version: '1.0.2',
    date: '2026-10-22',
    items: [
      'Updates are now much easier to notice: a blue "Update ready" badge appears at the top of the app (and in the OBS dock) and Windows shows a notification. Click either to restart and update.',
      'Check for updates in the tray menu now tells you when a new version is found and downloading.'
    ]
  },
  {
    version: '1.0.1',
    date: '2026-10-22',
    items: [
      'Fixed: pressing Resync camera could move and resize this app\'s own window onto the EMEET Studio position. The app now never mistakes itself for EMEET Studio.',
      'EMEET Studio path is filled in by default, with a new switch (off by default) to open EMEET Studio when this app starts.',
      'New switch: start this app when Windows starts (off by default).',
      'New "Send diagnostics" button in Settings > General > Support.',
      'OBS dock redesigned: small OBS and EMEET status badges, and you can choose the EMEET preset and tracking for the scene in Preview. Changes apply when you press Transition.'
    ]
  },
  {
    version: '1.0.0',
    date: '2026-10-22',
    items: [
      'Renamed to EMEET–OBS Bridge.',
      'Fast Mode: the EMEET preset is clicked the moment a transition starts.',
      'Seamless Mode: fade to black, move the camera while the screen is black, then fade to the next scene.',
      'Tracking: tick the Tracking box next to a scene to turn EMEET auto-tracking on for it. The tracking buttons have default positions.',
      'EMEET presets are locked until you press "Edit presets". You can use 3 to 8 presets.',
      'OBS dock: status, Resync camera and Open settings inside OBS (Settings > OBS shows how to add it).',
      'Automatic updates: new versions download in the background and install only when you choose "Restart to update" in the tray menu.',
      'Help guide (Help button or F1) with animated how-tos, "?" tips next to buttons, and a Help item in the tray menu.',
      'Starts hidden in the tray by default (change it in Settings > General).',
      'This "What\'s new" list after each update.'
    ]
  }
]

const parse = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)

/** <0 if a is older than b, 0 if equal, >0 if newer. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Entries newer than `from` and not newer than `current` (newest first). */
export function entriesSince(from: string, current: string, log: ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  return log.filter((e) => compareVersions(e.version, from) > 0 && compareVersions(e.version, current) <= 0)
}

export type LaunchKind = 'first-run' | 'updated' | 'normal'
export interface LaunchInfo {
  kind: LaunchKind
  version: string
  from: string | null
  entries: ChangelogEntry[]
}

/** Decide what to show at start-up from the version last acknowledged on this PC. */
export function launchInfo(lastSeen: string | null, current: string, log: ChangelogEntry[] = CHANGELOG): LaunchInfo {
  if (!lastSeen) return { kind: 'first-run', version: current, from: null, entries: [] }
  if (compareVersions(current, lastSeen) > 0) {
    const entries = entriesSince(lastSeen, current, log)
    // An update with nothing worth telling stays quiet.
    return { kind: entries.length ? 'updated' : 'normal', version: current, from: lastSeen, entries }
  }
  return { kind: 'normal', version: current, from: lastSeen, entries: [] }
}
