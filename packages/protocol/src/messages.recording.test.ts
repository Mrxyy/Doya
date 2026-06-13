import { describe, expect, it } from "vitest";
import {
  ConversationRecordingSchema,
  RecordingAgentStartRequestMessageSchema,
  RecordingAgentStartResponseMessageSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("conversation recording messages", () => {
  it("parses recording RPC requests and responses", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "recording.agent.start.request",
        requestId: "req-1",
        agentId: "agent-1",
      }),
    ).toEqual(
      RecordingAgentStartRequestMessageSchema.parse({
        type: "recording.agent.start.request",
        requestId: "req-1",
        agentId: "agent-1",
      }),
    );

    const recording = ConversationRecordingSchema.parse({
      recordingId: "rec-1",
      agentId: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      startedAt: "2026-06-12T00:00:00.000Z",
      stoppedAt: null,
      status: "recording",
      title: null,
      events: [
        {
          seq: 1,
          recordedAt: "2026-06-12T00:00:01.000Z",
          offsetMs: 1000,
          offsetMsPrecise: 1000.25,
          kind: "user_input",
          payload: {
            source: "send_agent_message_request",
            requestId: "send-1",
            cwd: "/tmp/project",
            text: "hello",
            messageId: "msg-1",
          },
        },
      ],
    });
    expect(recording.events[0].offsetMsPrecise).toBe(1000.25);

    expect(
      SessionOutboundMessageSchema.parse({
        type: "recording.agent.start.response",
        payload: {
          requestId: "req-1",
          recording,
          error: null,
        },
      }),
    ).toEqual(
      RecordingAgentStartResponseMessageSchema.parse({
        type: "recording.agent.start.response",
        payload: {
          requestId: "req-1",
          recording,
          error: null,
        },
      }),
    );
  });

  it("parses create_agent_request conversation recording opt-in", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "create-1",
      config: { provider: "codex", cwd: "/tmp/project" },
      initialPrompt: "hello",
      recordConversation: true,
    });

    expect(parsed).toMatchObject({
      type: "create_agent_request",
      recordConversation: true,
    });
  });

  it("keeps conversationReplay feature optional", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
    });
    expect(parsed.features).toBeUndefined();

    const withFeature = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: { conversationReplay: true },
    });
    expect(withFeature.features?.conversationReplay).toBe(true);
  });
});
