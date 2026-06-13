import os from "node:os";
import path from "node:path";
import { ensurePrivateDirectory } from "./private-files.js";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

export function resolveDoyaHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DOYA_HOME ?? "~/.doya";
  const resolved = path.resolve(expandHomeDir(raw));
  ensurePrivateDirectory(resolved);
  return resolved;
}
