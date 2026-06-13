export type ConversationReplaySpeed = 0.5 | 1 | 2 | 4;

export interface RecordingToggleAction {
  kind: "start" | "stop";
  recordingId?: string;
}

export interface ReplayClockAdvanceInput {
  positionMs: number;
  lastFrameMs: number | null;
  frameMs: number;
  speed: ConversationReplaySpeed;
  durationMs: number;
}

export interface ReplayClockAdvanceResult {
  positionMs: number;
  lastFrameMs: number;
  isPlaying: boolean;
}

export function resolveRecordingToggleAction(
  activeRecordingId: string | null,
): RecordingToggleAction {
  return activeRecordingId ? { kind: "stop", recordingId: activeRecordingId } : { kind: "start" };
}

export function advanceReplayClock(input: ReplayClockAdvanceInput): ReplayClockAdvanceResult {
  const safeDurationMs = Math.max(0, input.durationMs);
  const safePositionMs = Math.min(Math.max(0, input.positionMs), safeDurationMs);
  const elapsedMs = input.lastFrameMs === null ? 0 : Math.max(0, input.frameMs - input.lastFrameMs);
  const nextPositionMs = Math.min(safeDurationMs, safePositionMs + elapsedMs * input.speed);
  return {
    positionMs: nextPositionMs,
    lastFrameMs: input.frameMs,
    isPlaying: nextPositionMs < safeDurationMs,
  };
}
