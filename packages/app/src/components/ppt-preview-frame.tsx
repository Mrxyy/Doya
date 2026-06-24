import { useCallback, useEffect, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

interface PptPreviewFrameProps {
  title: string;
  url: string;
  onApplyAnnotations: () => void;
  applyAnnotationsCompletionToken: number;
  onConfirm?: () => void;
}

const WEBVIEW_STYLE = { flex: 1 } as const;

function isApplyAnnotationsMessage(data: string): boolean {
  try {
    const message = JSON.parse(data) as {
      source?: string;
      type?: string;
    };
    return (
      message.source === "doya-ppt-preview" && message.type === "doya:ppt-preview:apply-annotations"
    );
  } catch {
    return false;
  }
}

function isConfirmMessage(data: string): boolean {
  try {
    const message = JSON.parse(data) as {
      source?: string;
      type?: string;
    };
    return message.source === "doya-ppt-confirm" && message.type === "doya:ppt-confirm:confirm";
  } catch {
    return false;
  }
}

function buildApplyAnnotationsCompleteScript(): string {
  return `
window.dispatchEvent(new MessageEvent("message", {
  data: {
    source: "doya",
    type: "doya:ppt-preview:apply-annotations-complete"
  }
}));
true;
`;
}

export function PptPreviewFrame({
  url,
  onApplyAnnotations,
  applyAnnotationsCompletionToken,
  onConfirm,
}: PptPreviewFrameProps) {
  const webViewRef = useRef<WebView>(null);
  const source = useMemo(() => ({ uri: url }), [url]);
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (isApplyAnnotationsMessage(event.nativeEvent.data)) {
        onApplyAnnotations();
      }
      if (isConfirmMessage(event.nativeEvent.data)) {
        onConfirm?.();
      }
    },
    [onApplyAnnotations, onConfirm],
  );

  useEffect(() => {
    if (applyAnnotationsCompletionToken === 0) {
      return;
    }
    webViewRef.current?.injectJavaScript(buildApplyAnnotationsCompleteScript());
  }, [applyAnnotationsCompletionToken]);

  return (
    <WebView ref={webViewRef} onMessage={handleMessage} source={source} style={WEBVIEW_STYLE} />
  );
}
