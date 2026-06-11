import { useCallback, useEffect, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

interface PptPreviewFrameProps {
  title: string;
  url: string;
  onApplyAnnotations: () => void;
  applyAnnotationsCompletionToken: number;
}

const WEBVIEW_STYLE = { flex: 1 } as const;

function isApplyAnnotationsMessage(data: string): boolean {
  try {
    const message = JSON.parse(data) as {
      source?: string;
      type?: string;
    };
    return (
      message.source === "paseo-ppt-preview" &&
      message.type === "paseo:ppt-preview:apply-annotations"
    );
  } catch {
    return false;
  }
}

function buildApplyAnnotationsCompleteScript(): string {
  return `
window.dispatchEvent(new MessageEvent("message", {
  data: {
    source: "paseo",
    type: "paseo:ppt-preview:apply-annotations-complete"
  }
}));
true;
`;
}

export function PptPreviewFrame({
  url,
  onApplyAnnotations,
  applyAnnotationsCompletionToken,
}: PptPreviewFrameProps) {
  const webViewRef = useRef<WebView>(null);
  const source = useMemo(() => ({ uri: url }), [url]);
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (isApplyAnnotationsMessage(event.nativeEvent.data)) {
        onApplyAnnotations();
      }
    },
    [onApplyAnnotations],
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
