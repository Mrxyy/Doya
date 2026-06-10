import { useEffect, useRef, useState } from "react";
import type { AttachmentMetadata } from "@/attachments/types";
import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";

type PreviewableAttachment = AttachmentMetadata & {
  fallbackPreviewUrl?: string | null;
};

export function useAttachmentPreviewUrl(
  attachment: PreviewableAttachment | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const activeAttachmentRef = useRef<PreviewableAttachment | null>(null);
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;

  const id = attachment?.id;
  const storageType = attachment?.storageType;
  const storageKey = attachment?.storageKey;
  const mimeType = attachment?.mimeType;
  const fallbackPreviewUrl = attachment?.fallbackPreviewUrl ?? null;
  const directFallbackPreviewUrl = getDirectFallbackPreviewUrl(fallbackPreviewUrl);

  useEffect(() => {
    let disposed = false;
    let currentUrl: string | null = null;
    let shouldReleaseCurrentUrl = false;
    const current = attachmentRef.current;

    activeAttachmentRef.current = current ?? null;
    if (!current) {
      setUrl(null);
      return;
    }

    void (async () => {
      try {
        const resolved = directFallbackPreviewUrl ?? (await resolveAttachmentPreviewUrl(current));
        if (disposed) {
          if (!directFallbackPreviewUrl) {
            await releaseAttachmentPreviewUrl({ attachment: current, url: resolved });
          }
          return;
        }
        currentUrl = resolved;
        shouldReleaseCurrentUrl = !directFallbackPreviewUrl;
        setUrl(resolved);
      } catch (error) {
        console.error("[attachments] Failed to resolve preview URL", {
          attachmentId: current.id,
          error,
        });
        if (!disposed) {
          setUrl(null);
        }
      }
    })();

    return () => {
      disposed = true;
      const activeAttachment = activeAttachmentRef.current;
      if (!currentUrl || !activeAttachment || !shouldReleaseCurrentUrl) {
        return;
      }
      void releaseAttachmentPreviewUrl({
        attachment: activeAttachment,
        url: currentUrl,
      });
    };
  }, [id, storageType, storageKey, mimeType, directFallbackPreviewUrl]);

  return url;
}

function getDirectFallbackPreviewUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return /^(blob:|data:|https?:)/i.test(trimmed) ? trimmed : null;
}
