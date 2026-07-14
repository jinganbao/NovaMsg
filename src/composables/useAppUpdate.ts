/**
 * 应用更新逻辑
 * - 手动/自动检查更新
 * - 下载进度展示
 * - 取消下载
 * - 下载完成后重启
 */
import { ref, computed } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { checkAppUpdate, type UpdateResult } from "@/utils/update";

export function useAppUpdate(
  config: { autoCheckUpdate: boolean },
  message: { success: (m: string) => void; error: (m: string) => void; warning: (m: string) => void },
) {
  const checkingUpdate = ref(false);
  const showUpdateModal = ref(false);
  const updateInfo = ref<UpdateResult | null>(null);
  const installingUpdate = ref(false);
  const cancellingUpdate = ref(false);
  const updateDownloaded = ref(0);
  const updateTotal = ref(0);
  const updateProgressLabel = ref("");
  const currentVersion = ref("");
  const latestVersion = ref("");

  const updateProgressPercentage = computed(() => {
    if (updateTotal.value > 0) {
      return Math.min(100, Math.round((updateDownloaded.value / updateTotal.value) * 100));
    }
    return 0;
  });

  function errMsg(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e ?? "未知错误");
  }

  async function checkForUpdates(options?: { silent?: boolean }) {
    checkingUpdate.value = true;
    try {
      if (!currentVersion.value) {
        currentVersion.value = await getVersion();
      }
      const result = await checkAppUpdate();
      updateInfo.value = result;
      latestVersion.value = result.hasUpdate
        ? result.version ?? ""
        : result.currentVersion ?? currentVersion.value;

      if (!result.hasUpdate) {
        if (options?.silent) return;
        showUpdateModal.value = true;
        return;
      }

      // 有更新则总是显示弹窗
      showUpdateModal.value = true;
    } catch (e) {
      if (!options?.silent) {
        message.error("检查更新失败: " + errMsg(e));
      }
    } finally {
      checkingUpdate.value = false;
    }
  }

  async function loadCurrentVersion() {
    if (currentVersion.value) return;
    try {
      currentVersion.value = await getVersion();
    } catch {
      currentVersion.value = "";
    }
  }

  async function handleUpdateDownload() {
    if (!updateInfo.value?.downloadAndInstall) return;
    installingUpdate.value = true;
    updateDownloaded.value = 0;
    updateTotal.value = 0;
    updateProgressLabel.value = "正在下载更新...";
    try {
      await updateInfo.value.downloadAndInstall((progress) => {
        if (progress.total > 0) {
          updateTotal.value = progress.total;
        }
        updateDownloaded.value = progress.downloaded;
        if (updateTotal.value > 0) {
          const downloadedMB = (updateDownloaded.value / 1024 / 1024).toFixed(1);
          const totalMB = (updateTotal.value / 1024 / 1024).toFixed(1);
          updateProgressLabel.value = `正在下载更新... ${downloadedMB} / ${totalMB} MB`;
        } else {
          const downloadedMB = (updateDownloaded.value / 1024 / 1024).toFixed(1);
          updateProgressLabel.value = `正在下载更新... ${downloadedMB} MB`;
        }
      });
    } catch (e) {
      if (cancellingUpdate.value) {
        message.warning("已取消更新");
      } else {
        message.error("安装更新失败: " + errMsg(e));
      }
    } finally {
      installingUpdate.value = false;
      cancellingUpdate.value = false;
    }
  }

  function cancelUpdateDownload() {
    cancellingUpdate.value = true;
    updateInfo.value?.cancel();
  }

  /** 启动时自动检查更新（静默模式，仅 config.autoCheckUpdate 为 true 时执行） */
  async function autoCheckOnStartup() {
    await loadCurrentVersion();
    if (!config.autoCheckUpdate) return;
    await checkForUpdates({ silent: true });
  }

  return {
    checkingUpdate,
    showUpdateModal,
    updateInfo,
    installingUpdate,
    cancellingUpdate,
    updateDownloaded,
    updateTotal,
    updateProgressLabel,
    updateProgressPercentage,
    currentVersion,
    latestVersion,
    loadCurrentVersion,
    checkForUpdates,
    handleUpdateDownload,
    cancelUpdateDownload,
    autoCheckOnStartup,
  };
}
