import type {
  ConversationRecordingEdit,
  ConversationRecordingEdits,
  ConversationRecordingEvent,
  ConversationRecording,
  AgentStreamEventPayload,
} from "@getpaseo/protocol/messages";
import type { AssistantMessageItem, StreamItem, ThoughtItem } from "@/types/stream";

export interface ReplayEventView {
  event: ConversationRecordingEvent;
  edit: ConversationRecordingEdit | undefined;
  effectiveOffsetMs: number;
  scheduledOffsetMs: number;
  hidden: boolean;
}

export type ReplayClipKind = "user" | "assistant" | "reasoning" | "tool" | "other";

export interface ReplayClipView {
  id: string;
  kind: ReplayClipKind;
  events: ReplayEventView[];
  firstSeq: number;
  effectiveOffsetMs: number;
  scheduledOffsetMs: number;
  durationMs: number;
  hidden: boolean;
  title: string;
  shortLabel: string;
  preview: string;
}

export interface ReplayProjection {
  items: StreamItem[];
  visibleEvents: ReplayEventView[];
  durationMs: number;
}

export interface ConversationTimelineReplayProjection extends ReplayProjection {
  beforeItems: StreamItem[];
  afterItems: StreamItem[];
}

export const REPLAY_TEXT_BURST_MIN_INTERVAL_MS = 100;
const REPLAY_BASELINE_DUPLICATE_GRACE_MS = 30_000;

export function getReplayEventView(
  event: ConversationRecordingEvent,
  edits: ConversationRecordingEdits,
): ReplayEventView {
  const edit = edits[String(event.seq)];
  const rawOffsetMs = event.offsetMsPrecise ?? event.offsetMs;
  const effectiveOffsetMs = edit?.offsetMs ?? rawOffsetMs;
  return {
    event,
    edit,
    effectiveOffsetMs,
    scheduledOffsetMs: effectiveOffsetMs,
    hidden: edit?.hidden === true,
  };
}

export function listReplayEvents(
  events: readonly ConversationRecordingEvent[],
  edits: ConversationRecordingEdits,
): ReplayEventView[] {
  const ordered = events
    .map((event) => getReplayEventView(event, edits))
    .sort((a, b) => a.effectiveOffsetMs - b.effectiveOffsetMs || a.event.seq - b.event.seq);
  let previousVisibleScheduledOffsetMs: number | null = null;
  const scheduled: ReplayEventView[] = [];
  for (const entry of ordered) {
    if (entry.hidden) {
      scheduled.push(entry);
      continue;
    }
    const isEditableOffset = entry.edit?.offsetMs !== undefined;
    const hasPreciseOffset = entry.event.offsetMsPrecise !== undefined;
    const shouldApplyDefaultSpacing = isReplayAutoSpacedEvent(entry.event);
    const scheduledOffsetMs: number =
      previousVisibleScheduledOffsetMs !== null &&
      shouldApplyDefaultSpacing &&
      !isEditableOffset &&
      !hasPreciseOffset
        ? Math.max(
            entry.effectiveOffsetMs,
            previousVisibleScheduledOffsetMs + REPLAY_TEXT_BURST_MIN_INTERVAL_MS,
          )
        : entry.effectiveOffsetMs;
    previousVisibleScheduledOffsetMs = scheduledOffsetMs;
    scheduled.push(Object.assign({}, entry, { scheduledOffsetMs }));
  }
  return scheduled;
}

export function listReplayClips(
  events: readonly ConversationRecordingEvent[],
  edits: ConversationRecordingEdits,
): ReplayClipView[] {
  const eventViews = listReplayEvents(events, edits);
  const clips: ReplayClipView[] = [];
  let currentGroup: ReplayEventView[] = [];
  let currentGroupKey: string | null = null;

  const flushGroup = () => {
    if (currentGroup.length === 0) {
      return;
    }
    clips.push(createReplayClip(currentGroup));
    currentGroup = [];
    currentGroupKey = null;
  };

  for (const eventView of eventViews) {
    const groupKey = getReplayClipGroupKey(eventView);
    if (!groupKey) {
      continue;
    }
    if (currentGroupKey !== groupKey) {
      flushGroup();
      currentGroupKey = groupKey;
    }
    currentGroup.push(eventView);
  }
  flushGroup();
  return clips.sort((a, b) => a.scheduledOffsetMs - b.scheduledOffsetMs || a.firstSeq - b.firstSeq);
}

