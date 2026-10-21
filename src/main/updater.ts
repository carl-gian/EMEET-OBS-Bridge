import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { Log } from '@core/types'

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'disabled'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 30 * 1000

/**
 * Auto-update via GitHub Releases (electron-updater).
 * Safety rule for live production: an update is DOWNLOADED in the background but never installed or restarted
 * on its own. The operator installs it from the tray ("Restart to update") when no meeting is running.
 * Installed builds only; dev runs are disabled.
 */
export class Updater {
  status: UpdateStatus = app.isPackaged ? 'idle' : 'disabled'
  availableVersion = ''
  onChange: () => void = () => {}
  private timer: ReturnType<typeof setInterval> | null = null
  private manual = false

  constructor(private log: Log) {}

  start() {
    if (!app.isPackaged) {
      this.log.info('Auto-update disabled (development run).')
      return
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = {
      info: (m: unknown) => this.log.info(`UPDATE ${m}`),
      warn: (m: unknown) => this.log.warn(`UPDATE ${m}`),
      error: (m: unknown) => this.log.error(`UPDATE ${m}`),
      debug: () => {}
    }
    autoUpdater.on('checking-for-update', () => this.set('checking'))
    autoUpdater.on('update-available', (i) => {
      this.availableVersion = i.version
      this.log.info(`Update ${i.version} found - downloading in the background.`)
      this.set('downloading')
    })
    autoUpdater.on('update-not-available', () => {
      this.set('up-to-date')
      if (this.manual) void dialog.showMessageBox({ type: 'info', message: `You are on the latest version (${app.getVersion()}).`, buttons: ['OK'] })
      this.manual = false
    })
    autoUpdater.on('update-downloaded', (i) => {
      this.availableVersion = i.version
      this.log.info(`Update ${i.version} downloaded. Waiting for the operator to restart (tray menu) - or it installs on next quit.`)
      this.set('ready')
    })
    autoUpdater.on('error', (e) => {
      this.log.error(`Update check failed: ${e?.message ?? e}`)
      this.set('error')
      if (this.manual) void dialog.showMessageBox({ type: 'error', message: 'Could not check for updates.', detail: String(e?.message ?? e), buttons: ['OK'] })
      this.manual = false
    })

    setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS)
  }

  check(manual = false) {
    if (!app.isPackaged || this.status === 'downloading' || this.status === 'ready') {
      if (manual && this.status === 'ready') void this.promptInstall()
      return
    }
    this.manual = manual
    autoUpdater.checkForUpdates().catch(() => {
      /* reported through the 'error' event */
    })
  }

  /** Ask first: installing closes the app, and the camera/transition automation stops while it restarts. */
  async promptInstall() {
    const r = await dialog.showMessageBox({
      type: 'question',
      title: 'Update ready',
      message: `Version ${this.availableVersion} is ready to install.`,
      detail: 'The app will close and restart. EMEET presets and transitions pause for a few seconds. Do not do this during a live meeting.',
      buttons: ['Later', 'Restart and update'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (r.response === 1) {
      this.log.info('Operator chose to install the update now.')
      autoUpdater.quitAndInstall(false, true)
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private set(s: UpdateStatus) {
    this.status = s
    this.onChange()
  }
}
