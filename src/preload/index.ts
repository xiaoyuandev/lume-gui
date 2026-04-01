import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppSettings, CreateVmInput, LumeApi, UpdateVmInput } from '../shared/types'

const api: LumeApi = {
  getStatus: () => ipcRenderer.invoke('lume:getStatus'),
  listVms: () => ipcRenderer.invoke('lume:listVms'),
  getVm: (name) => ipcRenderer.invoke('lume:getVm', name),
  createVm: (input: CreateVmInput) => ipcRenderer.invoke('lume:createVm', input),
  startVm: (name) => ipcRenderer.invoke('lume:startVm', name),
  stopVm: (name) => ipcRenderer.invoke('lume:stopVm', name),
  deleteVm: (name) => ipcRenderer.invoke('lume:deleteVm', name),
  updateVm: (input: UpdateVmInput) => ipcRenderer.invoke('lume:updateVm', input),
  getVmLogs: (name) => ipcRenderer.invoke('lume:getVmLogs', name),
  listImages: () => ipcRenderer.invoke('lume:listImages'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input: AppSettings) => ipcRenderer.invoke('settings:save', input),
  chooseDirectory: () => ipcRenderer.invoke('dialog:chooseDirectory'),
  chooseFile: (filters) => ipcRenderer.invoke('dialog:chooseFile', filters),
  restartServe: () => ipcRenderer.invoke('lume:restartServe')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
