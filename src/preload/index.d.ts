import { ElectronAPI } from '@electron-toolkit/preload'
import type { LumeApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: LumeApi
  }
}