export function projectConversationReplay(input: {
  events: readonly ConversationRecordingEvent[];
  edits: ConversationRecordingEdits;
  positionMs: number;
}): ReplayProjection {
  const ordered = listReplayEvents(input.events, input.edits);
  const visibleEvents = ordered.filter((entry) => !entry.hidden);
  const durationMs = visibleEvents.reduce(
    (max, entry) =>
      isReplayProjectedEvent(entry.event) ? Math.max(max, entry.scheduledOffsetMs) : max,
    0,
  );

  const tail: StreamItem[] = [];
  for (const entry of visibleEvents) {
    if (entry.scheduledOffsetMs > input.positionMs) {
      break;
    }
    const event = entry.event;
    const timestamp = new Date(event.recordedAt);
    if (event.kind === "user_input") {
      tail.push({
        kind: "user_message",
        id: `replay_user_${event.seq}`,
        text: event.payload.text,
        timestamp,
        ...(event.payload.attachments ? { attachments: event.payload.attachments } : {}),
      });
      continue;
    }
    if (event.kind === "agent_stream_raw") {
      projectAgentStreamRawEvent({
        tail,
        event: event.payload.event,
        seq: event.seq,
        timestamp,
      });
    }
  }

  return {
    items: tail,
    visibleEvents,
    durationMs,
  };
}

function isReplayAutoSpacedEvent(event: ConversationRecordingEvent): boolean {
  return event.kind === "agent_stream_raw";
}

function isReplayProjectedEvent(event: ConversationRecordingEvent): boolean {
  if (event.kind === "user_input") {
    return true;
  }
  if (event.kind !== "agent_stream_raw") {
    return false;
  }
  return event.payload.event.type === "timeline";
}

function getReplayClipGroupKey(entry: ReplayEventView): string | null {
  if (entry.event.kind === "user_input") {
    return `user:${entry.event.seq}`;
  }
  if (entry.event.kind !== "agent_stream_raw") {
    return null;
  }
  const streamEvent = entry.event.payload.event;
  if (streamEvent.type !== "timeline") {
    return null;
  }
  const item = streamEvent.item;
  if (item.type === "assistant_message") {
    return `assistant:${item.messageId ?? "run"}`;
  }
  if (item.type === "reasoning") {
    return "reasoning:run";
  }
  if (item.type === "tool_call") {
    return `tool:${item.callId}`;
  }
  if (item.type === "todo") {
    return `todo:${entry.event.seq}`;
  }
  if (item.type === "error") {
    return `error:${entry.event.seq}`;
  }
  if (item.type === "compaction") {
    return `compaction:${entry.event.seq}`;
  }
  return `other:${entry.event.seq}`;
}

function createReplayClip(events: ReplayEventView[]): ReplayClipView {
  const first = events[0];
  if (!first) {
    throw new Error("Cannot create replay clip without events");
  }
  const kind = getReplayClipKind(first);
  const firstSeq = Math.min(...events.map((entry) => entry.event.seq));
  const scheduledOffsetMs = Math.min(...events.map((entry) => entry.scheduledOffsetMs));
  const effectiveOffsetMs = Math.min(...events.map((entry) => entry.effectiveOffsetMs));
  const lastScheduledOffsetMs = Math.max(...events.map((entry) => entry.scheduledOffsetMs));
  const durationMs = Math.max(0, lastScheduledOffsetMs - scheduledOffsetMs);
  const hidden = events.every((entry) => entry.hidden);
  return {
    id: `${kind}:${firstSeq}`,
    kind,
    events,
    firstSeq,
    effectiveOffsetMs,
    scheduledOffsetMs,
    durationMs,
    hidden,
    ...getReplayClipText(events, kind),
  };
}

function getReplayClipKind(entry: ReplayEventView): ReplayClipKind {
  if (entry.event.kind === "user_input") {
    return "user";
  }
  if (entry.event.kind !== "agent_stream_raw") {
    return "other";
  }
  const streamEvent = entry.event.payload.event;
  if (streamEvent.type !== "timeline") {
    return "other";
  }
  if (streamEvent.item.type === "assistant_message") {
    return "assistant";
  }
  if (streamEvent.item.type === "reasoning") {
    return "reasoning";
  }
  if (streamEvent.item.type === "tool_call") {
    return "tool";
  }
  return "other";
}

