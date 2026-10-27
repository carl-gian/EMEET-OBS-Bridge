import { Notification } from 'electron'
import { exec, spawn } from 'child_process'
import { createHash } from 'crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import AdmZip from 'adm-zip'
import type { Log } from '@core/types'
import { decidePluginState, parseInstalled, parseManifest, pickLatestPluginRelease, PLUGIN_FOLDER, type InstalledPlugin, type PluginDecision, type PluginManifest } from '@core/plugin'
import { compareVersions } from '@shared/changelog'
import type { PluginInfo } from '@shared/types'

const REPO = 'carl-gian/EMEET-OBS-Bridge'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 20 * 1000

/** What the plugin manager needs to know from the rest of the app. */
export interface PluginFactsSource {
  obsVersion: () => string
  kindLoaded: () => boolean
  instanceFound: () => boolean
  riskAcceptedObs: () => string
}

/**
 * Keeps the OBS plugin in step with OBS and the Bridge:
 *  - reads what is installed (plugin.json next to the DLL) and the newest plugin on GitHub (plugin-manifest.json),
 *  - decides the status with the pure decidePluginState() (the version contract),
 *  - installs / updates the plugin when the user asks (download, SHA-256 check, copy, one Windows permission prompt if needed).
 * Nothing here ever runs by itself except the read-only checks: installing is always a click.
 */
export class PluginManager {
  installed: InstalledPlugin | null = null
  manifest: PluginManifest | null = null
  error = ''
  busy: '' | 'checking' | 'installing' = ''
  obsRunning = false
  onChange: () => void = () => {}
  /** Called once per new plugin version found, so the app can show a notification. */
  onUpdateFound: (version: string) => void = () => {}
  private timer: ReturnType<typeof setInterval> | null = null
  private notified = ''

  constructor(private log: Log, private facts: PluginFactsSource, private bridgeVersion: string) {}

