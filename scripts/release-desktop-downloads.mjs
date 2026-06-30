#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import rootPackage from "../package.json" with { type: "json" };

const DEFAULT_ENV_FILE = "docker/.env";
const DEFAULT_REMOTE = "root@64.83.17.170";
const DEFAULT_REMOTE_ENV_FILE = "/opt/doya/docker/.env";
const DEFAULT_REMOTE_DIR = "/opt/doya/downloads/desktop";
const RELEASE_DIR = "packages/desktop/release";
const DESKTOP_BUILD_ARGS = [
  "run",
  "build:desktop",
  "--",
  "--publish",
  "never",
  "--mac",
  "dmg",
  "zip",
  "--win",
  "nsis",
  "zip",
  "--linux",
  "AppImage",
  "deb",
  "rpm",
  "--x64",
  "--arm64",
  "--config.mac.identity=null",
];

const ALIASES = [
  [`Doya-${rootPackage.version}-arm64.dmg`, "latest-mac-arm64.dmg"],
  [`Doya-${rootPackage.version}-x64.dmg`, "latest-mac-x64.dmg"],
  [`Doya-Setup-${rootPackage.version}-x64.exe`, "latest-windows-x64.exe"],
  [`Doya-Setup-${rootPackage.version}-arm64.exe`, "latest-windows-arm64.exe"],
  [`Doya-${rootPackage.version}-x86_64.AppImage`, "latest-linux-x86_64.AppImage"],
  [`Doya-${rootPackage.version}-amd64.deb`, "latest-linux-amd64.deb"],
  [`Doya-${rootPackage.version}-x86_64.rpm`, "latest-linux-x86_64.rpm"],
];

function parseArgs(argv) {
  const args = {
    envFile: DEFAULT_ENV_FILE,
    remote: DEFAULT_REMOTE,
    remoteEnvFile: DEFAULT_REMOTE_ENV_FILE,
    remoteDir: DEFAULT_REMOTE_DIR,
    skipEnvSync: false,
    skipDockerBuild: false,
    skipDesktopBuild: false,
    skipUpload: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      args.envFile = argv[++index];
      continue;
    }
    if (arg === "--remote") {
      args.remote = argv[++index];
      continue;
    }
    if (arg === "--remote-env-file") {
      args.remoteEnvFile = argv[++index];
      continue;
    }
    if (arg === "--remote-dir") {
      args.remoteDir = argv[++index];
      continue;
    }
    if (arg === "--skip-env-sync") {
      args.skipEnvSync = true;
      continue;
    }
    if (arg === "--skip-docker-build") {
      args.skipDockerBuild = true;
      continue;
    }
    if (arg === "--skip-desktop-build") {
      args.skipDesktopBuild = true;
      continue;
    }
    if (arg === "--skip-upload") {
      args.skipUpload = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function parseEnvFile(path) {
  const result = {};
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();
    result[key] = unquoteEnvValue(rawValue);
  }
  return result;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  execFileSync(command, args, {
    env: options.env ?? process.env,
    stdio: "inherit",
  });
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function dirname(path) {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function syncEnvFile(args) {
  run("ssh", [args.remote, `mkdir -p ${shellQuote(dirname(args.remoteEnvFile))}`]);
  run("scp", [args.envFile, `${args.remote}:${args.remoteEnvFile}`]);
}

function refreshAliases(remote, remoteDir) {
  const commands = [`cd ${shellQuote(remoteDir)}`];
  for (const [source, alias] of ALIASES) {
    commands.push(
      `[ -f ${shellQuote(source)} ] && cp ${shellQuote(source)} ${shellQuote(alias)} || true`,
    );
  }
  run("ssh", [remote, commands.join("\n")]);
}

function main() {
  const args = parseArgs(process.argv);
  if (!existsSync(args.envFile)) {
    throw new Error(`Env file does not exist: ${args.envFile}`);
  }

  const env = {
    ...process.env,
    ...parseEnvFile(args.envFile),
  };

  if (!args.skipEnvSync) {
    syncEnvFile(args);
  }

  if (!args.skipDockerBuild) {
    run("docker", ["compose", "--env-file", args.envFile, "build", "server", "control", "app"], {
      env,
    });
  }

  if (!args.skipDesktopBuild) {
    if (process.platform !== "darwin") {
      throw new Error("Desktop download packages are built from the macOS host.");
    }
    run("npm", DESKTOP_BUILD_ARGS, { env });
  }

  if (args.skipUpload) {
    return;
  }

  if (!existsSync(RELEASE_DIR)) {
    throw new Error(`Desktop release directory does not exist: ${RELEASE_DIR}`);
  }

  run("ssh", [args.remote, `mkdir -p ${shellQuote(args.remoteDir)}`]);
  run("rsync", ["-av", `${RELEASE_DIR}/`, `${args.remote}:${args.remoteDir}/`]);
  refreshAliases(args.remote, args.remoteDir);
}

main();
