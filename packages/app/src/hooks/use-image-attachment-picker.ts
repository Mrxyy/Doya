import { useCallback, useRef } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import {
  normalizePickedImageAssets,
  openImagePathsWithDesktopDialog,
  type PickedImageAttachmentInput,
} from "@/hooks/image-attachment-picker";
import { isWeb } from "@/constants/platform";
import { translateNow } from "@/i18n/i18n";

interface UseImageAttachmentPickerResult {
  pickImages: () => Promise<PickedImageAttachmentInput[] | null>;
}

export function useImageAttachmentPicker(): UseImageAttachmentPickerResult {
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();
  const isPickingRef = useRef(false);

  const ensurePermission = useCallback(async () => {
    let currentPermission = mediaPermission;

    if (
      !currentPermission ||
      currentPermission.status === ImagePicker.PermissionStatus.UNDETERMINED
    ) {
      currentPermission = await requestMediaPermission();
    } else if (!currentPermission.granted) {
      currentPermission = await requestMediaPermission();
    }

    if (!currentPermission?.granted) {
      Alert.alert(
        translateNow("ui.permission.required.qkb4c0"),
        translateNow("ui.please.allow.access.to.your.photo.library.bi1xfa"),
      );
      return false;
    }

    return true;
  }, [mediaPermission, requestMediaPermission]);

  const pickImages = useCallback(async () => {
    if (isPickingRef.current) {
      return null;
    }

    isPickingRef.current = true;

    try {
      if (isWeb && isElectronRuntime()) {
        const selectedPaths = await openImagePathsWithDesktopDialog(getDesktopHost()?.dialog);
        if (selectedPaths.length === 0) {
          return null;
        }
        return selectedPaths.map((path) => ({
          source: { kind: "file_uri" as const, uri: path },
          mimeType: null,
          fileName: null,
        }));
      }

      const hasPermission = await ensurePermission();
      if (!hasPermission) {
        return null;
      }

      const pendingResult = await ImagePicker.getPendingResultAsync();
      if (pendingResult && "canceled" in pendingResult && !pendingResult.canceled) {
        return await normalizePickedImageAssets(pendingResult.assets);
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"] as ImagePicker.MediaType[],
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (result.canceled) {
        return null;
      }

      return await normalizePickedImageAssets(result.assets);
    } catch (error) {
      console.error("[ImageAttachmentPicker] Failed to pick image:", error);
      Alert.alert(
        translateNow("ui.error.1410q0"),
        translateNow("ui.failed.to.select.image.d0ec55"),
      );
      return null;
    } finally {
      isPickingRef.current = false;
    }
  }, [ensurePermission]);

  return { pickImages };
}
