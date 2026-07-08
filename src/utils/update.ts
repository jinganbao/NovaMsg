import {check} from '@tauri-apps/plugin-updater'
import {relaunch} from '@tauri-apps/plugin-process'

export async function checkAppUpdate() {
  const update = await check()

  if (!update) {
    return {
      hasUpdate: false,
      message: '当前已是最新版本'
    }
  }

  return {
    hasUpdate: true,
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
    downloadAndInstall: async () => {
      await update.downloadAndInstall()
      await relaunch()
    }
  }
}