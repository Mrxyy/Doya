import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DIST_DIR = path.resolve(import.meta.dirname, "../dist");
const MAX_JS_BYTES = 1_900_000;

const encoder = new TextEncoder();

async function main() {
  const jsFiles = await listJsFiles(DIST_DIR);
  const splitResults = [];
  for (const filePath of jsFiles) {
    const source = await readFile(filePath, "utf8");
    const sourceBytes = encoder.encode(source).byteLength;
    if (sourceBytes <= MAX_JS_BYTES) {
      continue;
    }
    splitResults.push(await splitBundleFile({ filePath, source }));
  }

  if (splitResults.length === 0) {
    console.log(`[split-large-js-bundles] all JS files are <= ${MAX_JS_BYTES} bytes`);
    return;
  }

  for (const result of splitResults) {
    const relativePath = path.relative(DIST_DIR, result.filePath);
    console.log(
      `[split-large-js-bundles] ${relativePath}: ${result.originalBytes} bytes -> ${result.partCount} parts`,
    );
  }
}

async function listJsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.includes(".part-")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function splitBundleFile({ filePath, source }) {
  const originalBytes = encoder.encode(source).byteLength;
  const parts = splitUtf8Text(source, MAX_JS_BYTES);
  const baseName = path.basename(filePath, ".js");
  const partNames = parts.map(
    (_, index) => `${baseName}.part-${String(index).padStart(3, "0")}.js`,
  );
  const backupPath = `${filePath}.unsplit`;
  await rename(filePath, backupPath);
  try {
    await Promise.all(
      parts.map((part, index) =>
        writeFile(path.join(path.dirname(filePath), partNames[index]), part),
      ),
    );
    await writeFile(filePath, buildLoader({ partNames }));
    await rm(backupPath, { force: true });
  } catch (error) {
    await rename(backupPath, filePath).catch(() => undefined);
    throw error;
  }
  return {
    filePath,
    originalBytes,
    partCount: parts.length,
  };
}

function splitUtf8Text(source, maxBytes) {
  const parts = [];
  let startIndex = 0;
  let byteCount = 0;
  for (let index = 0; index < source.length; ) {
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const char = String.fromCodePoint(codePoint);
    const charBytes = encoder.encode(char).byteLength;
    if (byteCount > 0 && byteCount + charBytes > maxBytes) {
      parts.push(source.slice(startIndex, index));
      startIndex = index;
      byteCount = 0;
      continue;
    }
    byteCount += charBytes;
    index += char.length;
  }
  if (startIndex < source.length) {
    parts.push(source.slice(startIndex));
  }
  return parts;
}

function buildLoader({ partNames }) {
  return `;(function () {
  var parts = ${JSON.stringify(partNames)};
  var scriptUrl =
    typeof document !== "undefined" && document.currentScript && document.currentScript.src
      ? document.currentScript.src
      : typeof location !== "undefined"
        ? String(location.href)
        : "";
  var baseUrl = scriptUrl.slice(0, scriptUrl.lastIndexOf("/") + 1);
  var source = "";
  for (var index = 0; index < parts.length; index += 1) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", baseUrl + parts[index], false);
    if (xhr.overrideMimeType) {
      xhr.overrideMimeType("text/plain;charset=utf-8");
    }
    xhr.send(null);
    if ((xhr.status < 200 || xhr.status >= 300) && xhr.status !== 0) {
      throw new Error("Failed to load JS bundle part: " + parts[index]);
    }
    source += xhr.responseText;
  }
  (0, eval)(source + "\\n//# sourceURL=" + scriptUrl + ".joined");
})();\n`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
