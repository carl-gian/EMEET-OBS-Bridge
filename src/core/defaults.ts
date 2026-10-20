import type { AppConfig } from '@shared/types'

/** Shipped defaults. These mirror the owner's proven PowerShell config (the OBS password is NOT included). */
export function defaultConfig(): AppConfig {
  return {
    general: { obsPath: '', launchObsOnStart: false, startMinimized: true, startWithWindows: false },
    obs: {
      host: 'localhost',
      port: 4455,
      password: '',
      rpcVersion: 1,
      requestTimeoutSec: 5,
      connectTimeoutSec: 10
    },
    presets: {
      Preset1: { label: 'Stage / Speaker', x: 929, y: 762 },
      Preset2: { label: 'Reader', x: 1025, y: 764 },
      Preset3: { label: 'Table', x: 1119, y: 765 },
      Preset4: { label: 'Preset 4', x: 1216, y: 762 },
      Preset5: { label: 'Preset 5', x: 926, y: 862 },
      Preset6: { label: 'Preset 6', x: 1027, y: 862 },
      Preset7: { label: 'Preset 7', x: 1121, y: 864 },
      Preset8: { label: 'Preset 8', x: 1222, y: 859 }
    },
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
    blackBridge: { sceneName: 'BLACK SCREEN', holdMs: 3000 },
    ptz: { enabled: true, fireOffsetMs: 200, syncOnStartup: false },
    tracking: {
      enabled: false,
      enableClick: null,
      disableClick: null,
      assumeInitiallyOn: false,
      delayAfterPresetMs: 500
    },
    emeet: {
      enabled: true,
      processName: 'Emeet',
      windowTitleLike: '',
      exePath: '',
      layout: { x: 787, y: 0, width: 1140, height: 1039 },
      launchTimeoutSec: 20,
      coordSpace: 'screen',
      keepBehind: true,
      sendToChildWindow: true,
      sendMouseActivate: false,
      clickHoldMs: 40,
      clickDelayMs: 250
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
