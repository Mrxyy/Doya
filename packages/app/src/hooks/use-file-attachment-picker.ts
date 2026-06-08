import { useCallback, useRef } from "react";
import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { persistAttachmentFromBlob, persistAttachmentFromFileUri } from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";
import { isWeb } from "@/constants/platform";
import { translateNow } from "@/i18n/i18n";

interface UseFileAttachmentPickerResult {
  pickFiles: () => Promise<AttachmentMetadata[]>;
}

function normalizePickedMimeType(mimeType: string | undefined): string {
  const trimmed = mimeType?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "application/octet-stream";
}

async function persistDocumentPickerAsset(
  asset: DocumentPicker.DocumentPickerAsset,
): Promise<AttachmentMetadata> {
  const mimeType = normalizePickedMimeType(asset.mimeType);
  if (asset.file) {
    return await persistAttachmentFromBlob({
      blob: asset.file,
      mimeType,
      fileName: asset.name,
    });
  }

  return await persistAttachmentFromFileUri({
    uri: asset.uri,
    mimeType,
    fileName: asset.name,
  });
}

async function pickDesktopFiles(): Promise<AttachmentMetadata[]> {
  const selected = await getDesktopHost()?.dialog?.open?.({
    title: "Add file",
    multiple: true,
  });
  const paths = Array.isArray(selected) ? selected : selected ? [String(selected)] : [];
  return await Promise.all(
    paths.map((path) =>
      persistAttachmentFromFileUri({
        uri: path,
        mimeType: "application/octet-stream",
        fileName: null,
      }),
    ),
  );
}

export function useFileAttachmentPicker(): UseFileAttachmentPickerResult {
  const isPickingRef = useRef(false);

  const pickFiles = useCallback(async () => {
    if (isPickingRef.current) {
      return [];
    }

    isPickingRef.current = true;
    try {
      if (isWeb && isElectronRuntime()) {
        return await pickDesktopFiles();
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
        base64: false,
      });

      if (result.canceled) {
        return [];
      }

      return await Promise.all(result.assets.map(persistDocumentPickerAsset));
    } catch (error) {
      console.error("[FileAttachmentPicker] Failed to pick file:", error);
      Alert.alert(translateNow("ui.error.1410q0"), "Failed to select file.");
      return [];
    } finally {
      isPickingRef.current = false;
    }
  }, []);

  return { pickFiles };
}
