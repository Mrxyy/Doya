const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.join(__dirname, "..");
const outputRoot = path.join(desktopRoot, ".generated", "codex");
const CODEX_PACKAGE_NAME = "@openai/codex";

const PLATFORM_PACKAGE_BY_TARGET = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
};

function resolveTargetTriple(platform, arch) {
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-musl";
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-musl";
  if (platform === "win32" && arch === "arm64") return "aarch64-pc-windows-msvc";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  throw new Error(`Unsupported Codex bundle target: ${platform}/${arch}`);
}

function resolveCodexOnPath() {
  const command = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? ["codex"] : ["-v", "codex"];
  const options = process.platform === "win32" ? {} : { shell: true };
  const output = execFileSync(command, args, {
    ...options,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.trim().split(/\r?\n/)[0];
}

function assertExecutable(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Codex executable not found: ${filePath}`);
  }
  fs.accessSync(filePath, fs.constants.X_OK);
}

function candidateVendorDirs(codexEntry, targetTriple) {
  const realEntry = fs.realpathSync(codexEntry);
  const packageRoot = path.dirname(path.dirname(realEntry));
  return candidatePackageVendorDirs(packageRoot, targetTriple);
}

function candidatePackageVendorDirs(packageRoot, targetTriple) {
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  const platformPackageRoot = resolveOptionalPackageRoot(platformPackage);
  return [
    ...(platformPackageRoot ? [path.join(platformPackageRoot, "vendor", targetTriple)] : []),
    path.join(packageRoot, "node_modules", platformPackage, "vendor", targetTriple),
    path.join(packageRoot, "vendor", targetTriple),
  ];
}

function resolveOptionalPackageRoot(packageName) {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`, { paths: [desktopRoot] }));
  } catch {
    return null;
  }
}

function resolveCodexPackageRoot() {
  try {
    return path.dirname(
      require.resolve(`${CODEX_PACKAGE_NAME}/package.json`, { paths: [desktopRoot] }),
    );
  } catch {
    return null;
  }
}

function resolveCodexPackageSource(targetTriple) {
  const packageRoot = resolveCodexPackageRoot();
  if (!packageRoot) {
    return null;
  }

  for (const candidate of candidatePackageVendorDirs(packageRoot, targetTriple)) {
    if (fs.existsSync(path.join(candidate, "bin", codexBinaryName(targetTriple)))) {
      return { kind: "vendor-dir", path: candidate };
    }
  }

  const entry = path.join(packageRoot, "bin", "codex.js");
  return fs.existsSync(entry) ? { kind: "binary", path: entry } : null;
}

function resolveSource(targetTriple) {
  const explicitVendorDir = process.env.DOYA_CODEX_VENDOR_DIR?.trim();
  if (explicitVendorDir) {
    return { kind: "vendor-dir", path: explicitVendorDir };
  }

  const explicitBinary = process.env.DOYA_CODEX_BINARY_SOURCE?.trim();
  if (explicitBinary) {
    return { kind: "binary", path: explicitBinary };
  }

  const packageSource = resolveCodexPackageSource(targetTriple);
  if (packageSource) {
    return packageSource;
  }

  const codexEntry = resolveCodexOnPath();
  for (const candidate of candidateVendorDirs(codexEntry, targetTriple)) {
    if (fs.existsSync(path.join(candidate, "bin", codexBinaryName(targetTriple)))) {
      return { kind: "vendor-dir", path: candidate };
    }
  }

  return { kind: "binary", path: codexEntry };
}

function codexBinaryName(targetTriple) {
  return targetTriple.includes("pc-windows-msvc") ? "codex.exe" : "codex";
}

function copyBundledCodex(source, targetTriple) {
  const targetDir = path.join(outputRoot, targetTriple);
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  if (source.kind === "vendor-dir") {
    const sourceBinary = path.join(source.path, "bin", codexBinaryName(targetTriple));
    assertExecutable(sourceBinary);
    fs.cpSync(source.path, targetDir, { recursive: true });
  } else {
    assertExecutable(source.path);
    const binDir = path.join(targetDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(source.path, path.join(binDir, codexBinaryName(targetTriple)));
  }

  const outputBinary = path.join(targetDir, "bin", codexBinaryName(targetTriple));
  fs.chmodSync(outputBinary, 0o755);
  fs.writeFileSync(
    path.join(outputRoot, "metadata.json"),
    `${JSON.stringify(
      {
        targetTriple,
        sourceKind: source.kind,
        sourcePath: source.path,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Prepared bundled Codex: ${outputBinary}`);
}

function main() {
  const targetTriple =
    process.env.DOYA_CODEX_TARGET_TRIPLE?.trim() ||
    resolveTargetTriple(process.platform, process.arch);
  const source = resolveSource(targetTriple);
  copyBundledCodex(source, targetTriple);
}

main();