function getReplayClipText(
  events: ReplayEventView[],
  kind: ReplayClipKind,
): Pick<ReplayClipView, "preview" | "shortLabel" | "title"> {
  const first = events[0];
  if (!first) {
    return { title: "Clip", shortLabel: "Clip", preview: "" };
  }
  if (kind === "user" && first.event.kind === "user_input") {
    return {
      title: "User message",
      shortLabel: "User",
      preview: first.event.payload.text,
    };
  }
  if (first.event.kind !== "agent_stream_raw") {
    return { title: "Event", shortLabel: "Event", preview: first.event.kind };
  }
  const streamEvent = first.event.payload.event;
  if (streamEvent.type !== "timeline") {
    return { title: streamEvent.type, shortLabel: streamEvent.type, preview: streamEvent.type };
  }
  const item = streamEvent.item;
  if (kind === "assistant") {
    return {
      title: "Assistant message",
      shortLabel: "AI",
      preview: events
        .map((entry) =>
          entry.event.kind === "agent_stream_raw" &&
          entry.event.payload.event.type === "timeline" &&
          entry.event.payload.event.item.type === "assistant_message"
            ? entry.event.payload.event.item.text
            : "",
        )
        .join(""),
    };
  }
  if (kind === "reasoning") {
    return {
      title: "Reasoning",
      shortLabel: "Think",
      preview: events
        .map((entry) =>
          entry.event.kind === "agent_stream_raw" &&
          entry.event.payload.event.type === "timeline" &&
          entry.event.payload.event.item.type === "reasoning"
            ? entry.event.payload.event.item.text
            : "",
        )
        .join(""),
    };
  }
  if (item.type === "tool_call") {
    return {
      title: item.name,
      shortLabel: item.name,
      preview: item.detail?.type === "shell" ? item.detail.command : item.name,
    };
  }
  if (item.type === "todo") {
    return {
      title: "Todo",
      shortLabel: "Todo",
      preview: `${item.items.length} todo items`,
    };
  }
  if (item.type === "error") {
    return { title: "Error", shortLabel: "Error", preview: item.message };
  }
  return { title: item.type, shortLabel: item.type, preview: item.type };
}

function appendOrMergeAssistantMessage(input: {
  tail: StreamItem[];
  seq: number;
  text: string;
  messageId?: string;
  timestamp: Date;
}): void {
  if (!input.text) {
    return;
  }
  const last = input.tail.at(-1);
  if (
    last?.kind === "assistant_message" &&
    (input.messageId === undefined || last.messageId === input.messageId)
  ) {
    const updated: AssistantMessageItem = {
      ...last,
      text: `${last.text}${input.text}`,
      timestamp: input.timestamp,
    };
    input.tail[input.tail.length - 1] = updated;
    return;
  }
  input.tail.push({
    kind: "assistant_message",
    id: `replay_assistant_${input.seq}`,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    text: input.text,
    timestamp: input.timestamp,
  });
}

function appendOrMergeThought(input: {
  tail: StreamItem[];
  seq: number;
  text: string;
  timestamp: Date;
}): void {
  if (!input.text) {
    return;
  }
  const last = input.tail.at(-1);
  if (last?.kind === "thought") {
    const updated: ThoughtItem = {
      ...last,
      text: `${last.text}${input.text}`,
      timestamp: input.timestamp,
      status: "ready",
    };
    input.tail[input.tail.length - 1] = updated;
    return;
  }
  input.tail.push({
    kind: "thought",
    id: `replay_reasoning_${input.seq}`,
    text: input.text,
    timestamp: input.timestamp,
    status: "ready",
  });
}

function projectAgentStreamRawEvent(input: {
  tail: StreamItem[];
  event: AgentStreamEventPayload;
  seq: number;
  timestamp: Date;
}): void {
  const streamEvent = input.event;
  if (streamEvent.type !== "timeline") {
    return;
  }
  const item = streamEvent.item;
  if (item.type === "assistant_message") {
    appendOrMergeAssistantMessage({
      tail: input.tail,
      seq: input.seq,
      text: item.text,
      messageId: item.messageId,
      timestamp: input.timestamp,
    });
  } else if (item.type === "reasoning") {
    appendOrMergeThought({
      tail: input.tail,
      seq: input.seq,
      text: item.text,
      timestamp: input.timestamp,
    });
  } else if (item.type === "error") {
    input.tail.push({
      kind: "activity_log",
      id: `replay_error_${input.seq}`,
      timestamp: input.timestamp,
      activityType: "error",
      message: item.message,
    });
  } else if (item.type === "todo") {
    input.tail.push({
      kind: "todo_list",
      id: `replay_todo_${input.seq}`,
      timestamp: input.timestamp,
      provider: streamEvent.provider,
      items: item.items,
    });
  } else if (item.type === "compaction") {
    input.tail.push({
      kind: "compaction",
      id: `replay_compaction_${input.seq}`,
      timestamp: input.timestamp,
      status: item.status,
      trigger: item.trigger,
      preTokens: item.preTokens,
    });
  } else if (item.type === "tool_call") {
    input.tail.push({
      kind: "tool_call",
      id: `replay_tool_${item.callId}_${input.seq}`,
      timestamp: input.timestamp,
      payload: {
        source: "agent",
        data: {
          provider: streamEvent.provider,
          callId: item.callId,
          name: item.name,
          status: item.status,
          error: "error" in item ? item.error : null,
          detail: item.detail,
          metadata: item.metadata,
        },
      },
    });
  }
}

