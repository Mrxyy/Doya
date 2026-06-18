import os from "node:os";
import path from "node:path";

export function resolveControlStorePath(input?: { home?: string; filePath?: string }): string {
  if (input?.filePath) {
    return input.filePath;
  }
  const home =
    input?.home ?? process.env.DOYA_CONTROL_HOME ?? path.join(os.homedir(), ".doya-control");
  return path.join(home, "control.json");
}
