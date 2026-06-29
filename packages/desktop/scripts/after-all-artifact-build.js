const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");

const yaml = require("js-yaml");

const execFileAsync = promisify(execFile);

const PRODUCT_NAME = "Doya";
const ELECTRON_FRAMEWORK_BINARY = path.join(
  "Contents",
  "Frameworks",
  "Electron Framework.framework",
  "Versions",
  "A",
  "Electron Framework",
);

exports.default = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== "darwin") {
    return [];
  }

  const dmgPaths = buildResult.artifactPaths.filter((artifactPath) =>
    artifactPath.endsWith(".dmg"),
  );

  for (const dmgPath of dmgPaths) {
    const valid = await dmgContainsElectronFramework(dmgPath);
    if (valid) {
      continue;
    }

    if (process.env.CI === "true") {
      throw new Error(
        `${path.basename(dmgPath)} is missing Electron Framework. Refusing to publish a broken DMG.`,
      );
    }

    const appPath = findUnpackedApp(buildResult.outDir, dmgPath);
    console.warn(
      `${path.basename(dmgPath)} is missing Electron Framework; rebuilding it from ${appPath}.`,
    );
    await rebuildDmgFromApp(dmgPath, appPath);
    await refreshMacMetadata(dmgPath, buildResult.outDir);
  }

  return [];
};

async function dmgContainsElectronFramework(dmgPath) {
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), "doya-dmg-check-"));
  let mounted = false;

  try {
    await execFileAsync("hdiutil", [
      "attach",
      dmgPath,
      "-mountpoint",
      mountPoint,
      "-nobrowse",
      "-readonly",
      "-quiet",
    ]);
    mounted = true;

    return fs.existsSync(path.join(mountPoint, `${PRODUCT_NAME}.app`, ELECTRON_FRAMEWORK_BINARY));
  } finally {
    if (mounted) {
      await execFileAsync("hdiutil", ["detach", mountPoint, "-quiet"]).catch(() => {});
    }
    fs.rmSync(mountPoint, { recursive: true, force: true });
  }
}

function findUnpackedApp(outDir, dmgPath) {
  const archMatch = path.basename(dmgPath).match(/-(arm64|x64|universal)\.dmg$/);
  const arch = archMatch?.[1];
  const candidates = [
    arch ? path.join(outDir, `mac-${arch}`, `${PRODUCT_NAME}.app`) : null,
    path.join(outDir, "mac", `${PRODUCT_NAME}.app`),
    path.join(outDir, `${PRODUCT_NAME}.app`),
  ].filter(Boolean);

  const appPath = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, ELECTRON_FRAMEWORK_BINARY)),
  );

  if (!appPath) {
    throw new Error(
      `Cannot repair ${path.basename(dmgPath)} because no complete unpacked ${PRODUCT_NAME}.app was found.`,
    );
  }

  return appPath;
}

async function rebuildDmgFromApp(dmgPath, appPath) {
  await execFileAsync("hdiutil", [
    "create",
    "-volname",
    PRODUCT_NAME,
    "-srcfolder",
    appPath,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);
}

async function refreshMacMetadata(dmgPath, outDir) {
  fs.rmSync(`${dmgPath}.blockmap`, { force: true });

  const latestPath = path.join(outDir, "latest-mac.yml");
  if (!fs.existsSync(latestPath)) {
    return;
  }

  const metadata = yaml.load(fs.readFileSync(latestPath, "utf8"));
  if (!metadata || !Array.isArray(metadata.files)) {
    return;
  }

  const dmgName = path.basename(dmgPath);
  const stat = fs.statSync(dmgPath);
  const sha512 = await hashFileSha512Base64(dmgPath);
  const dmgEntry = metadata.files.find((entry) => entry && entry.url === dmgName);
  if (dmgEntry) {
    dmgEntry.sha512 = sha512;
    dmgEntry.size = stat.size;
  }

  fs.writeFileSync(latestPath, yaml.dump(metadata, { lineWidth: 120 }), "utf8");
}

function hashFileSha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}
