import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Tiny per-PC state that is not a user setting (which version the operator last saw, one-off set-up steps already tried). */
const file = () => join(app.getPath('userData'), 'app-state.json')

function read(): Record<string, unknown> {
  try {
    if (!existsSync(file())) return {}
    const v = JSON.parse(readFileSync(file(), 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

function write(patch: Record<string, unknown>) {
  try {
    writeFileSync(file(), JSON.stringify({ ...read(), ...patch }, null, 2))
  } catch {
    /* not critical: the notes would just show again */
  }
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export const readLastSeenVersion = (): string | null => str(read().lastSeenVersion)
export const writeLastSeenVersion = (version: string) => write({ lastSeenVersion: version })

/** The Bridge version that already tried the automatic plugin set-up (so it never asks twice). */
export const readPluginSetupTried = (): string | null => str(read().pluginSetupTried)
export const writePluginSetupTried = (version: string) => write({ pluginSetupTried: version })
