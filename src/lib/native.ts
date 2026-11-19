import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** True only inside the installed Android (Capacitor) app. */
export const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

/** Custom native plugin implemented in android/.../ApkInstallerPlugin.java */
export interface ApkInstallerPlugin {
  /** Whether Android currently lets this app install APKs ("install unknown apps"). */
  canInstall(): Promise<{ allowed: boolean }>;
  /** Opens the system screen where the user grants the permission above. */
  openInstallSettings(): Promise<void>;
  /** Downloads the APK (GitHub release asset) and opens the system installer. */
  downloadAndInstall(options: { url: string }): Promise<void>;
  /** Opens a URL in the matching external app (browser, WhatsApp, ...). */
  openUrl(options: { url: string }): Promise<void>;
  addListener(
    eventName: "downloadProgress",
    listener: (e: { percent: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export const ApkInstaller = registerPlugin<ApkInstallerPlugin>("ApkInstaller");

/** Opens an external link. Falls back to same-tab navigation if the browser blocks the popup (iOS PWA). */
export async function openExternal(url: string) {
  if (isAndroidApp()) {
    try {
      await ApkInstaller.openUrl({ url });
      return;
    } catch {
      /* fall through to the web behaviour */
    }
  }
  const w = window.open(url, "_blank");
  if (!w) window.location.href = url;
}
