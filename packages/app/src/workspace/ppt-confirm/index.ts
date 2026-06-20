import { parseHostPort } from "@getdoya/protocol/daemon-endpoints";

export function buildWorkspacePptConfirmUrl(input: {
  activeConnection: { type: string; endpoint: string } | null;
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
    return `http://${baseHost}:${port}${confirmPath}`;
  } catch {
    return confirmPath;
  }
}