  /** Where OBS looks for plugins (all users). null when not on Windows and no override is set. */
  get pluginDir(): string | null {
    const o = process.env['OMC_PLUGIN_DIR']
    if (o) return o
    if (process.platform !== 'win32') return null
    return join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'obs-studio', 'plugins', PLUGIN_FOLDER)
  }

  start() {
    setTimeout(() => void this.refresh(), FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(() => void this.refresh(), CHECK_EVERY_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // ----------------------------------------------------------------- state ----
  decision(): PluginDecision {
    return decidePluginState({
      obsVersion: this.facts.obsVersion(),
      installed: this.installed,
      manifest: this.manifest,
      kindLoaded: this.facts.kindLoaded(),
      instanceFound: this.facts.instanceFound(),
      riskAcceptedObs: this.facts.riskAcceptedObs(),
      bridgeVersion: this.bridgeVersion
    })
  }

  get usable(): boolean {
    return this.decision().usable
  }

  info(): PluginInfo {
    const d = this.decision()
    return {
      status: d.status,
      usable: d.usable,
      installedVersion: this.installed?.plugin ?? '',
      builtForObs: this.installed?.obs ?? '',
      latestVersion: this.manifest?.plugin ?? '',
      latestObs: this.manifest?.obs ?? '',
      obsVersion: this.facts.obsVersion(),
      busy: this.busy,
      error: this.error,
      obsRunning: this.obsRunning
    }
  }

  private set(patch: Partial<Pick<PluginManager, 'busy' | 'error'>>) {
    Object.assign(this, patch)
    this.onChange()
  }

  // ----------------------------------------------------------------- checks ----
  readInstalled(): InstalledPlugin | null {
    const dir = this.pluginDir
    if (!dir) return null
    try {
      const f = join(dir, 'plugin.json')
      if (!existsSync(f)) return null
      return parseInstalled(JSON.parse(readFileSync(f, 'utf8')))
    } catch (e) {
      this.log.warn(`Could not read the installed plugin info: ${(e as Error).message}`)
      return null
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EMEET-OBS-Bridge' }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
    return r.json()
  }

  async fetchManifest(): Promise<PluginManifest | null> {
    const releases = (await this.fetchJson(`https://api.github.com/repos/${REPO}/releases?per_page=30`)) as never[]
    const latest = pickLatestPluginRelease(releases)
    if (!latest) return null
    return parseManifest(await this.fetchJson(latest.manifestUrl))
  }

  private checkObsRunning(): Promise<boolean> {
    if (process.platform !== 'win32') return Promise.resolve(false)
    return new Promise((resolve) => exec('tasklist /FI "IMAGENAME eq obs64.exe" /NH', (_e, out) => resolve(/obs64\.exe/i.test(out ?? ''))))
  }

  /** Reads the installed plugin and asks GitHub for the newest one. Safe to call any time. */
  async refresh() {
    if (this.busy === 'installing') return
    this.set({ busy: 'checking' })
    this.installed = this.readInstalled()
    this.obsRunning = await this.checkObsRunning()
    let error = ''
    try {
      const m = await this.fetchManifest()
      if (m) this.manifest = m
      else if (!this.manifest) error = 'No OBS plugin release was found yet.'
    } catch (e) {
      error = `Could not check for a plugin update (${(e as Error).message}).`
      this.log.warn(`Plugin check failed: ${(e as Error).message}`)
    }
    this.set({ busy: '', error })
    const d = this.decision()
    this.log.info(`OBS plugin: ${d.status}${this.installed ? ` (installed ${this.installed.plugin} for OBS ${this.installed.obs})` : ' (not installed)'}${this.manifest ? `; newest ${this.manifest.plugin} for OBS ${this.manifest.obs}` : ''}; OBS ${this.facts.obsVersion() || 'not connected'}`)
    if (d.status === 'update-available' && this.manifest && this.notified !== this.manifest.plugin) {
      this.notified = this.manifest.plugin
      this.onUpdateFound(this.manifest.plugin)
    }
  }

  // ---------------------------------------------------------------- install ----
  /** Download, verify and install the newest plugin. OBS must be closed (a running OBS keeps the DLL locked). */
  async install() {
    if (this.busy === 'installing') return
    const dest = this.pluginDir
    if (!dest) return this.set({ error: 'The OBS plugin can only be installed on Windows.' })
    if (!this.manifest) {
      await this.refresh()
      if (!this.manifest) return this.set({ error: this.error || 'No OBS plugin release was found yet.' })
    }
    const m = this.manifest
    if (compareVersions(m.minBridge, this.bridgeVersion) > 0) return this.set({ error: `This plugin needs EMEET–OBS Bridge ${m.minBridge} or newer. Please update the Bridge first.` })
    this.obsRunning = await this.checkObsRunning()
    if (this.obsRunning) return this.set({ error: 'Close OBS first, then press Install again.' })

    this.set({ busy: 'installing', error: '' })
    const work = mkdtempSync(join(tmpdir(), 'emeet-plugin-'))
    try {
      this.log.info(`Installing OBS plugin ${m.plugin} (for OBS ${m.obs}) from ${m.url}`)
      const res = await fetch(m.url, { headers: { 'User-Agent': 'EMEET-OBS-Bridge' }, signal: AbortSignal.timeout(120000) })
      if (!res.ok) throw new Error(`Download failed (GitHub answered ${res.status}).`)
      const buf = Buffer.from(await res.arrayBuffer())
      const sha = createHash('sha256').update(buf).digest('hex')
      if (sha !== m.sha256) throw new Error('The downloaded plugin did not match its checksum, so it was not installed.')

      const extracted = join(work, 'x')
      new AdmZip(buf).extractAllTo(extracted, true)
      const src = join(extracted, PLUGIN_FOLDER)
      const info = parseInstalled(existsSync(join(src, 'plugin.json')) ? JSON.parse(readFileSync(join(src, 'plugin.json'), 'utf8')) : null)
      if (!info || info.plugin !== m.plugin || info.obs !== m.obs) throw new Error('The downloaded plugin package is not what the release says it is.')
      if (!existsSync(join(src, 'bin', '64bit', `${PLUGIN_FOLDER}.dll`))) throw new Error('The downloaded plugin package has no plugin file in it.')

      await this.copyIn(src, dest, work)

      this.installed = this.readInstalled()
      if (!this.installed || this.installed.plugin !== m.plugin) throw new Error('The plugin was copied but could not be read back. Please try again.')
      this.log.info(`OBS plugin ${m.plugin} installed into ${dest}. OBS must be (re)started to load it.`)
      this.set({ busy: '', error: '' })
    } catch (e) {
      this.log.error(`OBS plugin install failed: ${(e as Error).message}`)
      this.set({ busy: '', error: (e as Error).message })
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }

  /** Copy the plugin folder into OBS's plugin folder; ask Windows for permission (UAC) only if a normal copy is refused. */
  private async copyIn(src: string, dest: string, work: string) {
    try {
      mkdirSync(join(dest, '..'), { recursive: true })
      rmSync(dest, { recursive: true, force: true })
      cpSync(src, dest, { recursive: true })
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EBUSY') throw new Error('OBS (or something else) is using the old plugin file. Close OBS and try again.')
      if (code !== 'EACCES' && code !== 'EPERM') throw e
      this.log.info('Windows needs permission to write into the OBS plugin folder - asking once.')
    }
    if (process.platform !== 'win32') throw new Error('Permission to write the plugin folder was refused.')
    const ps1 = join(work, 'install-plugin.ps1')
    writeFileSync(
      ps1,
      [
        "$ErrorActionPreference = 'Stop'",
        `$src = '${src.replace(/'/g, "''")}'`,
        `$dst = '${dest.replace(/'/g, "''")}'`,
        'New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null',
        'if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }',
        'Copy-Item $src $dst -Recurse -Force'
      ].join('\r\n')
    )
    // The outer command is passed encoded so no quoting can go wrong, whatever the user name or folder spaces look like.
    const outer = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${ps1.replace(/'/g, "''")}"'`
    const code = await new Promise<number>((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(outer, 'utf16le').toString('base64')], { windowsHide: true })
      p.on('error', () => resolve(1))
      p.on('exit', (c) => resolve(c ?? 1))
    })
    if (code !== 0) throw new Error('Windows permission was declined, so the plugin was not installed.')
  }

  /** A Windows notification for a new plugin version; clicking it runs onClick. */
  notifyUpdate(version: string, onClick: () => void) {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: 'OBS plugin update', body: `A new EMEET–OBS Bridge plugin (${version}) is available. Click to open the plugin settings.` })
    n.on('click', onClick)
    n.show()
  }
}
