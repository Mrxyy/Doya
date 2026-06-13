import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveDoyaHome } from "./doya-home.js";
import { PRIVATE_DIRECTORY_MODE } from "./private-files.js";

const MODE_MASK = 0o777;

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("resolveDoyaHome permissions", () => {
  test("creates DOYA_HOME with private permissions", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "doya-home-parent-"));
    const doyaHome = path.join(parent, "home");
    try {
      expect(resolveDoyaHome({ DOYA_HOME: doyaHome })).toBe(doyaHome);
      expect(modeOf(doyaHome)).toBe(PRIVATE_DIRECTORY_MODE);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
