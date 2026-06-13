import { describe, expect, it } from "vitest";
import { advanceReplayClock, resolveRecordingToggleAction } from "./conversation-replay-controls";

describe("conversation replay composer controls", () => {
  it("starts recording when no active recording exists", () => {
    expect(resolveRecordingToggleAction(null)).toEqual({ kind: "start" });
  });

  it("stops the active recording when one exists", () => {
    expect(resolveRecordingToggleAction("recording-1")).toEqual({
      kind: "stop",
      recordingId: "recording-1",
    });
  });

  it("does not advance replay on the first clock frame", () => {
    const first = advanceReplayClock({
      positionMs: 0,
      lastFrameMs: null,
      frameMs: 10_000,
      speed: 1,
      durationMs: 5_000,
    });
    expect(first).toEqual({ positionMs: 0, lastFrameMs: 10_000, isPlaying: true });

    const second = advanceReplayClock({
      positionMs: first.positionMs,
      lastFrameMs: first.lastFrameMs,
      frameMs: 10_250,
      speed: 1,
      durationMs: 5_000,
    });
    expect(second).toEqual({ positionMs: 250, lastFrameMs: 10_250, isPlaying: true });
  });

  it("honors replay speed and clamps to duration", () => {
    expect(
      advanceReplayClock({
        positionMs: 900,
        lastFrameMs: 1_000,
        frameMs: 1_200,
        speed: 2,
        durationMs: 1_000,
      }),
    ).toEqual({ positionMs: 1_000, lastFrameMs: 1_200, isPlaying: false });
  });
});
