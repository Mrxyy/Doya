import { describe, expect, it } from "vitest";
import type { ConversationRecording, ConversationRecordingEvent } from "@getdoya/protocol/messages";
import type { StreamItem } from "@/types/stream";
import {
  REPLAY_TEXT_BURST_MIN_INTERVAL_MS,
  listReplayClips,
  projectConversationReplay,
  projectConversationTimelineReplay,
} from "./conversation-replay";

const baseEvents: ConversationRecordingEvent[] = [
  {
    seq: 1,
    recordedAt: "2026-06-12T00:00:00.000Z",
    offsetMs: 0,
    kind: "user_input",
    payload: { text: "hello" },
  },
  {
    seq: 2,
    recordedAt: "2026-06-12T00:00:01.000Z",
    offsetMs: 1000,
    kind: "agent_stream_raw",
    payload: {
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "hi" },
      },
    },
  },
  {
    seq: 3,
    recordedAt: "2026-06-12T00:00:02.000Z",
    offsetMs: 2000,
    kind: "agent_stream_raw",
    payload: {
      event: {
        type: "turn_completed",
        provider: "codex",
      },
    },
  },
];

describe("projectConversationReplay", () => {
  it("projects visible state at a playback position", () => {
    const early = projectConversationReplay({ events: baseEvents, edits: {}, positionMs: 500 });
    expect(early.items.map((item) => item.kind)).toEqual(["user_message"]);

    const later = projectConversationReplay({ events: baseEvents, edits: {}, positionMs: 2500 });
    expect(later.items.map((item) => item.kind)).toEqual(["user_message", "assistant_message"]);
    expect(later.items[1]).toMatchObject({ kind: "assistant_message", text: "hi" });
  });

  it("hides events and applies edited offsets", () => {
    const hidden = projectConversationReplay({
      events: baseEvents,
      edits: { "2": { hidden: true } },
      positionMs: 2500,
    });
    expect(hidden.items.map((item) => item.kind)).toEqual(["user_message"]);

    const delayed = projectConversationReplay({
      events: baseEvents,
      edits: { "2": { offsetMs: 3000 } },
      positionMs: 2500,
    });
    expect(delayed.items.map((item) => item.kind)).toEqual(["user_message"]);

    const afterDelay = projectConversationReplay({
      events: baseEvents,
      edits: { "2": { offsetMs: 3000 } },
      positionMs: 3500,
    });
    expect(afterDelay.items.map((item) => item.kind)).toEqual([
      "user_message",
      "assistant_message",
    ]);
  });

  it("does not keep replay duration pinned to non-rendered lifecycle events", () => {
    const replay = projectConversationReplay({
      events: baseEvents,
      edits: { "2": { offsetMs: 500 } },
      positionMs: Number.POSITIVE_INFINITY,
    });

    expect(replay.durationMs).toBe(500);
  });

  it("merges streamed assistant chunks into one visible message", () => {
    const chunkEvents: ConversationRecordingEvent[] = [
      {
        seq: 1,
        recordedAt: "2026-06-12T00:00:00.000Z",
        offsetMs: 0,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "你" },
          },
        },
      },
      {
        seq: 2,
        recordedAt: "2026-06-12T00:00:00.100Z",
        offsetMs: 100,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "好" },
          },
        },
      },
      {
        seq: 3,
        recordedAt: "2026-06-12T00:00:00.200Z",
        offsetMs: 200,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "!" },
          },
        },
      },
    ];

    const firstChunk = projectConversationReplay({
      events: chunkEvents,
      edits: {},
      positionMs: 50,
    });
    expect(firstChunk.items).toHaveLength(1);
    expect(firstChunk.items[0]).toMatchObject({ kind: "assistant_message", text: "你" });

    const replay = projectConversationReplay({
      events: chunkEvents,
      edits: {},
      positionMs: 100,
    });

    expect(replay.items).toHaveLength(1);
    expect(replay.items[0]).toMatchObject({ kind: "assistant_message", text: "你好" });
  });

  it("keeps confirm UI markup together when same assistant message chunks surround a tool call", () => {
    const chunkEvents: ConversationRecordingEvent[] = [
      {
        seq: 1,
        recordedAt: "2026-06-12T00:00:00.000Z",
        offsetMs: 0,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: {
              type: "assistant_message",
              messageId: "assistant-confirm",
              text: '<doya-ui version="1" kind="ai_creation.slides.progress"><doya-ui-content>',
            },
          },
        },
      },
      {
        seq: 2,
        recordedAt: "2026-06-12T00:00:00.050Z",
        offsetMs: 50,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: {
              type: "tool_call",
              callId: "shell-1",
              name: "shell",
              status: "completed",
              detail: { type: "shell", command: "write recommendations.json" },
            },
          },
        },
      },
      {
        seq: 3,
        recordedAt: "2026-06-12T00:00:00.100Z",
        offsetMs: 100,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: {
              type: "assistant_message",
              messageId: "assistant-confirm",
              text: '<doya-title>幻灯片确认</doya-title><doya-field name="confirm_path" label="确认">projects/b2b_saas_analytics_pitch_ppt169_20260621/confirm_ui/</doya-field></doya-ui-content></doya-ui>',
            },
          },
        },
      },
    ];

    const replay = projectConversationReplay({
      events: chunkEvents,
      edits: {},
      positionMs: REPLAY_TEXT_BURST_MIN_INTERVAL_MS * 2,
    });

    expect(replay.items).toHaveLength(2);
    expect(replay.items[0]).toMatchObject({
      kind: "assistant_message",
      text: expect.stringContaining("confirm_path"),
    });
    expect(replay.items[0]).toMatchObject({
      kind: "assistant_message",
      text: expect.stringContaining(
        "projects/b2b_saas_analytics_pitch_ppt169_20260621/confirm_ui/",
      ),
    });
    expect(replay.items[1]).toMatchObject({ kind: "tool_call" });
  });

  it("groups streamed assistant chunks into one editable message clip", () => {
    const chunkEvents: ConversationRecordingEvent[] = [
      {
        seq: 1,
        recordedAt: "2026-06-12T00:00:00.000Z",
        offsetMs: 0,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "你" },
          },
        },
      },
      {
        seq: 2,
        recordedAt: "2026-06-12T00:00:00.100Z",
        offsetMs: 100,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "好" },
          },
        },
      },
    ];

    const clips = listReplayClips(chunkEvents, {});

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      kind: "assistant",
      firstSeq: 1,
      preview: "你好",
    });
    expect(clips[0]?.events.map((entry) => entry.event.seq)).toEqual([1, 2]);
  });

  it("keeps message clip identity stable when editing an inner event earlier", () => {
    const chunkEvents: ConversationRecordingEvent[] = [
      {
        seq: 10,
        recordedAt: "2026-06-12T00:00:00.100Z",
        offsetMs: 100,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "后" },
          },
        },
      },
      {
        seq: 11,
        recordedAt: "2026-06-12T00:00:00.200Z",
        offsetMs: 200,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "前" },
          },
        },
      },
    ];

    const clips = listReplayClips(chunkEvents, { "11": { offsetMs: 0 } });

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      firstSeq: 10,
      scheduledOffsetMs: 0,
    });
    expect(clips[0]?.events.map((entry) => entry.event.seq)).toEqual([11, 10]);
  });

  it("spreads same-millisecond text bursts across replay frames", () => {
    const burstEvents: ConversationRecordingEvent[] = [
      {
        seq: 1,
        recordedAt: "2026-06-12T00:00:00.000Z",
        offsetMs: 0,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "一" },
          },
        },
      },
      {
        seq: 2,
        recordedAt: "2026-06-12T00:00:00.000Z",
        offsetMs: 0,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "二" },
          },
        },
      },
      {
        seq: 3,
        recordedAt: "2026-06-12T00:00:00.000Z",
        offsetMs: 0,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "三" },
          },
        },
      },
    ];

    const atStart = projectConversationReplay({ events: burstEvents, edits: {}, positionMs: 0 });
    expect(atStart.items).toHaveLength(1);
    expect(atStart.items[0]).toMatchObject({ kind: "assistant_message", text: "一" });

    const secondFrame = projectConversationReplay({
      events: burstEvents,
      edits: {},
      positionMs: REPLAY_TEXT_BURST_MIN_INTERVAL_MS,
    });
    expect(secondFrame.items).toHaveLength(1);
    expect(secondFrame.items[0]).toMatchObject({ kind: "assistant_message", text: "一二" });

    const afterBurst = projectConversationReplay({
      events: burstEvents,
      edits: {},
      positionMs: REPLAY_TEXT_BURST_MIN_INTERVAL_MS * 2,
    });
    expect(afterBurst.items).toHaveLength(1);
    expect(afterBurst.items[0]).toMatchObject({ kind: "assistant_message", text: "一二三" });
  });

  it("uses precise offsets without adding burst spacing", () => {
    const preciseEvents: ConversationRecordingEvent[] = [
      {
        seq: 1,
        recordedAt: "2026-06-12T00:00:00.000Z",
        offsetMs: 0,
        offsetMsPrecise: 0,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "一" },
          },
        },
      },
      {
        seq: 2,
        recordedAt: "2026-06-12T00:00:00.000Z",
        offsetMs: 0,
        offsetMsPrecise: 0.75,
        kind: "agent_stream_raw",
        payload: {
          event: {
            type: "timeline",
            provider: "codex",
            item: { type: "assistant_message", text: "二" },
          },
        },
      },
    ];

    const beforePreciseSecond = projectConversationReplay({
      events: preciseEvents,
      edits: {},
      positionMs: 0.5,
    });
    expect(beforePreciseSecond.items).toHaveLength(1);
    expect(beforePreciseSecond.items[0]).toMatchObject({ kind: "assistant_message", text: "一" });

    const afterPreciseSecond = projectConversationReplay({
      events: preciseEvents,
      edits: {},
      positionMs: 0.75,
    });
    expect(afterPreciseSecond.items).toHaveLength(1);
    expect(afterPreciseSecond.items[0]).toMatchObject({ kind: "assistant_message", text: "一二" });
  });

  it("replays inside the full conversation timeline", () => {
    const recording: ConversationRecording = {
      recordingId: "recording-1",
      agentId: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      startedAt: "2026-06-12T00:00:00.000Z",
      stoppedAt: "2026-06-12T00:00:02.000Z",
      status: "stopped",
      title: null,
      events: baseEvents,
      edits: {},
    };
    const baselineItems: StreamItem[] = [
      {
        kind: "user_message",
        id: "before",
        text: "before",
        timestamp: new Date("2026-06-11T23:59:59.000Z"),
      },
      {
        kind: "assistant_message",
        id: "recorded-duplicate",
        text: "hi",
        timestamp: new Date("2026-06-12T00:00:01.000Z"),
      },
      {
        kind: "assistant_message",
        id: "after",
        text: "after",
        timestamp: new Date("2026-06-12T00:00:03.000Z"),
      },
    ];

    const atStart = projectConversationTimelineReplay({
      baselineItems,
      recording,
      positionMs: 0,
    });
    expect(atStart.items.map((item) => item.id)).toEqual(["before", "replay_user_1"]);

    const duringRecording = projectConversationTimelineReplay({
      baselineItems,
      recording,
      positionMs: 500,
    });
    expect(duringRecording.items.map((item) => item.id)).toEqual(["before", "replay_user_1"]);

    const afterRecording = projectConversationTimelineReplay({
      baselineItems,
      recording,
      positionMs: 1500,
    });
    expect(afterRecording.items.map((item) => item.id)).toEqual([
      "before",
      "replay_user_1",
      "replay_assistant_2",
      "after",
    ]);
  });

  it("filters the original user message even when its timeline timestamp is just before recording start", () => {
    const recording: ConversationRecording = {
      recordingId: "recording-1",
      agentId: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      startedAt: "2026-06-12T00:00:01.000Z",
      stoppedAt: "2026-06-12T00:00:04.000Z",
      status: "stopped",
      title: null,
      events: baseEvents,
      edits: {},
    };
    const baselineItems: StreamItem[] = [
      {
        kind: "user_message",
        id: "original-user",
        text: "hello",
        timestamp: new Date("2026-06-12T00:00:00.500Z"),
      },
      {
        kind: "assistant_message",
        id: "after",
        text: "after",
        timestamp: new Date("2026-06-12T00:00:05.000Z"),
      },
    ];

    const replay = projectConversationTimelineReplay({
      baselineItems,
      recording,
      positionMs: 0,
    });

    expect(replay.items.map((item) => item.id)).toEqual(["replay_user_1"]);
  });

  it("filters baseline duplicates for replayed assistant messages merged across tool calls", () => {
    const responseText = "生成完成：projects/demo/exports/demo.pptx";
    const recording: ConversationRecording = {
      recordingId: "recording-1",
      agentId: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      startedAt: "2026-06-12T00:00:00.000Z",
      stoppedAt: "2026-06-12T00:00:05.000Z",
      status: "stopped",
      title: null,
      events: [
        {
          seq: 1,
          recordedAt: "2026-06-12T00:00:00.000Z",
          offsetMs: 0,
          kind: "user_input",
          payload: { text: "生成 PPT" },
        },
        {
          seq: 2,
          recordedAt: "2026-06-12T00:00:01.000Z",
          offsetMs: 1000,
          kind: "agent_stream_raw",
          payload: {
            event: {
              type: "timeline",
              provider: "codex",
              item: {
                type: "assistant_message",
                messageId: "assistant-final",
                text: responseText.slice(0, 5),
              },
            },
          },
        },
        {
          seq: 3,
          recordedAt: "2026-06-12T00:00:02.000Z",
          offsetMs: 2000,
          kind: "agent_stream_raw",
          payload: {
            event: {
              type: "timeline",
              provider: "codex",
              item: {
                type: "tool_call",
                callId: "shell-1",
                name: "shell",
                status: "completed",
                detail: { type: "shell", command: "export pptx" },
              },
            },
          },
        },
        {
          seq: 4,
          recordedAt: "2026-06-12T00:00:03.000Z",
          offsetMs: 3000,
          kind: "agent_stream_raw",
          payload: {
            event: {
              type: "timeline",
              provider: "codex",
              item: {
                type: "assistant_message",
                messageId: "assistant-final",
                text: responseText.slice(5),
              },
            },
          },
        },
      ],
      edits: {},
    };
    const baselineItems: StreamItem[] = [
      {
        kind: "user_message",
        id: "original-user",
        text: "生成 PPT",
        timestamp: new Date("2026-06-12T00:00:00.500Z"),
      },
      {
        kind: "assistant_message",
        id: "original-assistant",
        text: responseText,
        timestamp: new Date("2026-06-12T00:00:04.000Z"),
      },
    ];

    const replay = projectConversationTimelineReplay({
      baselineItems,
      recording,
      positionMs: Number.POSITIVE_INFINITY,
    });

    expect(replay.items.map((item) => item.id)).toEqual([
      "replay_user_1",
      "replay_assistant_2",
      "replay_tool_shell-1_3",
    ]);
    expect(replay.items[1]).toMatchObject({ kind: "assistant_message", text: responseText });
  });
});
