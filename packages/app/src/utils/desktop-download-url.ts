import { isWeb } from "@/constants/platform";

const DEFAULT_DESKTOP_DOWNLOAD_BASE_URL = "/downloads/desktop";

type DesktopDownloadTarget = "mac-arm64" | "mac-x64" | "windows-x64" | "linux-appimage";

const DESKTOP_DOWNLOAD_FILE_BY_TARGET: Record<DesktopDownloadTarget, string> = {
  "mac-arm64": "latest-mac-arm64.dmg",
  "mac-x64": "latest-mac-x64.dmg",
  "windows-x64": "latest-windows-x64.exe",
  "linux-appimage": "latest-linux-x86_64.AppImage",
};

export function resolveDesktopDownloadUrl(): string {
  const fileName = DESKTOP_DOWNLOAD_FILE_BY_TARGET[detectDesktopDownloadTarget()];
  return joinUrlPath(DEFAULT_DESKTOP_DOWNLOAD_BASE_URL, fileName);
}

function detectDesktopDownloadTarget(): DesktopDownloadTarget {
  if (!isWeb || typeof navigator === "undefined") {
    return "mac-arm64";
  }

  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("win")) {
    return "windows-x64";
  }

  if (userAgent.includes("linux")) {
    return "linux-appimage";
  }

  if (userAgent.includes("mac")) {
    const architecture = (
      navigator as unknown as { userAgentData?: { architecture?: string } }
    ).userAgentData?.architecture?.toLowerCase();
    return architecture === "x86" || architecture === "x86_64" ? "mac-x64" : "mac-arm64";
  }

  return "mac-arm64";
}

function joinUrlPath(baseUrl: string, fileName: string): string {
  const url = `${baseUrl.replace(/\/+$/, "")}/${fileName}`;
  if (isWeb && typeof window !== "undefined" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return new URL(url, window.location.origin).toString();
  }

  return url;
}
