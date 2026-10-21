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
  browseFile: (title, extensions) => ipcRenderer.invoke(IPC.browseFile, title, extensions),
  clearLogView: () => ipcRenderer.invoke(IPC.clearLogsView),
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
