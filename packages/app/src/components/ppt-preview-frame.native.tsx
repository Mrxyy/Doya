import { useMemo } from "react";
import { WebView } from "react-native-webview";

interface PptPreviewFrameProps {
  title: string;
  url: string;
}

const WEBVIEW_STYLE = { flex: 1 } as const;

export function PptPreviewFrame({ url }: PptPreviewFrameProps) {
  const source = useMemo(() => ({ uri: url }), [url]);
  return <WebView source={source} style={WEBVIEW_STYLE} />;
}
