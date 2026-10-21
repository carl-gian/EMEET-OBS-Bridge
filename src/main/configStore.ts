import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, watch, type FSWatcher } from 'fs'
import { dirname, join } from 'path'
import { app, safeStorage } from 'electron'
import type { AppConfig } from '@shared/types'
import { normalizeConfig } from '@core/config'
import { defaultConfig } from '@core/defaults'
import type { Log } from '@core/types'

/**
 * Loads / saves config.json in the user's data folder (%APPDATA%\OBS Master Controller on Windows).
 * The OBS password is stored encrypted with Windows (DPAPI via Electron safeStorage) as obs.passwordEnc.
 */
export class ConfigStore {
  readonly path: string
  private cfg: AppConfig = defaultConfig()
  private lastWritten = ''
  private watcher: FSWatcher | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null
  onExternalChange?: (cfg: AppConfig) => void

  constructor(private log: Log, path?: string) {
    this.path = path ?? join(app.getPath('userData'), 'config.json')
  }

  get(): AppConfig {
    return this.cfg
  }

  load(): AppConfig {
    if (!existsSync(this.path)) {
      this.log.info(`No config yet - creating one with your defaults: ${this.path}`)
      this.cfg = defaultConfig()
      this.save()
      return this.cfg
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'))
      this.cfg = this.fromFileObject(raw)
      if (raw?.configVersion !== this.cfg.configVersion) this.save() // persist migrations right away
    } catch (e) {
      this.log.error(`Could not read config.json (${(e as Error).message}) - using defaults. The broken file was kept as config.broken.json.`)
      try {
        renameSync(this.path, this.path.replace(/config\.json$/, 'config.broken.json'))
      } catch {
        /* ignore */
      }
      this.cfg = defaultConfig()
      this.save()
    }
    return this.cfg
  }

  /** Parse an arbitrary config object (also used to import the old PowerShell config). */
  fromFileObject(raw: any): AppConfig {
    const { config, warnings } = normalizeConfig(raw)
    for (const w of warnings) this.log.warn(w)
    // password: encrypted form wins; a plain "password" (hand-edited / legacy import) is accepted and re-encrypted on save
    const enc = raw?.obs?.passwordEnc
    if (typeof enc === 'string' && enc) {
      try {
        config.obs.password = safeStorage.decryptString(Buffer.from(enc, 'base64'))
      } catch {
        this.log.warn('Could not decrypt the saved OBS password (different Windows user?). Please enter it again in Settings > OBS.')
        config.obs.password = ''
      }
    }
    return config
  }

  private toFileObject(cfg: AppConfig): any {
    const out: any = JSON.parse(JSON.stringify(cfg))
    const pw = out.obs.password as string
    delete out.obs.password
    out.obs.passwordEnc = ''
    if (pw) {
      try {
        if (safeStorage.isEncryptionAvailable()) out.obs.passwordEnc = safeStorage.encryptString(pw).toString('base64')
        else out.obs.password = pw // very rare: no OS encryption available
      } catch {
        out.obs.password = pw
      }
    }
    return out
  }

  save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const text = JSON.stringify(this.toFileObject(this.cfg), null, 2)
      this.lastWritten = text
      const tmp = this.path + '.tmp'
      writeFileSync(tmp, text, 'utf8')
      renameSync(tmp, this.path)
    } catch (e) {
      this.log.error(`Could not save config: ${(e as Error).message}`)
    }
  }

  set(next: AppConfig) {
    this.cfg = normalizeConfig(next).config
    this.cfg.obs.password = next.obs.password // normalizeConfig keeps it, but be explicit
    this.save()
    return this.cfg
  }

  update(fn: (c: AppConfig) => void) {
    const copy: AppConfig = JSON.parse(JSON.stringify(this.cfg))
    fn(copy)
    return this.set(copy)
  }

  /** Reload when the owner edits config.json by hand. */
  watchFile() {
    try {
      this.watcher = watch(this.path, () => {
        if (this.debounce) clearTimeout(this.debounce)
        this.debounce = setTimeout(() => {
          try {
            const text = JSON.stringify(this.toFileObject(this.cfg), null, 2)
            const disk = readFileSync(this.path, 'utf8')
            if (disk === this.lastWritten || disk === text) return // our own write
            this.log.info('config.json changed on disk - reloading.')
            this.cfg = this.fromFileObject(JSON.parse(disk))
            this.lastWritten = disk
            this.onExternalChange?.(this.cfg)
          } catch (e) {
            this.log.warn(`config.json changed but could not be read: ${(e as Error).message}`)
          }
        }, 400)
      })
    } catch {
      /* ignore */
    }
  }

  close() {
    this.watcher?.close()
  }
}
