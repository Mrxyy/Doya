import http from "node:http";
import { createControlApp } from "./http/app.js";
import { resolveControlStorePath } from "./db/home.js";
import { ControlStore } from "./store.js";

export interface StartControlServerInput {
  host?: string;
  port?: number;
  storePath?: string;
}

export async function startControlServer(input: StartControlServerInput = {}) {
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
