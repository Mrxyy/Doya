import { describe, expect, it } from "vitest";

import { getDoyaToolLeafName, isDoyaToolName } from "@getdoya/protocol/tool-name-normalization";

describe("isDoyaToolName", () => {
  it("detects Claude Code format", () => {
    expect(isDoyaToolName("mcp__doya__create_agent")).toBe(true);
    expect(isDoyaToolName("mcp__doya__list_agents")).toBe(true);
  });

  it("detects doya_voice variant", () => {
    expect(isDoyaToolName("mcp__doya_voice__create_agent")).toBe(true);
    expect(isDoyaToolName("doya_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isDoyaToolName("mcp__doya_voice__speak")).toBe(false);
    expect(isDoyaToolName("mcp__doya__speak")).toBe(false);
    expect(isDoyaToolName("doya.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isDoyaToolName("doya.create_agent")).toBe(true);
  });

  it("rejects non-Doya tools", () => {
    expect(isDoyaToolName("Bash")).toBe(false);
    expect(isDoyaToolName("Read")).toBe(false);
    expect(isDoyaToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getDoyaToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getDoyaToolLeafName("mcp__doya__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getDoyaToolLeafName("doya.create_agent")).toBe("create_agent");
    expect(getDoyaToolLeafName("doya.list_agents")).toBe("list_agents");
  });

  it("returns null for non-Doya tools", () => {
    expect(getDoyaToolLeafName("Bash")).toBeNull();
  });
});
