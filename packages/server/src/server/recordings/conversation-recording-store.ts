import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentAttachment,
  ConversationRecording,
  ConversationRecordingEdits,
  ConversationRecordingEvent,
  ConversationRecordingSummary,
} from "@getdoya/protocol/messages";
import { ConversationRecordingSchema } from "@getdoya/protocol/messages";
import type { AgentProvider, AgentStreamEvent } from "../agent/agent-sdk-types.js";
import { serializeAgentStreamEvent } from "../messages.js";

export interface StartConversationRecordingInput {
  agentId: string;
  provider: AgentProvider;
  cwd: string;
  title?: string | null;
}

export interface UserInputRecordingPayload extends Record<string, unknown> {
  source?: "send_agent_message_request" | "create_agent_request.initialPrompt";
  requestId?: string;
  cwd?: string;
  messageId?: string;
  text: string;
  images?: unknown[];
  attachments?: AgentAttachment[];
}

interface ActiveRecordingState {
  recordingId: string;
  startedAtMs: number;
  startedAtMonotonicMs: number;
  nextSeq: number;
}

interface ConversationRecordingClock {
  nowDate: () => Date;
  nowMonotonicMs: () => number;
}

type UserInputRecordingEvent = Extract<ConversationRecordingEvent, { kind: "user_input" }>;
type AgentStreamRawRecordingEvent = Extract<
  ConversationRecordingEvent,
  { kind: "agent_stream_raw" }
>;

const defaultClock: ConversationRecordingClock = {
  nowDate: () => new Date(),
  nowMonotonicMs: () => performance.now(),
};

function summarize(recording: ConversationRecording): ConversationRecordingSummary {
  const { events: _events, ...summary } = recording;
  return summary;
}

export class ConversationRecordingStore {
  private readonly activeByAgent = new Map<string, ActiveRecordingState>();
  private readonly writeTails = new Map<string, Promise<void>>();
  private readonly clock: ConversationRecordingClock;

  constructor(
    private readonly rootDir: string,
    options?: { clock?: ConversationRecordingClock },
  ) {
    this.clock = options?.clock ?? defaultClock;
  }

  async start(input: StartConversationRecordingInput): Promise<ConversationRecordingSummary> {
    const existing = this.activeByAgent.get(input.agentId);
    if (existing) {
      return summarize(await this.read(input.agentId, existing.recordingId));
    }

    const now = this.clock.nowDate();
    const startedAtMonotonicMs = this.clock.nowMonotonicMs();
    const recording: ConversationRecording = {
      recordingId: randomUUID(),
      agentId: input.agentId,
      provider: input.provider,
      cwd: input.cwd,
      startedAt: now.toISOString(),
      stoppedAt: null,
      status: "recording",
      title: input.title?.trim() || null,
      events: [],
      edits: {},
    };
    await this.write(recording);
    this.activeByAgent.set(input.agentId, {
      recordingId: recording.recordingId,
      startedAtMs: now.getTime(),
      startedAtMonotonicMs,
      nextSeq: 1,
    });
    return summarize(recording);
  }

  async stop(agentId: string, recordingId?: string): Promise<ConversationRecordingSummary | null> {
    const active = this.activeByAgent.get(agentId);
    const resolvedRecordingId = recordingId ?? active?.recordingId;
    if (!resolvedRecordingId) {
      return null;
    }

    await this.flush(agentId);
    const recording = await this.read(agentId, resolvedRecordingId);
    if (recording.status === "recording") {
      recording.status = "stopped";
      recording.stoppedAt = this.clock.nowDate().toISOString();
      await this.write(recording);
    }
    if (active?.recordingId === resolvedRecordingId) {
      this.activeByAgent.delete(agentId);
    }
    return summarize(recording);
  }

