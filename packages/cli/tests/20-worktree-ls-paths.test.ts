#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDoyaHomePath, resolveDoyaWorktreesDir } from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalDoyaHome = process.env.DOYA_HOME;

try {
  {
    console.log("Test 1: resolves explicit DOYA_HOME when set");
    process.env.DOYA_HOME = "/tmp/doya-explicit-home";

    assert.strictEqual(resolveDoyaHomePath(), "/tmp/doya-explicit-home");
    assert.strictEqual(resolveDoyaWorktreesDir(), "/tmp/doya-explicit-home/worktrees");
    console.log("\u2713 explicit DOYA_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.doya when DOYA_HOME is unset");
    delete process.env.DOYA_HOME;

    assert.strictEqual(resolveDoyaHomePath(), join(homedir(), ".doya"));
    assert.strictEqual(resolveDoyaWorktreesDir(), join(homedir(), ".doya", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalDoyaHome === undefined) {
    delete process.env.DOYA_HOME;
  } else {
    process.env.DOYA_HOME = originalDoyaHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
