import type { AppConfig } from '@shared/types'
import { DEFAULT_PRESETS, MIN_PRESETS } from '@shared/presets'

export const DEFAULT_EMEET_EXE = 'C:\\Program Files\\EMEET STUDIO\\bin\\64bit\\EMEET STUDIO.exe'

/** Shipped defaults. These mirror the owner's proven PowerShell config (the OBS password is NOT included). */
export function defaultConfig(): AppConfig {
  return {
    configVersion: 4,
    general: { obsPath: '', launchObsOnStart: false, startHidden: true, startWithWindows: false },
    obs: {
      host: 'localhost',
      port: 4455,
      password: '',
      rpcVersion: 1,
      requestTimeoutSec: 5,
      connectTimeoutSec: 10
    },
    presets: JSON.parse(JSON.stringify(DEFAULT_PRESETS)),
    presetCount: MIN_PRESETS,
    scenes: {
      'CLOSE UP----------(For talks only)': 'Preset1',
      'FULL STAGE----------(For Prayers and Switching Speaker)': 'Preset1',
      'SEMI-CLOSE UP----------(For Chairmans & Discussions)': 'Preset1',
      'PODIUM & DISPLAY----------(For Displaying Pictures)': 'Preset1',
      'READER SETUP---------- (Watchtower & CBS)': 'Preset2',
      'TABLE ----------- (For Standing)': 'Preset3',
      'TABLE CLOSE UP (For Sitting)': 'Preset3',
      'PODIUM & TABLE----------(Ministry Part Counseling)': 'Preset3'
    },
    sceneTracking: {},
    transitions: {
      crossGroupMode: 'fast',
      intraGroup: { name: 'Fade', kind: 'fade_transition', durationMs: 1000, settings: null },
      crossGroup: {
        name: 'Fade to Black',
        kind: 'fade_to_color_transition',
        durationMs: 1000,
        settings: { color: 4278190080, switch_point: 50 }
      }
    },
    plugin: { imagePath: '', fadeMs: 800, holdMs: 3500, riskAcceptedObs: '' },
    ptz: { enabled: true, fireOffsetMs: 0, syncOnStartup: false },
    tracking: {
      enabled: false,
      enableClick: { x: 1071, y: 315 },
      disableClick: { x: 954, y: 315 },
      assumeInitiallyOn: false,
      delayAfterPresetMs: 500
    },
    emeet: {
      enabled: true,
      processName: 'Emeet',
      windowTitleLike: '',
      exePath: DEFAULT_EMEET_EXE,
      launchOnStart: false,
      layout: { x: 787, y: 0, width: 1140, height: 1039 },
      launchTimeoutSec: 20,
      coordSpace: 'screen',
      keepBehind: true,
      sendToChildWindow: true,
      sendMouseActivate: false,
      clickHoldMs: 40,
      clickDelayMs: 250,
      presetClickCount: 3,
      presetClickGapMs: 300
    },
    behavior: {
      requireStudioMode: true,
      clearSceneTransitionOverridesOnStart: true,
      unknownScenePolicy: 'intra',
      reprimeOnTransitionEnd: true
    },
    // Debug while the owner is testing; the owner can lower it in Settings > General.
    logging: { level: 'Debug' }
  }
}
