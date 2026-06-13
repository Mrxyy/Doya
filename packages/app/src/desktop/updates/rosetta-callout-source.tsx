import { useEffect, useState } from "react";
import { SidebarCalloutDescriptionText } from "@/components/sidebar-callout";
import { getIsElectronMac } from "@/constants/platform";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import {
  buildMacAppleSiliconDownloadUrl,
  getDesktopRuntimeInfo,
  type DesktopRuntimeInfo,
} from "@/desktop/updates/desktop-updates";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openExternalUrl } from "@/utils/open-external-url";
import { translateNow } from "@/i18n/i18n";

const FALLBACK_DOWNLOAD_URL = "https://doya.sh/download";

function RosettaCalloutDescription() {
  return (
    <>
      <SidebarCalloutDescriptionText>
        {translateNow("ui.you.apostrophe.re.running.the.intel.build.ybbi2z")}
      </SidebarCalloutDescriptionText>
      <SidebarCalloutDescriptionText>
        {translateNow("ui.this.causes.high.cpu.usage.download.the.1fyyeq")}
      </SidebarCalloutDescriptionText>
    </>
  );
}

export function RosettaCalloutSource() {
  const callouts = useSidebarCallouts();
  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);
  const isElectronMac = getIsElectronMac();

  const openDownload = useStableEvent(() => {
    const downloadUrl =
      buildMacAppleSiliconDownloadUrl(runtimeInfo?.appVersion) ?? FALLBACK_DOWNLOAD_URL;
    void openExternalUrl(downloadUrl);
  });

  useEffect(() => {
    if (!isElectronMac) {
      return;
    }

    let cancelled = false;

    void getDesktopRuntimeInfo()
      .then((nextRuntimeInfo) => {
        if (!cancelled) {
          setRuntimeInfo(nextRuntimeInfo);
        }
        return nextRuntimeInfo;
      })
      .catch((error) => {
        console.warn("[RosettaCallout] Failed to load desktop runtime info", error);
      });

    return () => {
      cancelled = true;
    };
  }, [isElectronMac]);

  useEffect(() => {
    if (!isElectronMac || runtimeInfo?.runningUnderARM64Translation !== true) {
      return;
    }

    return callouts.show({
      id: "desktop-rosetta-warning",
      priority: 300,
      title: translateNow("ui.download.the.apple.silicon.build.1xlz9rk"),
      description: <RosettaCalloutDescription />,
      variant: "error",
      dismissible: false,
      actions: [
        {
          label: translateNow("ui.download.ooknmw"),
          onPress: openDownload,
          variant: "primary",
        },
      ],
      testID: "rosetta-callout",
    });
  }, [callouts, isElectronMac, openDownload, runtimeInfo]);

  return null;
}
