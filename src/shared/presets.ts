import type { PresetCfg } from './types'

export const MAX_PRESETS = 8
export const MIN_PRESETS = 3

/** The 8 EMEET preset buttons with their original screen coordinates (used for defaults and "Reset to defaults"). */
export const DEFAULT_PRESETS: Record<string, PresetCfg> = {
  Preset1: { label: 'Stage / Speaker', x: 929, y: 762 },
  Preset2: { label: 'Reader', x: 1025, y: 764 },
  Preset3: { label: 'Table', x: 1119, y: 765 },
  Preset4: { label: 'Preset 4', x: 1216, y: 762 },
  Preset5: { label: 'Preset 5', x: 926, y: 862 },
  Preset6: { label: 'Preset 6', x: 1027, y: 862 },
  Preset7: { label: 'Preset 7', x: 1121, y: 864 },
  Preset8: { label: 'Preset 8', x: 1222, y: 859 }
}

export const presetNumber = (id: string) => Number(id.replace('Preset', '')) || 0
export const presetIds = (): string[] => Array.from({ length: MAX_PRESETS }, (_, i) => `Preset${i + 1}`)
