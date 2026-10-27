import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { Api } from '@shared/api'

const api: Api = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  getLogs: () => ipcRenderer.invoke(IPC.getLogs),
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  saveConfig: (cfg) => ipcRenderer.invoke(IPC.saveConfig, cfg),
  setSceneMapping: (scene, presetId) => ipcRenderer.invoke(IPC.setSceneMapping, scene, presetId),
  setSceneTracking: (scene, on) => ipcRenderer.invoke(IPC.setSceneTracking, scene, on),
  setTrackingEnabled: (on) => ipcRenderer.invoke(IPC.setTrackingEnabled, on),
  resync: () => ipcRenderer.invoke(IPC.resync),
  testClick: (x, y, label) => ipcRenderer.invoke(IPC.testClick, x, y, label),
  setDryRun: (on) => ipcRenderer.invoke(IPC.setDryRun, on),
  reconnect: () => ipcRenderer.invoke(IPC.reconnect),
  openLogs: () => ipcRenderer.invoke(IPC.openLogs),
  exportDiagnostics: () => ipcRenderer.invoke(IPC.exportDiagnostics),
  sendDiagnostics: () => ipcRenderer.invoke(IPC.sendDiagnostics),
  chooseHoldingCard: () => ipcRenderer.invoke(IPC.chooseHoldingCard),
  removeHoldingCard: () => ipcRenderer.invoke(IPC.removeHoldingCard),
  holdingCardPreview: () => ipcRenderer.invoke(IPC.holdingCardPreview),
  pluginCheck: () => ipcRenderer.invoke(IPC.pluginCheck),
  pluginInstall: () => ipcRenderer.invoke(IPC.pluginInstall),
  pluginRisk: (accept) => ipcRenderer.invoke(IPC.pluginRisk, accept),
  openObs: () => ipcRenderer.invoke(IPC.openObs),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate),
  browseFile: (title, extensions) => ipcRenderer.invoke(IPC.browseFile, title, extensions),
  clearLogView: () => ipcRenderer.invoke(IPC.clearLogsView),
  getLaunchInfo: () => ipcRenderer.invoke(IPC.getLaunchInfo),
  ackLaunchInfo: () => ipcRenderer.invoke(IPC.ackLaunchInfo),
  onOpenHelp: (cb) => {
    const h = (_: unknown, t: string) => cb(t)
    ipcRenderer.on(IPC.openHelp, h)
    return () => ipcRenderer.removeListener(IPC.openHelp, h)
  },
  onOpenSettings: (cb) => {
    const h = (_: unknown, t: string) => cb(t)
    ipcRenderer.on(IPC.openSettings, h)
    return () => ipcRenderer.removeListener(IPC.openSettings, h)
  },
  onState: (cb) => {
    const h = (_: unknown, s: any) => cb(s)
    ipcRenderer.on(IPC.state, h)
    return () => ipcRenderer.removeListener(IPC.state, h)
  },
  onLog: (cb) => {
    const h = (_: unknown, e: any) => cb(e)
    ipcRenderer.on(IPC.logPush, h)
    return () => ipcRenderer.removeListener(IPC.logPush, h)
  },
  onConfig: (cb) => {
    const h = (_: unknown, c: any) => cb(c)
    ipcRenderer.on('config:push', h)
    return () => ipcRenderer.removeListener('config:push', h)
  }
}

contextBridge.exposeInMainWorld('api', api)
