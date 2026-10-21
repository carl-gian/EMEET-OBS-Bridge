import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Tiny per-PC state that is not a user setting (which version the operator last saw). */
const file = () => join(app.getPath('userData'), 'app-state.json')

export function readLastSeenVersion(): string | null {
  try {
    if (!existsSync(file())) return null
    const v = JSON.parse(readFileSync(file(), 'utf8'))?.lastSeenVersion
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

export function writeLastSeenVersion(version: string) {
  try {
    writeFileSync(file(), JSON.stringify({ lastSeenVersion: version }, null, 2))
  } catch {
    /* not critical: the notes would just show again */
  }
}
