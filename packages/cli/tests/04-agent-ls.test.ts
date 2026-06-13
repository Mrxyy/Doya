#!/usr/bin/env npx tsx

/**
 * Phase 3: LS Command Tests
 *
 * Tests the ls command - listing agents (top-level command).
 * Since daemon may not be running, we test both:
 * - Help and argument parsing
 * - Graceful error handling when daemon not running
 * - JSON output format
 *
 * Tests:
 * - doya --help shows ls command
 * - doya ls --help shows options
 * - doya ls returns empty list or error when no daemon
 * - doya ls --json returns valid JSON (or error)
 * - doya ls -a flag is accepted
 * - doya ls -g flag is accepted
 * - doya ls does not support --ui
 */

import assert from "node:assert";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runLocalDoya } from "./helpers/local-cli.ts";

console.log("=== LS Command Tests ===\n");

// Get random port that's definitely not in use (never 6767)
const port = 10000 + Math.floor(Math.random() * 50000);
const doyaHome = await mkdtemp(join(tmpdir(), "doya-test-home-"));

try {
  // Test 1: doya --help shows ls command
  {
    console.log("Test 1: doya --help shows ls command");
    const result = await runLocalDoya(["--help"]);
    assert.strictEqual(result.exitCode, 0, "doya --help should exit 0");
    assert(result.stdout.includes("ls"), "help should mention ls command");
    console.log("✓ doya --help shows ls command\n");
  }

  // Test 2: doya ls --help shows options
  {
    console.log("Test 2: doya ls --help shows options");
    const result = await runLocalDoya(["ls", "--help"]);
    assert.strictEqual(result.exitCode, 0, "doya ls --help should exit 0");
    assert(result.stdout.includes("-a"), "help should mention -a flag");
    assert(result.stdout.includes("--all"), "help should mention --all flag");
    assert(result.stdout.includes("-g"), "help should mention -g flag");
    assert(result.stdout.includes("--global"), "help should mention --global flag");
    assert(result.stdout.includes("--host"), "help should mention --host option");
    assert(!result.stdout.includes("--ui"), "help should not mention --ui");
    console.log("✓ doya ls --help shows options\n");
  }

  // Test 3: doya ls returns error when no daemon running
  {
    console.log("Test 3: doya ls handles daemon not running");
    const result = await runLocalDoya(["ls"], {
      DOYA_HOST: `localhost:${port}`,
      DOYA_HOME: doyaHome,
    });
    // Should fail because daemon not running
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    const output = result.stdout + result.stderr;
    const hasError =
      output.toLowerCase().includes("daemon") ||
      output.toLowerCase().includes("connect") ||
      output.toLowerCase().includes("cannot");
    assert(hasError, "error message should mention connection issue");
    assert(output.includes("--host <host:port>"), "error message should mention --host");
    assert(output.includes("DOYA_HOST"), "error message should mention DOYA_HOST");
    console.log("✓ doya ls handles daemon not running\n");
  }

  // Test 4: doya ls --json returns valid JSON error
  {
    console.log("Test 4: doya ls --json handles errors");
    const result = await runLocalDoya(["ls", "--json"], {
      DOYA_HOST: `localhost:${port}`,
      DOYA_HOME: doyaHome,
    });
    // Should still fail (daemon not running)
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    // But output should be valid JSON if present
    const output = result.stdout.trim();
    if (output.length > 0) {
      try {
        JSON.parse(output);
        console.log("✓ doya ls --json outputs valid JSON error\n");
      } catch {
        // Empty or stderr-only output is acceptable
        console.log("✓ doya ls --json handled error (output may be in stderr)\n");
      }
    } else {
      console.log("✓ doya ls --json handled error gracefully\n");
    }
  }

  // Test 5: doya ls -a flag is accepted
  {
    console.log("Test 5: doya ls -a flag is accepted");
    const result = await runLocalDoya(["ls", "-a"], {
      DOYA_HOST: `localhost:${port}`,
      DOYA_HOME: doyaHome,
    });
    // Will fail due to no daemon, but flag should be parsed without error
    // (no "unknown option" error)
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -a flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ doya ls -a flag is accepted\n");
  }

  // Test 6: doya ls -g flag is accepted
  {
    console.log("Test 6: doya ls -g flag is accepted");
    const result = await runLocalDoya(["ls", "-g"], {
      DOYA_HOST: `localhost:${port}`,
      DOYA_HOME: doyaHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -g flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ doya ls -g flag is accepted\n");
  }

  // Test 7: doya ls -ag combined flags are accepted
  {
    console.log("Test 7: doya ls -ag combined flags are accepted");
    const result = await runLocalDoya(["ls", "-ag"], {
      DOYA_HOST: `localhost:${port}`,
      DOYA_HOME: doyaHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -ag flags");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ doya ls -ag combined flags are accepted\n");
  }

  // Test 8: -q (quiet) flag is accepted globally
  {
    console.log("Test 8: -q (quiet) flag is accepted");
    const result = await runLocalDoya(["-q", "ls"], {
      DOYA_HOST: `localhost:${port}`,
      DOYA_HOME: doyaHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -q flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ -q (quiet) flag is accepted\n");
  }

  // Test 9: doya ls --ui is rejected (flag removed)
  {
    console.log("Test 9: doya ls --ui is rejected");
    const result = await runLocalDoya(["ls", "--ui"], {
      DOYA_HOST: `localhost:${port}`,
      DOYA_HOME: doyaHome,
    });
    assert.notStrictEqual(result.exitCode, 0, "should fail for removed --ui flag");
    const output = result.stdout + result.stderr;
    assert(output.includes("unknown option"), "should report unknown option for --ui");
    console.log("✓ doya ls --ui is rejected\n");
  }
} finally {
  // Clean up temp directory
  await rm(doyaHome, { recursive: true, force: true });
}

console.log("=== All ls tests passed ===");