function getItemTime(item: StreamItem): number {
  const value =
    item.timestamp instanceof Date ? item.timestamp.getTime() : Date.parse(String(item.timestamp));
  return Number.isFinite(value) ? value : 0;
}

export function projectConversationTimelineReplay(input: {
  baselineItems: readonly StreamItem[];
  recording: ConversationRecording;
  positionMs: number;
}): ConversationTimelineReplayProjection {
  const recordingProjection = projectConversationReplay({
    events: input.recording.events,
    edits: input.recording.edits,
    positionMs: input.positionMs,
  });
  const startedAtMs = Date.parse(input.recording.startedAt);
  const stoppedAtMs = input.recording.stoppedAt
    ? Date.parse(input.recording.stoppedAt)
    : startedAtMs + recordingProjection.durationMs;
  const hasValidWindow = Number.isFinite(startedAtMs) && Number.isFinite(stoppedAtMs);
  const recordedItemSignatures = getRecordingItemSignatures(input.recording.events);
  const beforeItems: StreamItem[] = [];
  const afterItems: StreamItem[] = [];

  for (const item of input.baselineItems) {
    const itemTime = getItemTime(item);
    if (
      hasValidWindow &&
      isBaselineRecordingDuplicate({
        item,
        itemTime,
        recordedItemSignatures,
        startedAtMs,
        stoppedAtMs,
      })
    ) {
      continue;
    }
    if (!hasValidWindow || itemTime < startedAtMs) {
      beforeItems.push(item);
    } else if (itemTime > stoppedAtMs) {
      afterItems.push(item);
    }
  }

  const shouldShowAfterItems = input.positionMs >= recordingProjection.durationMs;
  return {
    ...recordingProjection,
    beforeItems,
    afterItems,
    items: [
      ...beforeItems,
      ...recordingProjection.items,
      ...(shouldShowAfterItems ? afterItems : []),
    ],
  };
}

function getRecordingItemSignatures(
  events: readonly ConversationRecordingEvent[],
): Set<string> {
  const signatures = new Set<string>();
  for (const event of events) {
    if (event.kind === "user_input") {
      signatures.add(getTextSignature("user_message", event.payload.text));
      continue;
    }
    if (event.kind !== "agent_stream_raw") {
      continue;
    }
    const streamEvent = event.payload.event;
    if (streamEvent.type !== "timeline") {
      continue;
    }
    const item = streamEvent.item;
    if (item.type === "assistant_message") {
      signatures.add(getTextSignature("assistant_message", item.text));
    }
  }
  return signatures;
}

function isBaselineRecordingDuplicate(input: {
  item: StreamItem;
  itemTime: number;
  recordedItemSignatures: Set<string>;
  startedAtMs: number;
  stoppedAtMs: number;
}): boolean {
  if (
    input.itemTime < input.startedAtMs - REPLAY_BASELINE_DUPLICATE_GRACE_MS ||
    input.itemTime > input.stoppedAtMs + REPLAY_BASELINE_DUPLICATE_GRACE_MS
  ) {
    return false;
  }
  const signature = getStreamItemTextSignature(input.item);
  return signature !== null && input.recordedItemSignatures.has(signature);
}

function getStreamItemTextSignature(item: StreamItem): string | null {
  if (item.kind === "user_message" || item.kind === "assistant_message") {
    return getTextSignature(item.kind, item.text);
  }
  return null;
}

function getTextSignature(kind: "user_message" | "assistant_message", text: string): string {
  return `${kind}:${text.trim()}`;
}
