import { describe, expect, test } from "vitest";

import {
  buildVoiceAgentMcpServerConfig,
  buildVoiceOnlyMcpServers,
  buildVoiceModeSystemPrompt,
  stripVoiceModeSystemPrompt,
} from "./voice-config.js";

describe("voice MCP stdio config", () => {
  test("builds voice-only HTTP MCP config for an agent", () => {
    const config = buildVoiceOnlyMcpServers(
      "http://127.0.0.1:6767/mcp/agents",
      "11111111-1111-4111-8111-111111111111",
      {
        existing: {
          type: "http",
          url: "http://127.0.0.1:6767/mcp/other",
        },
      },
    );

    expect(config?.existing).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/other",
    });
    expect(config?.doya_voice.type).toBe("http");
    expect(config?.doya_voice.url).toBe(
      "http://127.0.0.1:6767/mcp/agents?callerAgentId=11111111-1111-4111-8111-111111111111&voiceOnly=1",
    );
  });

  test("builds stdio MCP config for voice agent", () => {
    const config = buildVoiceAgentMcpServerConfig({
      command: "/usr/local/bin/node",
      baseArgs: ["/tmp/mcp-stdio-socket-bridge-cli.mjs"],
      socketPath: "/tmp/doya-voice.sock",
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        DOYA_HOME: "/tmp/doya-home",
      },
    });

    expect(config.type).toBe("stdio");
    expect(config.command).toBe("/usr/local/bin/node");
    expect(config.args).toEqual([
      "/tmp/mcp-stdio-socket-bridge-cli.mjs",
      "--socket",
      "/tmp/doya-voice.sock",
    ]);
    expect(config.env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      DOYA_HOME: "/tmp/doya-home",
    });
  });
});

describe("voice mode prompt instructions", () => {
  test("builds enabled voice instructions and preserves base prompt", () => {
    const prompt = buildVoiceModeSystemPrompt("Base system prompt", true);

    expect(prompt).toContain("Base system prompt");
    expect(prompt).toContain("<doya_voice_mode>");
    expect(prompt).toContain("Doya voice mode is now on.");
    expect(prompt).toContain(
      "Only use the speak tool when the current user message contains a <spoken-input> block.",
    );
    expect(prompt).toContain(
      "For normal typed user messages, reply normally without calling speak.",
    );
    expect(prompt).toContain("</doya_voice_mode>");
  });

  test("builds disabled voice instructions and supersedes previous voice block", () => {
    const existing = [
      "Base system prompt",
      "<doya_voice_mode>",
      "legacy voice instruction",
      "</doya_voice_mode>",
    ].join("\n\n");

    const prompt = buildVoiceModeSystemPrompt(existing, false);

    expect(prompt).toContain("Base system prompt");
    expect(prompt).toContain("Doya voice mode is now off.");
    expect(prompt).toContain("Ignore any earlier Doya voice mode instructions in this thread.");
    expect(prompt.match(/<doya_voice_mode>/g)?.length ?? 0).toBe(1);
    expect(prompt).not.toContain("legacy voice instruction");
  });

  test("strips voice blocks from persisted prompt", () => {
    const existing = [
      "Base system prompt",
      "<doya_voice_mode>",
      "legacy voice instruction",
      "</doya_voice_mode>",
    ].join("\n\n");

    expect(stripVoiceModeSystemPrompt(existing)).toBe("Base system prompt");
    expect(
      stripVoiceModeSystemPrompt(
        ["<doya_voice_mode>", "legacy voice instruction", "</doya_voice_mode>"].join("\n\n"),
      ),
    ).toBeUndefined();
  });
});
