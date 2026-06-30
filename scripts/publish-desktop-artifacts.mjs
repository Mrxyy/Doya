#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import rootPackage from "../package.json" with { type: "json" };

const ALIASES = [
  ["Doya-${version}-arm64.dmg", "latest-mac-arm64.dmg"],
  ["Doya-${version}-x64.dmg", "latest-mac-x64.dmg"],
  ["Doya-Setup-${version}-x64.exe", "latest-windows-x64.exe"],
  ["Doya-Setup-${version}-arm64.exe", "latest-windows-arm64.exe"],
  ["Doya-${version}-x86_64.AppImage", "latest-linux-x86_64.AppImage"],
  ["Doya-${version}-amd64.deb", "latest-linux-amd64.deb"],
  ["Doya-${version}-x86_64.rpm", "latest-linux-x86_64.rpm"],
];

function parseArgs(argv) {
  const args = { source: "packages/desktop/release", out: "/downloads/desktop" };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      args.source = argv[++index];
      continue;
    }
    if (arg === "--out") {
      args.out = argv[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function copyReleaseFiles(sourceDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    fs.copyFileSync(path.join(sourceDir, entry.name), path.join(outDir, entry.name));
  }
}

function refreshAliases(outDir, version) {
  for (const [template, alias] of ALIASES) {
    const fileName = template.replace("${version}", version);
    const sourcePath = path.join(outDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    fs.copyFileSync(sourcePath, path.join(outDir, alias));
    console.log(`Published ${alias} -> ${fileName}`);
  }
}

function main() {
  const { source, out } = parseArgs(process.argv);
  const sourceDir = path.resolve(source);
  const outDir = path.resolve(out);

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Desktop release directory does not exist: ${sourceDir}`);
  }

  copyReleaseFiles(sourceDir, outDir);
  refreshAliases(outDir, rootPackage.version);
}

main();
