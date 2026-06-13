import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationRecordingStore } from "./conversation-recording-store.js";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "paseo-recordings-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("ConversationRecordingStore", () => {
  it("records user input and raw stream events with monotonic offsets", async () => {
    const store = new ConversationRecordingStore(rootDir);
    const started = await store.start({
      agentId: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      title: "Demo",
    });

    store.recordUserInput("agent-1", {
      source: "send_agent_message_request",
      requestId: "send-1",
      cwd: "/tmp/project",
      text: "hello",
      messageId: "msg-1",
      attachments: [
        {
          type: "file",
          mimeType: "text/markdown",
          title: "README.md",
          sourcePath: "/tmp/project/README.md",
        },
      ],
    });
    store.recordAgentStreamEvent("agent-1", {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "hi" },
    });

    const stopped = await store.stop("agent-1");
    expect(stopped?.recordingId).toBe(started.recordingId);
    const recording = await store.get("agent-1", started.recordingId);
    expect(recording.status).toBe("stopped");
    expect(recording.events.map((event) => event.kind)).toEqual(["user_input", "agent_stream_raw"]);
    expect(recording.events[0].seq).toBe(1);
    expect(recording.events[0]).toMatchObject({
      kind: "user_input",
      payload: {
        source: "send_agent_message_request",
        requestId: "send-1",
        cwd: "/tmp/project",
        messageId: "msg-1",
        text: "hello",
        attachments: [{ type: "file", sourcePath: "/tmp/project/README.md" }],
      },
    });
    expect(recording.events[1].seq).toBe(2);
    expect(recording.events[1].offsetMs).toBeGreaterThanOrEqual(recording.events[0].offsetMs);
    expect(recording.events[1].offsetMsPrecise).toBeGreaterThanOrEqual(
      recording.events[0].offsetMsPrecise ?? 0,
    );
  });

  it("records precise offsets even when wall-clock milliseconds match", async () => {
    let dateMs = Date.parse("2026-06-12T00:00:00.000Z");
    let monotonicMs = 1_000;
    const store = new ConversationRecordingStore(rootDir, {
      clock: {
        nowDate: () => new Date(dateMs),
        nowMonotonicMs: () => monotonicMs,
      },
    });
    const started = await store.start({
      agentId: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
    });

    monotonicMs = 1_000.25;
    store.recordAgentStreamEvent("agent-1", {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "a" },
    });
    monotonicMs = 1_000.75;
    store.recordAgentStreamEvent("agent-1", {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "b" },
    });

    dateMs += 1;
    await store.stop("agent-1");
    const recording = await store.get("agent-1", started.recordingId);
    expect(recording.events.map((event) => event.offsetMs)).toEqual([0, 0]);
    expect(recording.events.map((event) => event.offsetMsPrecise)).toEqual([0.25, 0.75]);
  });

  it("does not append after stop and stores edits separately", async () => {
    const store = new ConversationRecordingStore(rootDir);
    const started = await store.start({
      agentId: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
    });
    store.recordUserInput("agent-1", { text: "before" });
    await store.stop("agent-1");

    store.recordUserInput("agent-1", { text: "after" });
    const beforeEdit = await store.get("agent-1", started.recordingId);
    const updated = await store.updateEdits("agent-1", started.recordingId, {
      "1": { hidden: true, offsetMs: 500 },
    });

    expect(beforeEdit.events).toHaveLength(1);
    expect(updated.events).toEqual(beforeEdit.events);
    expect(updated.edits["1"]).toEqual({ hidden: true, offsetMs: 500 });
  });
});
