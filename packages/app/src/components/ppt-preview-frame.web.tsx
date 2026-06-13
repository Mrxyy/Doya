import { createElement, useEffect, useRef } from "react";

interface PptPreviewFrameProps {
  title: string;
  url: string;
  onApplyAnnotations: () => void;
  applyAnnotationsCompletionToken: number;
}

interface PptPreviewMessage {
  source: "doya-ppt-preview";
  type: "doya:ppt-preview:apply-annotations";
}

const IFRAME_STYLE = {
  border: 0,
  flex: 1,
  width: "100%",
  height: "100%",
  background: "transparent",
} as const;

function isPptPreviewApplyMessage(value: unknown): value is PptPreviewMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Partial<PptPreviewMessage>;
  return (
    message.source === "doya-ppt-preview" && message.type === "doya:ppt-preview:apply-annotations"
  );
}

export function PptPreviewFrame({
  title,
  url,
  onApplyAnnotations,
  applyAnnotationsCompletionToken,
}: PptPreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (!isPptPreviewApplyMessage(event.data)) {
        return;
      }
      onApplyAnnotations();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onApplyAnnotations]);

  useEffect(() => {
    if (applyAnnotationsCompletionToken === 0) {
      return;
    }
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: "doya",
        type: "doya:ppt-preview:apply-annotations-complete",
      },
      "*",
    );
  }, [applyAnnotationsCompletionToken]);

  // eslint-disable-next-line react/iframe-missing-sandbox -- The built-in PPT preview needs scripts plus same-origin API/file access from the Doya daemon.
  return createElement("iframe", {
    ref: iframeRef,
    src: url,
    title,
    style: IFRAME_STYLE,
    allow: "clipboard-read; clipboard-write",
  });
}