  async list(agentId: string): Promise<ConversationRecordingSummary[]> {
    const dir = this.agentDir(agentId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const recordings = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            return summarize(await this.read(agentId, entry.slice(0, -".json".length)));
          } catch {
            return null;
          }
        }),
    );
    return recordings
      .filter((recording): recording is ConversationRecordingSummary => recording !== null)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  async get(agentId: string, recordingId: string): Promise<ConversationRecording> {
    await this.flush(agentId);
    return this.read(agentId, recordingId);
  }

  async updateEdits(
    agentId: string,
    recordingId: string,
    edits: ConversationRecordingEdits,
  ): Promise<ConversationRecording> {
    await this.flush(agentId);
    const recording = await this.read(agentId, recordingId);
    recording.edits = edits;
    await this.write(recording);
    return recording;
  }

  recordUserInput(agentId: string, payload: UserInputRecordingPayload): void {
    this.enqueueAppend(agentId, "user_input", payload);
  }

  recordAgentStreamEvent(agentId: string, event: AgentStreamEvent): void {
    const serialized = serializeAgentStreamEvent(event);
    if (!serialized) {
      return;
    }
    this.enqueueAppend(agentId, "agent_stream_raw", { event: serialized });
  }

  private enqueueAppend(
    agentId: string,
    kind: ConversationRecordingEvent["kind"],
    payload: ConversationRecordingEvent["payload"],
  ): void {
    const active = this.activeByAgent.get(agentId);
    if (!active) {
      return;
    }
    const recordedAt = this.clock.nowDate();
    const offsetMsPrecise = Math.max(0, this.clock.nowMonotonicMs() - active.startedAtMonotonicMs);
    const event = createRecordingEvent({
      seq: active.nextSeq,
      recordedAt: recordedAt.toISOString(),
      offsetMs: Math.max(0, recordedAt.getTime() - active.startedAtMs),
      offsetMsPrecise,
      kind,
      payload,
    });
    active.nextSeq += 1;

    const previous = this.writeTails.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const recording = await this.read(agentId, active.recordingId);
        if (recording.status !== "recording") {
          return undefined;
        }
        recording.events.push(event);
        await this.write(recording);
        return undefined;
      });
    this.writeTails.set(agentId, next);
    void next.catch(() => undefined);
  }

  private async flush(agentId: string): Promise<void> {
    await (this.writeTails.get(agentId) ?? Promise.resolve());
  }

  private async read(agentId: string, recordingId: string): Promise<ConversationRecording> {
    const raw = await readFile(this.recordingPath(agentId, recordingId), "utf8");
    return ConversationRecordingSchema.parse(JSON.parse(raw));
  }

  private async write(recording: ConversationRecording): Promise<void> {
    const dir = this.agentDir(recording.agentId);
    await mkdir(dir, { recursive: true });
    const path = this.recordingPath(recording.agentId, recording.recordingId);
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  }

  private agentDir(agentId: string): string {
    return join(this.rootDir, agentId);
  }

  private recordingPath(agentId: string, recordingId: string): string {
    return join(this.agentDir(agentId), `${recordingId}.json`);
  }
}

function createRecordingEvent(input: {
  seq: number;
  recordedAt: string;
  offsetMs: number;
  offsetMsPrecise: number;
  kind: ConversationRecordingEvent["kind"];
  payload: ConversationRecordingEvent["payload"];
}): ConversationRecordingEvent {
  if (input.kind === "user_input") {
    return {
      seq: input.seq,
      recordedAt: input.recordedAt,
      offsetMs: input.offsetMs,
      offsetMsPrecise: input.offsetMsPrecise,
      kind: input.kind,
      payload: input.payload as UserInputRecordingEvent["payload"],
    };
  }
  return {
    seq: input.seq,
    recordedAt: input.recordedAt,
    offsetMs: input.offsetMs,
    offsetMsPrecise: input.offsetMsPrecise,
    kind: input.kind,
    payload: input.payload as AgentStreamRawRecordingEvent["payload"],
  };
}
