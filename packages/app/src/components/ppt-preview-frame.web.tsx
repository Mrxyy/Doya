import { createElement } from "react";

interface PptPreviewFrameProps {
  title: string;
  url: string;
}

const IFRAME_STYLE = {
  border: 0,
  flex: 1,
  width: "100%",
  height: "100%",
  background: "transparent",
} as const;

export function PptPreviewFrame({ title, url }: PptPreviewFrameProps) {
  // eslint-disable-next-line react/iframe-missing-sandbox -- The built-in PPT preview needs scripts plus same-origin API/file access from the Paseo daemon.
  return createElement("iframe", {
    src: url,
    title,
    style: IFRAME_STYLE,
    allow: "clipboard-read; clipboard-write",
  });
}
