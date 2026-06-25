import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { createControlApp } from "./http/app.js";
import { resolveControlStorePath } from "./db/home.js";
import { ControlStore } from "./store.js";

export interface StartControlServerInput {
  host?: string;
  port?: number;
  storePath?: string;
}

export async function startControlServer(input: StartControlServerInput = {}) {
  loadLocalDockerEnvFile();
  const app = createControlApp(
    new ControlStore({
      filePath: resolveControlStorePath({ filePath: input.storePath }),
    }),
  );
  const server = http.createServer(app);
  const host = input.host ?? process.env.DOYA_CONTROL_HOST ?? "127.0.0.1";
  const port = input.port ?? Number(process.env.DOYA_CONTROL_PORT ?? "6777");

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  return {
    server,
    host,
    port,
    url: `http://${host}:${port}`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtime = await startControlServer();
  process.stdout.write(`Doya control listening on ${runtime.url}\n`);
}

function loadLocalDockerEnvFile(): void {
  const envFilePath = "docker/.env";
  if (!existsSync(envFilePath)) {
    return;
  }

  const content = readFileSync(envFilePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = parseEnvValue(line.slice(separatorIndex + 1).trim());
  }
}

function parseEnvValue(value: string): string {
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}
