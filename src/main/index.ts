import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { exec, spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { is } from './is'
import { IPC } from '@shared/types'
import type { AppConfig, AppState, PtzCommand } from '@shared/types'
import { Controller } from '@core/controller'
import { normalizeSceneKey } from '@shared/scene'
import { Logger } from './logger'
import { ConfigStore } from './configStore'
import { MockDriver, PowerShellDriver, workerScriptPath, type EmeetDriver } from './emeetDriver'
import { ObsClient } from './obsClient'
import { buildDiagnosticsZip } from './diagnostics'
import { startDock } from './dock'
import { Updater } from './updater'
import { launchInfo } from '@shared/changelog'
import { SUPPORT_EMAIL } from '@shared/support'
import { readLastSeenVersion, writeLastSeenVersion } from './appState'

const isWin = process.platform === 'win32'
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// The app was renamed; keep using the original data folder so existing settings and logs carry over.
// (Must run before the single-instance lock, which is keyed to this folder.)
app.setPath('userData', join(app.getPath('appData'), 'OBS Master Controller'))

// ---------------------------------------------------------------- single instance ----
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(main)
}

function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(app.getAppPath(), 'resources', 'icon.ico')
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(startHidden: boolean) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 600,
    show: false,
    title: 'EMEET–OBS Bridge',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: existsSync(iconPath()) ? iconPath() : undefined,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  win.setMenu(null)
  win.once('ready-to-show', () => {
    if (!startHidden) win?.show()
  })
  // Closing OR minimizing hides the window to the tray (it also leaves the taskbar). The tray icon brings it back.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('minimize', () => win?.hide())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function main() {
  app.setAppUserModelId('com.gi.obsmastercontroller')
  const logDir = join(app.getPath('userData'), 'logs')
  const logger = new Logger(logDir)
  const log = logger.make('APP')
  const obsLog = logger.make('OBS')
  const ptzLog = logger.make('PTZ')
  const emeetLog = logger.make('EMEET')

  const version = app.getVersion()
  log.info(`BUILD ${version} (electron ${process.versions.electron}, node ${process.versions.node}, ${process.platform} ${process.arch}, ${app.isPackaged ? 'installed' : 'dev'})`)
  log.info(`Log folder: ${logDir}`)

  process.on('uncaughtException', (e) => log.error(`Uncaught exception: ${e.stack ?? e}`))
  process.on('unhandledRejection', (e) => log.error(`Unhandled rejection: ${(e as Error)?.stack ?? e}`))

  // ---- config ----
  const store = new ConfigStore(log)
  store.load()
  logger.level = store.get().logging.level
  log.info(`Config file: ${store.path}`)
  const c0 = store.get()
  log.info(
    `Settings: OBS ws://${c0.obs.host}:${c0.obs.port} | intra '${c0.transitions.intraGroup.name}' ${c0.transitions.intraGroup.durationMs} ms | cross '${c0.transitions.crossGroup.name}' ${c0.transitions.crossGroup.durationMs} ms | mode ${c0.transitions.crossGroupMode} | click offset ${c0.ptz.fireOffsetMs} ms`
  )
  // "Start this app when Windows starts" follows the setting (installed Windows builds only).
  function applyStartWithWindows(cfg: AppConfig) {
    if (!app.isPackaged || !isWin) return
    try {
      if (app.getLoginItemSettings().openAtLogin !== cfg.general.startWithWindows) {
        app.setLoginItemSettings({ openAtLogin: cfg.general.startWithWindows })
        log.info(`Start with Windows: ${cfg.general.startWithWindows ? 'on' : 'off'}`)
      }
    } catch (e) {
      log.warn(`Could not change the Windows start-up setting: ${(e as Error).message}`)
    }
  }
  applyStartWithWindows(c0)

  // ---- camera driver ----
  const driver: EmeetDriver = isWin ? new PowerShellDriver(log, ptzLog, emeetLog) : new MockDriver(ptzLog, emeetLog)
  if (!isWin) log.warn('Not running on Windows: camera clicks are MOCKED (logged only). The real build uses the PowerShell helper.')
  else log.info(`PTZ helper script: ${workerScriptPath()}`)

  // ---- controller + OBS ----
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  const controller: Controller = new Controller({
    obs: { call: (t, d) => obs.link.call(t, d), batch: (r) => obs.link.batch(r) },
    ptzSink: driver,
    ptzLog,
    log: obsLog,
    getConfig: () => store.get(),
    onChange: () => schedulePush()
  })
  const obs: ObsClient = new ObsClient(obsLog, () => store.get(), controller)
  obs.onStatus = () => schedulePush()
  driver.onStatus = () => schedulePush()

  function buildState(): AppState {
    return {
      version,
      platform: process.platform,
      obs: { status: obs.status, obsVersion: controller.obsVersion, wsVersion: controller.wsVersion, studioMode: controller.studioMode, error: obs.lastError || undefined },
      program: controller.programScene,
      preview: controller.previewScene,
      scenes: controller.obsScenes,
      camera: { group: controller.ptz.cameraGroup, tracking: controller.ptz.tracking, driver: driver.status, hwnd: driver.hwnd },
      dryRun: controller.dryRun,
      bridgeState: controller.bridgeState,
      update: updater.info
    }
  }
  function schedulePush() {
    updateTray()
    if (pushTimer) return
    pushTimer = setTimeout(() => {
      pushTimer = null
      win?.webContents.send(IPC.state, buildState())
    }, 40)
  }
  logger.onEntry = (e) => win?.webContents.send(IPC.logPush, e)

  const updater = new Updater(log)
  updater.onChange = () => {
    updateTray()
    schedulePush()
  }
  // A Windows notification when an update is ready; clicking it opens the "restart and update" question.
  updater.onReady = (v) => {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: 'Update ready',
      body: `EMEET–OBS Bridge ${v} is ready to install. Click here to restart and update.`,
      icon: existsSync(iconPath()) ? iconPath() : undefined
    })
    n.on('click', () => {
      showWindow()
      void updater.promptInstall()
    })
    n.show()
  }
  // First run, or first run after an update with release notes: show the window even if "start hidden" is on.
  const launch = launchInfo(readLastSeenVersion(), version)
  log.info(`Launch: ${launch.kind}${launch.from ? ` (previously ${launch.from})` : ''}`)
  createWindow(c0.general.startHidden && launch.kind === 'normal')
  createTray()
  const dock = startDock({ log, getState: buildState, getConfig: () => store.get(), resync: () => controller.resyncPtz(), openWindow: showWindow, setScenePreset: setSceneMapping, setSceneTracking })

  // ---- start everything ----
  driver.start(c0.emeet)
  if (c0.general.launchObsOnStart) void launchObs(c0)
  obs.start()
  updater.start()

  store.onExternalChange = (cfg) => {
    logger.level = cfg.logging.level
    controller.onConfigChanged()
    win?.webContents.send('config:push', cfg)
  }
  store.watchFile()
  // A normal launch needs no acknowledgement, but remember the version so the next update can say what changed.
  if (launch.kind === 'normal' && launch.from !== version) writeLastSeenVersion(version)

  // ------------------------------------------------------------------ tray ----
  function createTray() {
    let img = nativeImage.createFromPath(iconPath())
    if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 })
    tray = new Tray(img)
    tray.on('click', () => (win?.isVisible() ? win.hide() : showWindow()))
    updateTray()
  }
  function updateTray() {
    if (!tray) return
    const st = obs.status === 'connected' ? 'Connected to OBS' : obs.status === 'connecting' ? 'Connecting to OBS ...' : 'OBS not connected'
    tray.setToolTip(`EMEET–OBS Bridge ${version} - ${st}`)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `EMEET–OBS Bridge ${version}`, enabled: false },
        { label: st + (controller.dryRun ? '  (DRY RUN)' : ''), enabled: false },
        { type: 'separator' },
        { label: 'Show window', click: showWindow },
        {
          label: 'Help',
          click: () => {
            showWindow()
            win?.webContents.send(IPC.openHelp, 'start')
          }
        },
        { label: 'Resync camera', click: () => controller.resyncPtz() },
        { type: 'separator' },
        updater.status === 'ready'
          ? { label: `Restart to update to ${updater.availableVersion} ...`, click: () => void updater.promptInstall() }
          : { label: updater.status === 'downloading' ? `Downloading update ${updater.availableVersion} ...` : 'Check for updates', enabled: updater.status !== 'downloading', click: () => updater.check(true) },
        { type: 'separator' },
        { label: 'Open logs folder', click: () => void shell.openPath(logDir) },
        { label: 'Send diagnostics ...', click: () => void sendDiagnostics() },
        { type: 'separator' },
        { label: 'Quit ...', click: () => void confirmQuit() }
      ])
    )
  }

  // ----------------------------------------------------------- helper actions ----
  async function confirmQuit() {
    const r = await dialog.showMessageBox({
      type: 'warning',
      title: 'Quit EMEET–OBS Bridge?',
      message: 'Quit EMEET–OBS Bridge?',
      detail: 'EMEET presets and transitions will stop following your scenes until you start the app again. Closing the window (X) keeps it running in the tray.',
      buttons: ['Keep running', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (r.response === 1) app.quit()
  }

  const diagStamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  function writeDiagnostics(zipPath: string) {
    buildDiagnosticsZip({
      zipPath,
      logDir,
      cfg: store.get(),
      state: buildState(),
      versions: { app: version, electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
      configPath: store.path
    })
    log.info(`Diagnostics exported: ${zipPath}`)
  }

  async function exportDiagnostics() {
    const r = await dialog.showSaveDialog({
      title: 'Save diagnostics zip',
      defaultPath: join(app.getPath('desktop'), `EMEET-OBS-Bridge-diagnostics-${diagStamp()}.zip`),
      filters: [{ name: 'Zip', extensions: ['zip'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false }
    try {
      writeDiagnostics(r.filePath)
      shell.showItemInFolder(r.filePath)
      return { ok: true, path: r.filePath }
    } catch (e) {
      log.error(`Diagnostics export failed: ${(e as Error).message}`)
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Saves the zip, shows it in its folder and opens the email app with the message ready; the user attaches the zip and sends. */
  async function sendDiagnostics() {
    try {
      const dir = join(app.getPath('userData'), 'diagnostics')
      mkdirSync(dir, { recursive: true })
      const zipPath = join(dir, `EMEET-OBS-Bridge-diagnostics-${diagStamp()}.zip`)
      writeDiagnostics(zipPath)
      shell.showItemInFolder(zipPath)
      if (!SUPPORT_EMAIL) return { ok: true, path: zipPath, emailOpened: false }
      const subject = `EMEET-OBS Bridge ${version} diagnostics`
      const body = `Hi,\r\n\r\nI am sending diagnostics from EMEET-OBS Bridge ${version}.\r\nThe zip file is attached (it is highlighted in the folder that just opened: ${zipPath}).\r\n\r\nWhat happened:\r\n`
      await shell.openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
      log.info('Diagnostics email opened.')
      return { ok: true, path: zipPath, emailOpened: true }
    } catch (e) {
      log.error(`Send diagnostics failed: ${(e as Error).message}`)
      return { ok: false, error: (e as Error).message }
    }
  }

  async function launchObs(cfg: AppConfig) {
    const exe = cfg.general.obsPath
    if (!isWin || !exe) return
    if (!existsSync(exe)) {
      log.error(`OBS path does not exist: ${exe}`)
      return
    }
    const running = await new Promise<boolean>((resolve) => {
      exec('tasklist /FI "IMAGENAME eq obs64.exe" /NH', (_e, out) => resolve(/obs64\.exe/i.test(out ?? '')))
    })
    if (running) {
      log.info('OBS is already running - not launching it again.')
      return
    }
    log.info(`Launching OBS: ${exe}`)
    try {
      // OBS must be started from its own folder or it cannot find its files.
      spawn(exe, [], { cwd: dirname(exe), detached: true, stdio: 'ignore' }).unref()
    } catch (e) {
      log.error(`Could not launch OBS: ${(e as Error).message}`)
    }
  }

  function setSceneMapping(scene: string, presetId: string | null) {
    const before = store.get()
    const after = store.update((c) => {
      // drop any older spelling of the same scene (spacing/dash differences) so there is only one entry
      for (const k of Object.keys(c.scenes)) if (normalizeSceneKey(k) === normalizeSceneKey(scene)) delete c.scenes[k]
      if (presetId) c.scenes[scene] = presetId
    })
    log.info(`Scene mapping: '${scene}' -> ${presetId ?? 'None'}`)
    afterConfigChange(before, after)
    return after
  }
  function setSceneTracking(scene: string, on: boolean) {
    const before = store.get()
    const after = store.update((c) => {
      for (const k of Object.keys(c.sceneTracking)) if (normalizeSceneKey(k) === normalizeSceneKey(scene)) delete c.sceneTracking[k]
      if (on) c.sceneTracking[scene] = true
    })
    log.info(`Scene tracking: '${scene}' -> ${on ? 'ON' : 'off'}`)
    afterConfigChange(before, after)
    return after
  }

  function afterConfigChange(before: AppConfig, after: AppConfig) {
    logger.level = after.logging.level
    controller.onConfigChanged()
    applyStartWithWindows(after)
    if (JSON.stringify(before.obs) !== JSON.stringify(after.obs)) obs.reconnect()
    if (JSON.stringify(before.emeet) !== JSON.stringify(after.emeet) && after.emeet.enabled) driver.ensure(after.emeet)
    win?.webContents.send('config:push', after)
    schedulePush()
  }

  // ------------------------------------------------------------------- IPC ----
  ipcMain.handle(IPC.getState, () => buildState())
  ipcMain.handle(IPC.getLogs, () => logger.tail())
  ipcMain.handle(IPC.getConfig, () => store.get())
  ipcMain.handle(IPC.saveConfig, (_e, cfg: AppConfig) => {
    const before = store.get()
    const after = store.set(cfg)
    log.info('Settings saved.')
    afterConfigChange(before, after)
    return after
  })
  ipcMain.handle(IPC.setSceneMapping, (_e, scene: string, presetId: string | null) => setSceneMapping(scene, presetId))
  ipcMain.handle(IPC.setSceneTracking, (_e, scene: string, on: boolean) => setSceneTracking(scene, on))
  ipcMain.handle(IPC.setTrackingEnabled, (_e, on: boolean) => {
    const before = store.get()
    const after = store.update((c) => (c.tracking.enabled = on))
    log.info(`Enable Tracking (master): ${on ? 'ON' : 'off'}`)
    afterConfigChange(before, after)
    return after
  })
  ipcMain.handle(IPC.resync, () => controller.resyncPtz())
  ipcMain.handle(IPC.testClick, (_e, x: number, y: number, label: string) => {
    const cfg = store.get()
    const cmd: PtzCommand = {
      id: Date.now() % 1e9,
      label,
      presetId: null,
      reason: 'test click from Settings',
      issuedAt: Date.now(),
      clicks: [{ x, y, note: `test: ${label}` }],
      emeet: cfg.emeet
    }
    log.info(`Test click '${label}' at screen(${x},${y})`)
    if (controller.dryRun) log.info('(Dry run is ON - test click not sent)')
    else driver.send(cmd)
  })
  ipcMain.handle(IPC.setDryRun, (_e, on: boolean) => {
    controller.dryRun = on
  })
  ipcMain.handle(IPC.reconnect, () => obs.reconnect())
  ipcMain.handle(IPC.openLogs, () => shell.openPath(logDir))
  ipcMain.handle(IPC.exportDiagnostics, () => exportDiagnostics())
  ipcMain.handle(IPC.sendDiagnostics, () => sendDiagnostics())
  ipcMain.handle(IPC.installUpdate, () => updater.promptInstall())
  ipcMain.handle(IPC.checkUpdate, () => updater.check(true))
  ipcMain.handle(IPC.clearLogsView, () => logger.clearView())
  ipcMain.handle(IPC.getLaunchInfo, () => launch)
  ipcMain.handle(IPC.ackLaunchInfo, () => writeLastSeenVersion(version))
  ipcMain.handle(IPC.browseFile, async (_e, title: string, extensions: string[]) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openFile'], filters: [{ name: 'Files', extensions }] })
    return r.canceled ? null : r.filePaths[0]
  })
  // Developer-only: OMC_SCREENSHOT=/path/file.png saves a picture of the window after a few seconds (used for UI checks).
  if (process.env['OMC_SCREENSHOT']) {
    const out = process.env['OMC_SCREENSHOT']
    setTimeout(async () => {
      try {
        win?.show()
        if (process.env['OMC_SMALL']) win?.setSize(820, 560)
        await new Promise((r) => setTimeout(r, 500))
        const img = await win!.webContents.capturePage()
        require('fs').writeFileSync(out, img.toPNG())
        if (process.env['OMC_SCREENSHOT_TABS']) {
          const wc = win!.webContents
          await wc.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Settings').click()`)
          for (const tab of ['General', 'OBS', 'Transition Rules', 'Camera']) {
            await wc.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(tab)}).click()`)
            await new Promise((r) => setTimeout(r, 400))
            require('fs').writeFileSync(out.replace('.png', `-${tab.replace(/ /g, '')}.png`), (await wc.capturePage()).toPNG())
          }
        }
        log.info(`Screenshot saved: ${out}`)
      } catch (e) {
        log.error(`Screenshot failed: ${(e as Error).message}`)
      }
    }, Number(process.env['OMC_SCREENSHOT_DELAY'] || 6000))
  }

  // ------------------------------------------------------------------ quit ----
  app.on('before-quit', () => {
    quitting = true
    log.info('Shutting down ...')
    controller.dispose()
    dock.close()
    updater.stop()
    obs.stop()
    driver.stop()
    store.close()
    setTimeout(() => logger.close(), 300)
  })
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  })
}
