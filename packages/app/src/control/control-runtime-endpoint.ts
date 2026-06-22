import { normalizeHostPort } from "@/utils/daemon-endpoints";

export interface ControlRuntimeDirectEndpoint {
  endpoint: string;
  useTls: boolean;
}

export function resolveControlRuntimeDirectEndpoint(
  endpoint: string,
): ControlRuntimeDirectEndpoint {
  try {
    const parsed = new URL(endpoint.includes("://") ? endpoint : `tcp://${endpoint}`);
    const useTls = parsed.protocol === "https:" || parsed.protocol === "wss:";
    const defaultPort = useTls ? "443" : "80";
    return {
      endpoint: normalizeHostPort(`${parsed.hostname}:${parsed.port || defaultPort}`),
      useTls,
    };
  } catch {
    return {
      endpoint: normalizeHostPort(endpoint),
      useTls: false,
    };
  }
}
