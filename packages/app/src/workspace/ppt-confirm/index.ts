import { parseHostPort } from "@getdoya/protocol/daemon-endpoints";

export function buildWorkspacePptConfirmUrl(input: {
  activeConnection: { type: string; endpoint: string; useTls?: boolean } | null;
  agentId: string;
  projectName: string;
}): string {
  const confirmPath = `/ppt-confirm/${encodeURIComponent(input.agentId)}/${encodeURIComponent(
    input.projectName,
  )}`;
  if (input.activeConnection?.type !== "directTcp") {
    return confirmPath;
  }
  try {
    const { host, port, isIpv6 } = parseHostPort(input.activeConnection.endpoint);
    const baseHost = isIpv6 ? `[${host}]` : host;
    const scheme = input.activeConnection.useTls === true ? "https" : "http";
    const portSuffix =
      (scheme === "https" && port === 443) || (scheme === "http" && port === 80) ? "" : `:${port}`;
    return `${scheme}://${baseHost}${portSuffix}${confirmPath}`;
  } catch {
    return confirmPath;
  }
}
