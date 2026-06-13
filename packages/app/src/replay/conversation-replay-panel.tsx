import type {
  ConversationRecording,
  ConversationRecordingEdits,
  ConversationRecordingSummary,
} from "@getdoya/protocol/messages";
import {
  Check,
  Clapperboard,
  Eye,
  EyeOff,
  ListTree,
  Maximize2,
  Minus,
  Plus,
  Redo2,
  Radio,
  RotateCcw,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  type LayoutChangeEvent,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useI18n } from "@/i18n/i18n";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { type ReplayClipView, type ReplayEventView, listReplayClips } from "./conversation-replay";

const TIMELINE_MIN_WIDTH = 860;
const TIMELINE_TRACK_HEIGHT = 132;
const TIMELINE_CLIP_MIN_WIDTH = 72;
const TIMELINE_CLIP_DEFAULT_WIDTH = 96;
const TIMELINE_END_PADDING = 160;
const TIMELINE_GRID_WIDTH = 160;
const TIMELINE_RIPPLE_MIN_GAP_MS = 100;
const DEFAULT_REMOVE_GAP_RATIO_PERCENT = "10";
const DEFAULT_REMOVE_GAP_SECONDS = "1";
const ITEM_TIMELINE_GRID_STEPS_MS = [1000, 2000, 5000, 10000, 30000];
const EVENT_TIMELINE_GRID_STEPS_MS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const DEFAULT_ITEM_TIMELINE_GRID_STEP_MS = 1000;
const DEFAULT_EVENT_TIMELINE_GRID_STEP_MS = 10;
const TIMELINE_RENDER_BUFFER_PX = 640;
const TIMELINE_LANE_TOP = {
  user: 34,
  assistant: 70,
  other: 106,
} as const;
const EVENT_NUDGE_MS = 100;
const TIMELINE_CLIP_WEB_DRAG_STYLE = isWeb
  ? ({ cursor: "grab", touchAction: "none", userSelect: "none" } as unknown as ViewStyle)
  : null;
const TIMELINE_RANGE_HANDLE_WEB_STYLE = isWeb
  ? ({ cursor: "ew-resize", touchAction: "none", userSelect: "none" } as unknown as ViewStyle)
  : null;

type RemoveGapMode = "ratio" | "time";

interface PointerLikeEvent {
  clientX?: number;
  currentTarget?: {
    getBoundingClientRect?: () => { left: number };
  };
  nativeEvent?: {
    clientX?: number;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  };
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export function ConversationReplayPanel({
  visible,
  serverId,
  agent,
  onStartReplay,
  onClose,
}: {
  visible: boolean;
  serverId: string;
  agent: AgentScreenAgent;
  onStartReplay: (recording: ConversationRecording) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [recordings, setRecordings] = useState<ConversationRecordingSummary[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<ConversationRecording | null>(null);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [selectedRawSeq, setSelectedRawSeq] = useState<number | null>(null);
  const [selectedSeqs, setSelectedSeqs] = useState<number[]>([]);
  const [selectedRangeMs, setSelectedRangeMs] = useState<{ startMs: number; endMs: number } | null>(
    null,
  );
  const [undoStack, setUndoStack] = useState<ConversationRecordingEdits[]>([]);
  const [redoStack, setRedoStack] = useState<ConversationRecordingEdits[]>([]);
  const [itemTimelineGridStepMs, setItemTimelineGridStepMs] = useState(
    DEFAULT_ITEM_TIMELINE_GRID_STEP_MS,
  );
  const [eventTimelineGridStepMs, setEventTimelineGridStepMs] = useState(
    DEFAULT_EVENT_TIMELINE_GRID_STEP_MS,
  );
  const [removeGapMode, setRemoveGapMode] = useState<RemoveGapMode>("ratio");
  const [removeGapRatioPercent, setRemoveGapRatioPercent] = useState(
    DEFAULT_REMOVE_GAP_RATIO_PERCENT,
  );
  const [removeGapSeconds, setRemoveGapSeconds] = useState(DEFAULT_REMOVE_GAP_SECONDS);
  const [isRemoveGapSettingsOpen, setIsRemoveGapSettingsOpen] = useState(false);
  const [isEventEditorOpen, setIsEventEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecordings = useCallback(async () => {
    if (!client) {
      return;
    }
    const list = await client.listConversationRecordings(agent.id);
    setRecordings(list);
    if (!selectedRecording && list[0]) {
      setSelectedRecording(await client.getConversationRecording(agent.id, list[0].recordingId));
    }
  }, [agent.id, client, selectedRecording]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setError(null);
    void loadRecordings().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : t("replay.error.loadRecordings"));
    });
  }, [loadRecordings, t, visible]);

  const clipViews = useMemo(
    () =>
      selectedRecording ? listReplayClips(selectedRecording.events, selectedRecording.edits) : [],
    [selectedRecording],
  );
  const selectedEvent = useMemo(
    () => clipViews.find((entry) => entry.firstSeq === selectedSeq) ?? clipViews[0] ?? null,
    [clipViews, selectedSeq],
  );
  const selectedEventViews = useMemo(
    () => clipViews.filter((entry) => selectedSeqs.includes(entry.firstSeq)),
    [clipViews, selectedSeqs],
  );
  const visibleEventSeqs = useMemo(
    () => new Set(clipViews.map((entry) => entry.firstSeq)),
    [clipViews],
  );
  const laneLabels = useMemo(
    () => ({
      user: t("replay.lane.user"),
      assistant: t("replay.lane.assistant"),
      system: t("replay.lane.system"),
    }),
    [t],
  );
  const inspectorLabels = useMemo(
    () => ({
      time: t("replay.editor.time"),
      seconds: t("replay.editor.seconds"),
      visible: t("replay.editor.visible"),
      hidden: t("replay.editor.hidden"),
      reset: t("replay.action.reset"),
      resetAll: t("replay.action.resetAll"),
      resetSelected: t("replay.action.resetSelected"),
      previous: t("replay.action.previousClip"),
      next: t("replay.action.nextClip"),
      nudgeLeft: t("replay.action.nudgeLeft"),
      nudgeRight: t("replay.action.nudgeRight"),
      snap: t("replay.action.snap"),
      fitTimeline: t("replay.action.fitTimeline"),
      undo: t("replay.action.undo"),
      redo: t("replay.action.redo"),
      selectAll: t("replay.action.selectAll"),
      clearSelection: t("replay.action.clearSelection"),
      hideSelected: t("replay.action.hideSelected"),
      showSelected: t("replay.action.showSelected"),
      compactSelected: t("replay.action.compactSelected"),
      rippleDeleteSelected: t("replay.action.rippleDeleteSelected"),
      removeGapRatioMode: t("replay.action.removeGapRatioMode"),
      removeGapTimeMode: t("replay.action.removeGapTimeMode"),
      removeGapStep: t("replay.action.removeGapStep"),
      editEvents: t("replay.action.editEvents"),
      doneEditingEvents: t("replay.action.doneEditingEvents"),
      selectedCount: t("replay.editor.selectedCount", { count: selectedSeqs.length }),
      shortcutHint: t("replay.editor.shortcutHint"),
    }),
    [selectedSeqs.length, t],
  );
  const eventLabels = useMemo(
    () => ({
      ai: t("replay.event.ai"),
      emptyTextChunk: t("replay.event.emptyTextChunk"),
      emptyUserInput: t("replay.event.emptyUserInput"),
      itemEvents: t("replay.events.title"),
      itemEventsDescription: t("replay.events.description"),
      reasoning: t("replay.event.reasoning"),
      rawEvent: t("replay.event.rawEvent"),
      rangeEnd: t("replay.range.end"),
      rangeStart: t("replay.range.start"),
      selectEvent: t("replay.timeline.selectEvent"),
      todoItems: t("replay.event.todoItems"),
      user: t("replay.event.user"),
      userInput: t("replay.event.userInput"),
    }),
    [t],
  );
  const eventTimelineViews = useMemo(
    () =>
      selectedEvent
        ? selectedEvent.events.map((entry) => createRawEventTimelineEntry(entry, eventLabels))
        : [],
    [eventLabels, selectedEvent],
  );
  const activeTimelineViews = isEventEditorOpen ? eventTimelineViews : clipViews;
  const activePrimarySelectedSeq = isEventEditorOpen
    ? (selectedRawSeq ?? eventTimelineViews[0]?.firstSeq ?? null)
    : (selectedEvent?.firstSeq ?? null);
  const activeSelectedSeqs = useMemo(() => {
    if (!isEventEditorOpen) {
      return selectedSeqs;
    }
    if (activePrimarySelectedSeq === null) {
      return [];
    }
    return [activePrimarySelectedSeq];
  }, [activePrimarySelectedSeq, isEventEditorOpen, selectedSeqs]);
  const timelineDurationMs = useMemo(
    () => getTimelineRange(activeTimelineViews, isEventEditorOpen).durationMs,
    [activeTimelineViews, isEventEditorOpen],
  );
  const timelineStartMs = useMemo(
    () => getTimelineRange(activeTimelineViews, isEventEditorOpen).startMs,
    [activeTimelineViews, isEventEditorOpen],
  );
  const activeTimelineGridStepMs = isEventEditorOpen
    ? eventTimelineGridStepMs
    : itemTimelineGridStepMs;
  const timelineZoom = (TIMELINE_GRID_WIDTH * 1000) / activeTimelineGridStepMs;
  const timelineWidth = useMemo(
    () =>
      Math.max(
        TIMELINE_MIN_WIDTH,
        Math.ceil(timelineDurationMs / activeTimelineGridStepMs) * TIMELINE_GRID_WIDTH +
          TIMELINE_END_PADDING,
      ),
    [activeTimelineGridStepMs, timelineDurationMs],
  );
  const timelineTicks = useMemo(
    () => buildTimelineTicks(timelineStartMs, timelineDurationMs, activeTimelineGridStepMs),
    [activeTimelineGridStepMs, timelineDurationMs, timelineStartMs],
  );

  useEffect(() => {
    if (clipViews.length === 0) {
      setSelectedSeq(null);
      return;
    }
    if (!clipViews.some((entry) => entry.firstSeq === selectedSeq)) {
      setSelectedSeq(clipViews[0].firstSeq);
    }
    setSelectedSeqs((current) => current.filter((seq) => visibleEventSeqs.has(seq)));
  }, [clipViews, selectedSeq, visibleEventSeqs]);
  useEffect(() => {
    if (!isEventEditorOpen) {
      setSelectedRawSeq(null);
      return;
    }
    if (eventTimelineViews.length === 0) {
      setSelectedRawSeq(null);
      return;
    }
    if (!eventTimelineViews.some((entry) => entry.firstSeq === selectedRawSeq)) {
      setSelectedRawSeq(eventTimelineViews[0].firstSeq);
    }
  }, [eventTimelineViews, isEventEditorOpen, selectedRawSeq]);
  const handleStartRecordingReplay = useCallback(
    (recordingId: string) => {
      const cachedRecording =
        selectedRecording?.recordingId === recordingId ? selectedRecording : null;
      if (!client) {
        if (cachedRecording) {
          onStartReplay(cachedRecording);
        }
        return;
      }
      void client
        .getConversationRecording(agent.id, recordingId)
        .then((recording) => {
          setSelectedRecording(recording);
          setSelectedSeq(recording.events[0]?.seq ?? null);
          setSelectedSeqs(recording.events[0] ? [recording.events[0].seq] : []);
          setUndoStack([]);
          setRedoStack([]);
          onStartReplay(recording);
          return undefined;
        })
        .catch(() => {
          if (cachedRecording) {
            onStartReplay(cachedRecording);
          }
        });
    },
    [agent.id, client, onStartReplay, selectedRecording],
  );

  const selectRecording = useCallback(
    async (recordingId: string) => {
      if (!client) {
        return;
      }
      setError(null);
      try {
        const recording = await client.getConversationRecording(agent.id, recordingId);
        setSelectedRecording(recording);
        setSelectedSeq(recording.events[0]?.seq ?? null);
        setSelectedSeqs(recording.events[0] ? [recording.events[0].seq] : []);
        setUndoStack([]);
        setRedoStack([]);
      } catch (selectError) {
        setError(
          selectError instanceof Error ? selectError.message : t("replay.error.loadRecording"),
        );
      }
    },
    [agent.id, client, t],
  );

  const persistEdits = useCallback(
    async (edits: ConversationRecordingEdits) => {
      if (!client || !selectedRecording) {
        return;
      }
      const updated = await client.updateConversationRecordingEdits(
        agent.id,
        selectedRecording.recordingId,
        edits,
      );
      setSelectedRecording(updated);
    },
    [agent.id, client, selectedRecording],
  );
  const updateEdits = useCallback(
    async (edits: ConversationRecordingEdits) => {
      if (!selectedRecording) {
        return;
      }
      setUndoStack((current) => [...current, selectedRecording.edits]);
      setRedoStack([]);
      setSelectedRecording((current) => (current ? { ...current, edits } : current));
      await persistEdits(edits);
    },
    [persistEdits, selectedRecording],
  );
  const handleUndoEdit = useCallback(() => {
    if (!selectedRecording || undoStack.length === 0) {
      return;
    }
    const previous = undoStack[undoStack.length - 1];
    if (!previous) {
      return;
    }
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, selectedRecording.edits]);
    void persistEdits(previous).catch((editError) => {
      setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
    });
  }, [persistEdits, selectedRecording, t, undoStack]);
  const handleRedoEdit = useCallback(() => {
    if (!selectedRecording || redoStack.length === 0) {
      return;
    }
    const next = redoStack[redoStack.length - 1];
    if (!next) {
      return;
    }
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, selectedRecording.edits]);
    void persistEdits(next).catch((editError) => {
      setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
    });
  }, [persistEdits, redoStack, selectedRecording, t]);
  const handleResetAllEdits = useCallback(() => {
    if (!selectedRecording || Object.keys(selectedRecording.edits).length === 0) {
      return;
    }
    void updateEdits({}).catch((editError) => {
      setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
    });
  }, [selectedRecording, t, updateEdits]);

  const setEventHidden = useCallback(
    (seq: number, hidden: boolean) => {
      if (!selectedRecording) {
        return;
      }
      const clip = clipViews.find((entry) => entry.firstSeq === seq);
      if (!clip) {
        return;
      }
      const next = { ...selectedRecording.edits };
      for (const eventView of clip.events) {
        const key = String(eventView.event.seq);
        next[key] = { ...next[key], hidden };
      }
      void updateEdits(next).catch((editError) => {
        setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
      });
    },
    [clipViews, selectedRecording, t, updateEdits],
  );
  const updateSelectedEventEdits = useCallback(
    (
      seqs: number[],
      updateEventEdit: (
        entry: ReplayEventView,
        current: NonNullable<ConversationRecordingEdits[string]>,
      ) => ConversationRecordingEdits[string] | null,
    ) => {
      if (!selectedRecording || seqs.length === 0) {
        return;
      }
      const selectedSeqSet = new Set(seqs);
      const next = { ...selectedRecording.edits };
      for (const clip of clipViews) {
        if (!selectedSeqSet.has(clip.firstSeq)) {
          continue;
        }
        for (const eventView of clip.events) {
          const key = String(eventView.event.seq);
          const updated = updateEventEdit(eventView, next[key] ?? {});
          if (updated) {
            next[key] = updated;
          } else {
            delete next[key];
          }
        }
      }
      void updateEdits(next).catch((editError) => {
        setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
      });
    },
    [clipViews, selectedRecording, t, updateEdits],
  );

  const setEventOffsetMs = useCallback(
    (seq: number, offsetMs: number) => {
      if (!selectedRecording) {
        return;
      }
      const clip = clipViews.find((entry) => entry.firstSeq === seq);
      if (!clip) {
        return;
      }
      const next = { ...selectedRecording.edits };
      for (const eventView of clip.events) {
        const key = String(eventView.event.seq);
        const relativeOffsetMs = eventView.scheduledOffsetMs - clip.scheduledOffsetMs;
        next[key] = {
          ...next[key],
          offsetMs: Math.max(0, Math.round(offsetMs + relativeOffsetMs)),
        };
      }
      void updateEdits(next).catch((editError) => {
        setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
      });
    },
    [clipViews, selectedRecording, t, updateEdits],
  );
  const setRawEventHidden = useCallback(
    (seq: number, hidden: boolean) => {
      if (!selectedRecording) {
        return;
      }
      const key = String(seq);
      const next = {
        ...selectedRecording.edits,
        [key]: { ...selectedRecording.edits[key], hidden },
      };
      void updateEdits(next).catch((editError) => {
        setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
      });
    },
    [selectedRecording, t, updateEdits],
  );
  const setRawEventOffsetMs = useCallback(
    (seq: number, offsetMs: number) => {
      if (!selectedRecording) {
        return;
      }
      const key = String(seq);
      const next = {
        ...selectedRecording.edits,
        [key]: { ...selectedRecording.edits[key], offsetMs: Math.max(0, Math.round(offsetMs)) },
      };
      void updateEdits(next).catch((editError) => {
        setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
      });
    },
    [selectedRecording, t, updateEdits],
  );
  const setRawEventOffset = useCallback(
    (seq: number, value: string) => {
      const offsetMs = Math.max(0, Math.floor(Number(value) * 1000));
      if (!Number.isFinite(offsetMs)) {
        return;
      }
      setRawEventOffsetMs(seq, offsetMs);
    },
    [setRawEventOffsetMs],
  );
  const resetRawEventEdit = useCallback(
    (seq: number) => {
      if (!selectedRecording) {
        return;
      }
      const next = { ...selectedRecording.edits };
      delete next[String(seq)];
      void updateEdits(next).catch((editError) => {
        setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
      });
    },
    [selectedRecording, t, updateEdits],
  );

  const resetEventEdit = useCallback(
    (seq: number) => {
      if (!selectedRecording) {
        return;
      }
      const clip = clipViews.find((entry) => entry.firstSeq === seq);
      if (!clip) {
        return;
      }
      const next = { ...selectedRecording.edits };
      for (const eventView of clip.events) {
        delete next[String(eventView.event.seq)];
      }
      void updateEdits(next).catch((editError) => {
        setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
      });
    },
    [clipViews, selectedRecording, t, updateEdits],
  );
  const handleSelectEvent = useCallback((seq: number) => {
    setSelectedSeq(seq);
    setSelectedSeqs([seq]);
  }, []);
  const handleToggleEventSelection = useCallback((seq: number) => {
    setSelectedSeq(seq);
    setSelectedSeqs((current) =>
      current.includes(seq)
        ? current.filter((currentSeq) => currentSeq !== seq)
        : [...current, seq],
    );
  }, []);
  const handleToggleTimelineSelection = useCallback(
    (seq: number) => {
      if (isEventEditorOpen) {
        setSelectedRawSeq(seq);
        return;
      }
      handleToggleEventSelection(seq);
    },
    [handleToggleEventSelection, isEventEditorOpen],
  );
  const handleSelectAllEvents = useCallback(() => {
    setSelectedSeqs(clipViews.map((entry) => entry.firstSeq));
    setSelectedSeq(clipViews[0]?.firstSeq ?? null);
  }, [clipViews]);
  const handleClearSelection = useCallback(() => {
    setSelectedSeqs([]);
    setSelectedRangeMs(null);
  }, []);
  const handleToggleEventEditor = useCallback(() => {
    setIsEventEditorOpen((current) => !current);
  }, []);
  const handleSelectTimelineEntry = useCallback(
    (seq: number) => {
      if (isEventEditorOpen) {
        setSelectedRawSeq(seq);
        return;
      }
      handleSelectEvent(seq);
    },
    [handleSelectEvent, isEventEditorOpen],
  );
  const handleMoveTimelineEntry = useCallback(
    (seq: number, offsetMs: number) => {
      if (isEventEditorOpen) {
        setRawEventOffsetMs(seq, offsetMs);
        return;
      }
      setEventOffsetMs(seq, offsetMs);
    },
    [isEventEditorOpen, setEventOffsetMs, setRawEventOffsetMs],
  );
  const handleSelectTimelineRange = useCallback(
    (startMs: number, endMs: number) => {
      if (isEventEditorOpen) {
        return;
      }
      const rangeStartMs = Math.min(startMs, endMs);
      const rangeEndMs = Math.max(startMs, endMs);
      setSelectedRangeMs({ startMs: rangeStartMs, endMs: rangeEndMs });
      const minimumVisualDurationMs =
        (TIMELINE_CLIP_DEFAULT_WIDTH / Math.max(1, timelineZoom)) * 1000;
      const selected = clipViews.filter((entry) => {
        const entryStartMs = entry.scheduledOffsetMs;
        const entryEndMs = Math.max(
          entryStartMs,
          entryStartMs + entry.durationMs,
          entryStartMs + minimumVisualDurationMs,
        );
        return entryEndMs >= rangeStartMs && entryStartMs <= rangeEndMs;
      });
      const selectedClipSeqs = selected.map((entry) => entry.firstSeq);
      setSelectedSeqs(selectedClipSeqs);
      setSelectedSeq(selected[0]?.firstSeq ?? null);
    },
    [clipViews, isEventEditorOpen, timelineZoom],
  );
  const updateActiveTimelineGridStep = useCallback(
    (direction: "coarser" | "finer") => {
      const steps = isEventEditorOpen ? EVENT_TIMELINE_GRID_STEPS_MS : ITEM_TIMELINE_GRID_STEPS_MS;
      const setStep = isEventEditorOpen ? setEventTimelineGridStepMs : setItemTimelineGridStepMs;
      setStep((current) => getNextTimelineGridStep(current, steps, direction));
    },
    [isEventEditorOpen],
  );
  const handleDecreaseGridStep = useCallback(() => {
    updateActiveTimelineGridStep("finer");
  }, [updateActiveTimelineGridStep]);
  const handleIncreaseGridStep = useCallback(() => {
    updateActiveTimelineGridStep("coarser");
  }, [updateActiveTimelineGridStep]);
  const handleFitTimeline = useCallback(() => {
    const durationSeconds = Math.max(1, timelineDurationMs / 1000);
    const steps = isEventEditorOpen ? EVENT_TIMELINE_GRID_STEPS_MS : ITEM_TIMELINE_GRID_STEPS_MS;
    const targetGridStepMs = Math.max(
      steps[0] ?? DEFAULT_ITEM_TIMELINE_GRID_STEP_MS,
      Math.ceil(
        (durationSeconds * 1000 * TIMELINE_GRID_WIDTH) /
          (TIMELINE_MIN_WIDTH - TIMELINE_END_PADDING),
      ),
    );
    const nextStep = steps.find((step) => step >= targetGridStepMs) ?? steps[steps.length - 1];
    if (isEventEditorOpen) {
      setEventTimelineGridStepMs(nextStep ?? DEFAULT_EVENT_TIMELINE_GRID_STEP_MS);
    } else {
      setItemTimelineGridStepMs(nextStep ?? DEFAULT_ITEM_TIMELINE_GRID_STEP_MS);
    }
  }, [isEventEditorOpen, timelineDurationMs]);
  const handleSelectPreviousEvent = useCallback(() => {
    if (!selectedEvent) {
      return;
    }
    const index = clipViews.findIndex((entry) => entry.firstSeq === selectedEvent.firstSeq);
    const previous = clipViews[Math.max(0, index - 1)];
    if (previous) {
      setSelectedSeq(previous.firstSeq);
    }
  }, [clipViews, selectedEvent]);
  const handleSelectNextEvent = useCallback(() => {
    if (!selectedEvent) {
      return;
    }
    const index = clipViews.findIndex((entry) => entry.firstSeq === selectedEvent.firstSeq);
    const next = clipViews[Math.min(clipViews.length - 1, index + 1)];
    if (next) {
      setSelectedSeq(next.firstSeq);
    }
  }, [clipViews, selectedEvent]);
  const handleNudgeSelectedEvent = useCallback(
    (deltaMs: number) => {
      if (!selectedEvent) {
        return;
      }
      setEventOffsetMs(
        selectedEvent.firstSeq,
        Math.max(0, Math.round(selectedEvent.effectiveOffsetMs + deltaMs)),
      );
    },
    [selectedEvent, setEventOffsetMs],
  );
  const handleSetSelectedHidden = useCallback(
    (hidden: boolean) => {
      updateSelectedEventEdits(selectedSeqs, (_entry, current) => ({ ...current, hidden }));
    },
    [selectedSeqs, updateSelectedEventEdits],
  );
  const handleHideSelectedEvents = useCallback(() => {
    handleSetSelectedHidden(true);
  }, [handleSetSelectedHidden]);
  const handleShowSelectedEvents = useCallback(() => {
    handleSetSelectedHidden(false);
  }, [handleSetSelectedHidden]);
  const handleResetSelectedEvents = useCallback(() => {
    updateSelectedEventEdits(selectedSeqs, () => null);
  }, [selectedSeqs, updateSelectedEventEdits]);
  const handleCompactSelectedEvents = useCallback(() => {
    if (!selectedRecording) {
      return;
    }
    const selectedSeqSet = new Set(selectedSeqs);
    if (selectedSeqSet.size === 0) {
      return;
    }
    const selectedRawEventSeqSet = new Set<number>();
    for (const clip of clipViews) {
      if (!selectedSeqSet.has(clip.firstSeq)) {
        continue;
      }
      for (const eventView of clip.events) {
        selectedRawEventSeqSet.add(eventView.event.seq);
      }
    }
    const orderedClips = [...clipViews].sort(
      (left, right) =>
        left.scheduledOffsetMs - right.scheduledOffsetMs || left.firstSeq - right.firstSeq,
    );
    const pixelsPerMs = Math.max(1, timelineZoom) / 1000;
    const getVisualDurationMs = (clip: ReplayClipView) => {
      const clipLabel = getTimelineClipLabel(clip, eventLabels);
      const previewWidth = Math.max(
        TIMELINE_CLIP_DEFAULT_WIDTH,
        Math.min(240, clipLabel.length * 9 + 36),
      );
      return Math.max(TIMELINE_CLIP_MIN_WIDTH, previewWidth) / pixelsPerMs;
    };
    const parsedRatioPercent = Number(removeGapRatioPercent);
    const ratioStep = Number.isFinite(parsedRatioPercent)
      ? Math.min(100, Math.max(0, parsedRatioPercent)) / 100
      : 0;
    const parsedSeconds = Number(removeGapSeconds);
    const timeStepMs = Number.isFinite(parsedSeconds) ? Math.max(0, parsedSeconds * 1000) : 0;
    const nextClipOffsets = new Map<number, number>();
    let previousEndMs = 0;
    for (const clip of orderedClips) {
      const gapMs = Math.max(0, clip.scheduledOffsetMs - previousEndMs);
      const removedGapMs = removeGapMode === "ratio" ? gapMs * ratioStep : timeStepMs;
      const reducedGapMs =
        gapMs <= TIMELINE_RIPPLE_MIN_GAP_MS
          ? gapMs
          : Math.max(TIMELINE_RIPPLE_MIN_GAP_MS, gapMs - removedGapMs);
      const nextOffsetMs = selectedSeqSet.has(clip.firstSeq)
        ? previousEndMs + reducedGapMs
        : clip.scheduledOffsetMs;
      nextClipOffsets.set(clip.firstSeq, Math.max(0, Math.round(nextOffsetMs)));
      previousEndMs =
        nextOffsetMs + Math.max(getVisualDurationMs(clip), TIMELINE_RIPPLE_MIN_GAP_MS);
    }
    const nextEventOffsets = new Map<number, number>();
    for (const clip of orderedClips) {
      if (!selectedSeqSet.has(clip.firstSeq)) {
        continue;
      }
      const nextClipOffsetMs = nextClipOffsets.get(clip.firstSeq) ?? clip.effectiveOffsetMs;
      for (const eventView of clip.events) {
        nextEventOffsets.set(
          eventView.event.seq,
          Math.max(
            0,
            Math.round(nextClipOffsetMs + eventView.scheduledOffsetMs - clip.scheduledOffsetMs),
          ),
        );
      }
    }
    const nextEdits = { ...selectedRecording.edits };
    for (const [seq, offsetMs] of nextEventOffsets) {
      const key = String(seq);
      nextEdits[key] = {
        ...nextEdits[key],
        offsetMs,
      };
    }
    const nextClips = listReplayClips(selectedRecording.events, nextEdits);
    const nextSelectedSeqs = nextClips
      .filter((clip) =>
        clip.events.some((eventView) => selectedRawEventSeqSet.has(eventView.event.seq)),
      )
      .map((clip) => clip.firstSeq);
    setSelectedSeqs(nextSelectedSeqs);
    setSelectedSeq((current) =>
      current !== null && nextSelectedSeqs.includes(current)
        ? current
        : (nextSelectedSeqs[0] ?? null),
    );
    void updateEdits(nextEdits).catch((editError) => {
      setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
    });
  }, [
    clipViews,
    eventLabels,
    removeGapMode,
    removeGapRatioPercent,
    removeGapSeconds,
    selectedRecording,
    selectedSeqs,
    t,
    timelineZoom,
    updateEdits,
  ]);
  const handleRippleDeleteSelectedEvents = useCallback(() => {
    if (!selectedRecording || (selectedEventViews.length === 0 && !selectedRangeMs)) {
      return;
    }
    const selectedSeqSet = new Set(selectedSeqs);
    const selectedOffsets = selectedEventViews.map((entry) => entry.scheduledOffsetMs);
    const selectedStartMs = selectedRangeMs?.startMs ?? Math.min(...selectedOffsets);
    const selectedEndMs = selectedRangeMs?.endMs ?? Math.max(...selectedOffsets);
    const removedDurationMs = Math.max(
      TIMELINE_RIPPLE_MIN_GAP_MS,
      selectedRangeMs
        ? selectedEndMs - selectedStartMs
        : selectedEndMs - selectedStartMs + TIMELINE_RIPPLE_MIN_GAP_MS,
    );
    const next = { ...selectedRecording.edits };
    for (const clip of clipViews) {
      const clipEndMs = Math.max(clip.scheduledOffsetMs, clip.scheduledOffsetMs + clip.durationMs);
      const overlapsDeletedRange =
        clipEndMs >= selectedStartMs && clip.scheduledOffsetMs <= selectedEndMs;
      if (selectedSeqSet.has(clip.firstSeq) || (selectedRangeMs && overlapsDeletedRange)) {
        for (const eventView of clip.events) {
          const key = String(eventView.event.seq);
          next[key] = { ...next[key], hidden: true };
        }
        continue;
      }
      if (clip.scheduledOffsetMs > selectedEndMs) {
        for (const eventView of clip.events) {
          const key = String(eventView.event.seq);
          next[key] = {
            ...next[key],
            offsetMs: Math.max(0, Math.round(eventView.scheduledOffsetMs - removedDurationMs)),
          };
        }
      }
    }
    void updateEdits(next).catch((editError) => {
      setError(editError instanceof Error ? editError.message : t("replay.error.updateEvent"));
    });
  }, [
    clipViews,
    selectedEventViews,
    selectedRangeMs,
    selectedRecording,
    selectedSeqs,
    t,
    updateEdits,
  ]);
  useEffect(() => {
    if (!visible || !isWeb || typeof window === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      if (
        handleReplayHistoryShortcut(event, {
          onRedo: handleRedoEdit,
          onSelectAll: handleSelectAllEvents,
          onUndo: handleUndoEdit,
        })
      ) {
        return;
      }
      if (handleReplayNudgeShortcut(event, handleNudgeSelectedEvent)) {
        return;
      }
      handleReplayDeleteShortcut(event, {
        hasSelection: selectedSeqs.length > 0,
        onHidePrimary: setEventHidden,
        onHideSelected: handleHideSelectedEvents,
        onRippleDeleteSelected: handleRippleDeleteSelectedEvents,
        primarySeq: selectedEvent?.firstSeq ?? null,
      });
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    handleHideSelectedEvents,
    handleNudgeSelectedEvent,
    handleRedoEdit,
    handleRippleDeleteSelectedEvents,
    handleSelectAllEvents,
    handleUndoEdit,
    selectedEvent,
    selectedSeqs.length,
    setEventHidden,
    visible,
  ]);

  const timelineContent =
    clipViews.length > 0 ? (
      <ReplayTimeline
        eventViews={activeTimelineViews}
        primarySelectedSeq={activePrimarySelectedSeq}
        selectedSeqs={activeSelectedSeqs}
        timelineStartMs={timelineStartMs}
        width={timelineWidth}
        ticks={timelineTicks}
        pixelsPerSecond={timelineZoom}
        onSelectEvent={handleSelectTimelineEntry}
        onMoveEvent={handleMoveTimelineEntry}
        onSelectRange={isEventEditorOpen ? undefined : handleSelectTimelineRange}
        laneLabels={laneLabels}
        eventLabels={eventLabels}
      />
    ) : (
      <EmptyEvents label={t("replay.empty.events")} />
    );

  const selectedEventInspector = selectedEvent ? (
    <SelectedEventInspector
      entry={selectedEvent}
      onSetHidden={setEventHidden}
      onReset={resetEventEdit}
      onSelectPrevious={handleSelectPreviousEvent}
      onSelectNext={handleSelectNextEvent}
      eventEditorOpen={isEventEditorOpen}
      onToggleEventEditor={handleToggleEventEditor}
      labels={inspectorLabels}
      eventLabels={eventLabels}
    />
  ) : null;

  const eventEditorInspector =
    selectedEvent && isEventEditorOpen ? (
      <ClipEventInspector
        clip={selectedEvent}
        selectedRawSeq={selectedRawSeq}
        onSelectEvent={setSelectedRawSeq}
        onSetOffset={setRawEventOffset}
        onSetHidden={setRawEventHidden}
        onReset={resetRawEventEdit}
        labels={inspectorLabels}
        eventLabels={eventLabels}
      />
    ) : null;

  const selectedHasVisible = selectedSeqs.some(
    (seq) => activeTimelineViews.find((entry) => entry.firstSeq === seq)?.hidden === false,
  );
  const handleToggleRemoveGapSettings = useCallback(() => {
    setIsRemoveGapSettingsOpen((current) => !current);
  }, []);
  const bulkEditToolbar = !isEventEditorOpen ? (
    <BulkEditToolbar
      selectedCount={selectedSeqs.length}
      totalCount={activeTimelineViews.length}
      selectedHasVisible={selectedHasVisible}
      removeGapMode={removeGapMode}
      removeGapRatioPercent={removeGapRatioPercent}
      removeGapSeconds={removeGapSeconds}
      isRemoveGapSettingsOpen={isRemoveGapSettingsOpen}
      labels={inspectorLabels}
      onToggleRemoveGapSettings={handleToggleRemoveGapSettings}
      onSetRemoveGapMode={setRemoveGapMode}
      onSetRemoveGapRatioPercent={setRemoveGapRatioPercent}
      onSetRemoveGapSeconds={setRemoveGapSeconds}
      onSelectAll={handleSelectAllEvents}
      onClearSelection={handleClearSelection}
      onToggleSelectedVisibility={
        selectedHasVisible ? handleHideSelectedEvents : handleShowSelectedEvents
      }
      onResetSelected={handleResetSelectedEvents}
      onCompactSelected={handleCompactSelectedEvents}
      onRippleDeleteSelected={handleRippleDeleteSelectedEvents}
      hasRangeSelection={selectedRangeMs !== null}
    />
  ) : null;

  const clipList = (
    <EventStrip
      eventViews={activeTimelineViews}
      primarySelectedSeq={activePrimarySelectedSeq}
      selectedSeqs={activeSelectedSeqs}
      onSelectEvent={handleSelectTimelineEntry}
      onToggleSelection={handleToggleTimelineSelection}
      eventLabels={eventLabels}
    />
  );
  const clipListTitle = isEventEditorOpen ? eventLabels.itemEvents : t("replay.clips.title");
  const clipPanel = (
    <View style={styles.eventStrip}>
      <View style={styles.eventStripHeader}>
        <Text style={styles.sectionTitle}>{clipListTitle}</Text>
        {bulkEditToolbar}
      </View>
      {clipList}
    </View>
  );
  const workspaceContent =
    clipViews.length > 0 ? (
      <View style={styles.workspaceGrid}>
        <View style={styles.inspectorColumn}>
          {selectedEventInspector}
          {eventEditorInspector}
        </View>
        <View style={styles.clipsColumn}>{clipPanel}</View>
      </View>
    ) : null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <ThemedRadio size={18} uniProps={recordingColorMapping} />
              <Text style={styles.title}>{t("replay.timeline.title")}</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.iconButton}
              accessibilityLabel={t("replay.action.close")}
            >
              <ThemedX size={18} uniProps={foregroundColorMapping} />
            </Pressable>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.body}>
            <View style={styles.sidebar}>
              <Text style={styles.sectionTitle}>{t("replay.recordings.title")}</Text>
              <ScrollView style={styles.recordingList}>
                {recordings.map((recording) => (
                  <RecordingRow
                    key={recording.recordingId}
                    recording={recording}
                    selected={selectedRecording?.recordingId === recording.recordingId}
                    onSelect={selectRecording}
                    onReplay={handleStartRecordingReplay}
                    fallbackTitle={t("replay.recording.untitled")}
                    replayLabel={t("replay.action.replay")}
                  />
                ))}
              </ScrollView>
            </View>

            <View style={styles.eventsPane}>
              <View style={styles.timelineSection}>
                <TimelineEditorHeader
                  title={t("replay.editor.title")}
                  onDecreaseGridStep={handleDecreaseGridStep}
                  onIncreaseGridStep={handleIncreaseGridStep}
                  onFitTimeline={handleFitTimeline}
                  onUndo={handleUndoEdit}
                  onRedo={handleRedoEdit}
                  onResetAll={handleResetAllEdits}
                  canUndo={undoStack.length > 0}
                  canRedo={redoStack.length > 0}
                  canResetAll={
                    selectedRecording ? Object.keys(selectedRecording.edits).length > 0 : false
                  }
                  gridStepLabel={t("replay.editor.gridStep", {
                    value: formatGridStep(activeTimelineGridStepMs),
                  })}
                  fitLabel={inspectorLabels.fitTimeline}
                  undoLabel={inspectorLabels.undo}
                  redoLabel={inspectorLabels.redo}
                  resetAllLabel={inspectorLabels.resetAll}
                  shortcutHint={inspectorLabels.shortcutHint}
                />
                {timelineContent}
              </View>
              {workspaceContent}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TimelineEditorHeader({
  title,
  gridStepLabel,
  fitLabel,
  undoLabel,
  redoLabel,
  resetAllLabel,
  shortcutHint,
  onDecreaseGridStep,
  onIncreaseGridStep,
  onFitTimeline,
  onUndo,
  onRedo,
  onResetAll,
  canUndo,
  canRedo,
  canResetAll,
}: {
  title: string;
  gridStepLabel: string;
  fitLabel: string;
  undoLabel: string;
  redoLabel: string;
  resetAllLabel: string;
  shortcutHint: string;
  onDecreaseGridStep: () => void;
  onIncreaseGridStep: () => void;
  onFitTimeline: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canResetAll: boolean;
}) {
  return (
    <View style={styles.editorHeader}>
      <View style={styles.editorHeaderTitleGroup}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.shortcutHint}>{shortcutHint}</Text>
      </View>
      <View style={styles.zoomControls}>
        <Button variant="ghost" size="xs" leftIcon={Undo2} onPress={onUndo} disabled={!canUndo}>
          {undoLabel}
        </Button>
        <Button variant="ghost" size="xs" leftIcon={Redo2} onPress={onRedo} disabled={!canRedo}>
          {redoLabel}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={RotateCcw}
          onPress={onResetAll}
          disabled={!canResetAll}
        >
          {resetAllLabel}
        </Button>
        <Button variant="ghost" size="xs" leftIcon={Minus} onPress={onDecreaseGridStep} />
        <Text style={styles.zoomLabel}>{gridStepLabel}</Text>
        <Button variant="ghost" size="xs" leftIcon={Plus} onPress={onIncreaseGridStep} />
        <Button variant="ghost" size="xs" leftIcon={Maximize2} onPress={onFitTimeline}>
          {fitLabel}
        </Button>
      </View>
    </View>
  );
}

function RecordingRow({
  recording,
  selected,
  onSelect,
  onReplay,
  fallbackTitle,
  replayLabel,
}: {
  recording: ConversationRecordingSummary;
  selected: boolean;
  onSelect: (recordingId: string) => void;
  onReplay: (recordingId: string) => void;
  fallbackTitle: string;
  replayLabel: string;
}) {
  const handlePress = useCallback(() => {
    void onSelect(recording.recordingId);
  }, [onSelect, recording.recordingId]);
  const handleReplay = useCallback(() => {
    onReplay(recording.recordingId);
  }, [onReplay, recording.recordingId]);
  const rowStyle = selected ? styles.recordingRowSelected : styles.recordingRow;
  return (
    <Pressable style={rowStyle} onPress={handlePress}>
      <View style={styles.recordingRowContent}>
        <View style={styles.recordingTextGroup}>
          <Text style={styles.recordingTitle} numberOfLines={1}>
            {recording.title ?? fallbackTitle}
          </Text>
          <Text style={styles.recordingMeta} numberOfLines={1}>
            {recording.status} · {formatRecordingTime(recording.startedAt)}
          </Text>
        </View>
        <Button
          variant="secondary"
          size="xs"
          leftIcon={Play}
          onPress={handleReplay}
          style={styles.recordingReplayButton}
          textStyle={styles.recordingReplayText}
        >
          {replayLabel}
        </Button>
      </View>
    </Pressable>
  );
}

function formatRecordingTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ReplayTimeline({
  eventViews,
  primarySelectedSeq,
  selectedSeqs,
  width,
  ticks,
  timelineStartMs,
  pixelsPerSecond,
  onSelectEvent,
  onMoveEvent,
  onSelectRange,
  laneLabels,
  eventLabels,
}: {
  eventViews: ReplayClipView[];
  primarySelectedSeq: number | null;
  selectedSeqs: number[];
  timelineStartMs: number;
  width: number;
  ticks: TimelineTick[];
  pixelsPerSecond: number;
  onSelectEvent: (seq: number) => void;
  onMoveEvent: (seq: number, offsetMs: number) => void;
  onSelectRange?: (startMs: number, endMs: number) => void;
  laneLabels: { user: string; assistant: string; system: string };
  eventLabels: ReplayEventLabels;
}) {
  const [scrollX, setScrollX] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(TIMELINE_MIN_WIDTH);
  const [rangeSelection, setRangeSelection] = useState<{
    startX: number;
    endX: number;
  } | null>(null);
  const [rangeSelectionOrigin, setRangeSelectionOrigin] = useState<{
    canvasLeft: number;
    fixedX: number;
    mode: "start" | "end";
  } | null>(null);
  const pixelsPerMs = pixelsPerSecond / 1000;
  const selectedEntry = useMemo(
    () => eventViews.find((entry) => entry.firstSeq === primarySelectedSeq) ?? null,
    [eventViews, primarySelectedSeq],
  );
  const playheadLeft = selectedEntry
    ? Math.max(0, selectedEntry.scheduledOffsetMs - timelineStartMs) * pixelsPerMs
    : null;
  const canvasStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.timelineCanvas, { width }],
    [width],
  );
  const nextOffsetBySeq = useMemo(() => {
    const nextOffsets = new Map<number, number | undefined>();
    for (const [index, entry] of eventViews.entries()) {
      nextOffsets.set(entry.firstSeq, eventViews[index + 1]?.scheduledOffsetMs);
    }
    return nextOffsets;
  }, [eventViews]);
  const visibleEventViews = useMemo(() => {
    if (eventViews.length <= 120) {
      return eventViews;
    }
    const startMs =
      timelineStartMs + Math.max(0, scrollX - TIMELINE_RENDER_BUFFER_PX) / pixelsPerMs;
    const endMs =
      timelineStartMs + (scrollX + viewportWidth + TIMELINE_RENDER_BUFFER_PX) / pixelsPerMs;
    return eventViews.filter(
      (entry) =>
        entry.firstSeq === primarySelectedSeq ||
        (entry.scheduledOffsetMs >= startMs && entry.scheduledOffsetMs <= endMs),
    );
  }, [eventViews, pixelsPerMs, primarySelectedSeq, scrollX, timelineStartMs, viewportWidth]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(Math.max(1, event.nativeEvent.layout.width));
  }, []);
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollX(event.nativeEvent.contentOffset.x);
  }, []);
  const selectionOverlayStyle = useMemo<StyleProp<ViewStyle> | null>(() => {
    if (!rangeSelection) {
      return null;
    }
    const left = Math.min(rangeSelection.startX, rangeSelection.endX);
    const selectionWidth = Math.abs(rangeSelection.endX - rangeSelection.startX);
    return [styles.timelineRangeSelection, { left, width: selectionWidth }];
  }, [rangeSelection]);
  const rangeStartHandleStyle = useMemo<StyleProp<ViewStyle> | null>(() => {
    if (!rangeSelection) {
      return null;
    }
    return [
      styles.timelineRangeHandle,
      TIMELINE_RANGE_HANDLE_WEB_STYLE,
      { left: Math.min(rangeSelection.startX, rangeSelection.endX) },
    ];
  }, [rangeSelection]);
  const rangeEndHandleStyle = useMemo<StyleProp<ViewStyle> | null>(() => {
    if (!rangeSelection) {
      return null;
    }
    return [
      styles.timelineRangeHandle,
      TIMELINE_RANGE_HANDLE_WEB_STYLE,
      { left: Math.max(rangeSelection.startX, rangeSelection.endX) },
    ];
  }, [rangeSelection]);
  const selectRangeFromPixels = useCallback(
    (startX: number, endX: number) => {
      if (!onSelectRange || pixelsPerMs <= 0) {
        return;
      }
      const startMs = timelineStartMs + startX / pixelsPerMs;
      const endMs = timelineStartMs + endX / pixelsPerMs;
      onSelectRange(startMs, endMs);
    },
    [onSelectRange, pixelsPerMs, timelineStartMs],
  );
  const startRangeSelection = useCallback(
    (event: PointerLikeEvent) => {
      if (!isWeb || !onSelectRange) {
        return;
      }
      const clientX = event.clientX ?? event.nativeEvent?.clientX;
      const canvasLeft = event.currentTarget?.getBoundingClientRect?.().left;
      if (clientX === undefined || canvasLeft === undefined) {
        return;
      }
      event.preventDefault?.();
      const startX = Math.max(0, clientX - canvasLeft);
      setRangeSelection({ startX, endX: startX });
      setRangeSelectionOrigin({ canvasLeft, fixedX: startX, mode: "end" });
    },
    [onSelectRange],
  );
  const startRangeHandleDrag = useCallback(
    (mode: "start" | "end", event: PointerLikeEvent) => {
      if (!isWeb || !rangeSelection) {
        return;
      }
      const clientX = event.clientX ?? event.nativeEvent?.clientX;
      const handleLeft = event.currentTarget?.getBoundingClientRect?.().left;
      if (clientX === undefined || handleLeft === undefined) {
        return;
      }
      event.preventDefault?.();
      event.stopPropagation?.();
      event.nativeEvent?.preventDefault?.();
      event.nativeEvent?.stopPropagation?.();
      const left = Math.min(rangeSelection.startX, rangeSelection.endX);
      const right = Math.max(rangeSelection.startX, rangeSelection.endX);
      const handleX = mode === "start" ? left : right;
      setRangeSelectionOrigin({
        canvasLeft: handleLeft - handleX,
        fixedX: mode === "start" ? right : left,
        mode,
      });
    },
    [rangeSelection],
  );
  const startRangeStartHandleDrag = useCallback(
    (event: PointerLikeEvent) => startRangeHandleDrag("start", event),
    [startRangeHandleDrag],
  );
  const startRangeEndHandleDrag = useCallback(
    (event: PointerLikeEvent) => startRangeHandleDrag("end", event),
    [startRangeHandleDrag],
  );
  useEffect(() => {
    if (
      !isWeb ||
      !onSelectRange ||
      !rangeSelectionOrigin ||
      typeof window === "undefined" ||
      pixelsPerMs <= 0
    ) {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const movingX = Math.max(0, event.clientX - rangeSelectionOrigin.canvasLeft);
      setRangeSelection({
        startX: rangeSelectionOrigin.mode === "start" ? movingX : rangeSelectionOrigin.fixedX,
        endX: rangeSelectionOrigin.mode === "end" ? movingX : rangeSelectionOrigin.fixedX,
      });
    };
    const stopSelecting = (event: PointerEvent) => {
      event.preventDefault();
      const movingX = Math.max(0, event.clientX - rangeSelectionOrigin.canvasLeft);
      const nextRange = {
        startX: rangeSelectionOrigin.mode === "start" ? movingX : rangeSelectionOrigin.fixedX,
        endX: rangeSelectionOrigin.mode === "end" ? movingX : rangeSelectionOrigin.fixedX,
      };
      const distancePx = Math.abs(nextRange.endX - nextRange.startX);
      setRangeSelectionOrigin(null);
      if (distancePx <= 4) {
        setRangeSelection(null);
        return;
      }
      setRangeSelection(nextRange);
      selectRangeFromPixels(nextRange.startX, nextRange.endX);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopSelecting);
    window.addEventListener("pointercancel", stopSelecting);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopSelecting);
      window.removeEventListener("pointercancel", stopSelecting);
    };
  }, [onSelectRange, pixelsPerMs, rangeSelectionOrigin, selectRangeFromPixels]);
  return (
    <View style={styles.timelineFrame} onLayout={handleLayout}>
      <ScrollView
        horizontal
        disableScrollViewPanResponder
        onScroll={handleScroll}
        scrollEventThrottle={32}
        style={styles.timelineScroll}
      >
        <View
          style={canvasStyle}
          {...(isWeb && onSelectRange ? ({ onPointerDown: startRangeSelection } as object) : null)}
        >
          {ticks.map((tick) => (
            <TimelineTickMark key={tick.ms} tick={tick} />
          ))}
          <TimelineLane top={TIMELINE_LANE_TOP.user} label={laneLabels.user} />
          <TimelineLane top={TIMELINE_LANE_TOP.assistant} label={laneLabels.assistant} />
          <TimelineLane top={TIMELINE_LANE_TOP.other} label={laneLabels.system} />
          {selectionOverlayStyle ? (
            <View pointerEvents="none" style={selectionOverlayStyle} />
          ) : null}
          {rangeStartHandleStyle ? (
            <View
              style={rangeStartHandleStyle}
              {...(isWeb ? ({ onPointerDown: startRangeStartHandleDrag } as object) : null)}
            >
              <Text pointerEvents="none" style={styles.timelineRangeHandleLabel}>
                {eventLabels.rangeStart}
              </Text>
            </View>
          ) : null}
          {rangeEndHandleStyle ? (
            <View
              style={rangeEndHandleStyle}
              {...(isWeb ? ({ onPointerDown: startRangeEndHandleDrag } as object) : null)}
            >
              <Text pointerEvents="none" style={styles.timelineRangeHandleLabel}>
                {eventLabels.rangeEnd}
              </Text>
            </View>
          ) : null}
          {visibleEventViews.map((entry) => (
            <TimelineClip
              key={entry.id}
              entry={entry}
              selected={
                entry.firstSeq === primarySelectedSeq || selectedSeqs.includes(entry.firstSeq)
              }
              nextOffsetMs={nextOffsetBySeq.get(entry.firstSeq)}
              timelineStartMs={timelineStartMs}
              pixelsPerMs={pixelsPerMs}
              onSelectEvent={onSelectEvent}
              onMoveEvent={onMoveEvent}
              labels={eventLabels}
            />
          ))}
          {playheadLeft !== null && selectedEntry ? (
            <TimelinePlayhead
              left={playheadLeft}
              label={formatTime(selectedEntry.scheduledOffsetMs)}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

interface TimelineTick {
  ms: number;
  left: number;
  label: string;
}

function TimelineTickMark({ tick }: { tick: TimelineTick }) {
  const tickStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.timelineTick, { left: tick.left }],
    [tick.left],
  );
  const labelStyle = useMemo<StyleProp<TextStyle>>(
    () => [styles.timelineTickLabel, { left: tick.left + 4 }],
    [tick.left],
  );
  return (
    <>
      <View pointerEvents="none" style={tickStyle} />
      <Text pointerEvents="none" style={labelStyle}>
        {tick.label}
      </Text>
    </>
  );
}

function TimelineLane({ top, label }: { top: number; label: string }) {
  const laneStyle = useMemo<StyleProp<ViewStyle>>(() => [styles.timelineLane, { top }], [top]);
  const labelStyle = useMemo<StyleProp<TextStyle>>(
    () => [styles.timelineLaneLabel, { top: top - 16 }],
    [top],
  );
  return (
    <>
      <Text pointerEvents="none" style={labelStyle}>
        {label}
      </Text>
      <View pointerEvents="none" style={laneStyle} />
    </>
  );
}

function TimelinePlayhead({ left, label }: { left: number; label: string }) {
  const playheadStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.timelinePlayhead, { left }],
    [left],
  );
  const labelStyle = useMemo<StyleProp<TextStyle>>(
    () => [styles.timelinePlayheadLabel, { left: Math.max(4, left - 18) }],
    [left],
  );
  return (
    <>
      <View pointerEvents="none" style={playheadStyle} />
      <Text pointerEvents="none" style={labelStyle}>
        {label}
      </Text>
    </>
  );
}

function TimelineClip({
  entry,
  selected,
  nextOffsetMs,
  timelineStartMs,
  pixelsPerMs,
  onSelectEvent,
  onMoveEvent,
  labels,
}: {
  entry: ReplayClipView;
  selected: boolean;
  nextOffsetMs: number | undefined;
  timelineStartMs: number;
  pixelsPerMs: number;
  onSelectEvent: (seq: number) => void;
  onMoveEvent: (seq: number, offsetMs: number) => void;
  labels: ReplayEventLabels;
}) {
  const [dragDeltaX, setDragDeltaX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [webDragStartClientX, setWebDragStartClientX] = useState<number | null>(null);
  const left = Math.max(0, entry.scheduledOffsetMs - timelineStartMs) * pixelsPerMs;
  const previewLeft = Math.max(0, left + dragDeltaX);
  const nextLeft =
    nextOffsetMs !== undefined
      ? Math.max(left + TIMELINE_CLIP_DEFAULT_WIDTH, (nextOffsetMs - timelineStartMs) * pixelsPerMs)
      : left + 240;
  const clipLabel = getTimelineClipLabel(entry, labels);
  const previewWidth = Math.max(
    TIMELINE_CLIP_DEFAULT_WIDTH,
    Math.min(240, clipLabel.length * 9 + 36),
  );
  const width = Math.max(TIMELINE_CLIP_MIN_WIDTH, Math.min(previewWidth, nextLeft - left || 0));
  const top = getTimelineLaneTop(entry);
  const clipBaseStyle = getTimelineClipStyle(entry, selected);
  const clipStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      clipBaseStyle,
      selected ? styles.timelineClipSelectedLayer : null,
      dragging ? styles.timelineClipDragging : null,
      TIMELINE_CLIP_WEB_DRAG_STYLE,
      { left: previewLeft, top, width },
    ],
    [clipBaseStyle, dragging, previewLeft, selected, top, width],
  );
  const finishDrag = useCallback(
    (dx: number) => {
      if (Math.abs(dx) <= 2) {
        setDragging(false);
        setDragDeltaX(0);
        return;
      }
      const deltaMs = pixelsPerMs > 0 ? dx / pixelsPerMs : 0;
      onMoveEvent(entry.firstSeq, Math.max(0, Math.round(entry.effectiveOffsetMs + deltaMs)));
      setDragging(false);
      setDragDeltaX(0);
    },
    [entry.effectiveOffsetMs, entry.firstSeq, onMoveEvent, pixelsPerMs],
  );
  const startWebDrag = useCallback(
    (event: PointerLikeEvent) => {
      if (!isWeb) {
        return;
      }
      const clientX = event.clientX ?? event.nativeEvent?.clientX;
      if (clientX === undefined) {
        return;
      }
      event.preventDefault?.();
      event.stopPropagation?.();
      event.nativeEvent?.preventDefault?.();
      event.nativeEvent?.stopPropagation?.();
      setWebDragStartClientX(clientX);
      setDragging(true);
      onSelectEvent(entry.firstSeq);
    },
    [entry.firstSeq, onSelectEvent],
  );
  useEffect(() => {
    if (!isWeb || webDragStartClientX === null || typeof window === "undefined") {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      setDragDeltaX(event.clientX - webDragStartClientX);
    };
    const stopDragging = (event: PointerEvent) => {
      event.preventDefault();
      finishDrag(event.clientX - webDragStartClientX);
      setWebDragStartClientX(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [finishDrag, webDragStartClientX]);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isWeb,
        onStartShouldSetPanResponderCapture: () => !isWeb,
        onMoveShouldSetPanResponder: () => !isWeb,
        onMoveShouldSetPanResponderCapture: () => !isWeb,
        onPanResponderGrant: () => {
          setDragging(true);
          onSelectEvent(entry.firstSeq);
        },
        onPanResponderMove: (_event, gesture) => {
          setDragDeltaX(gesture.dx);
        },
        onPanResponderRelease: (_event, gesture) => {
          finishDrag(gesture.dx);
        },
        onPanResponderTerminate: (_event, gesture) => {
          finishDrag(gesture.dx);
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [entry.firstSeq, finishDrag, onSelectEvent],
  );
  return (
    <View
      {...panResponder.panHandlers}
      style={clipStyle}
      accessibilityRole="button"
      accessibilityLabel={`${labels.selectEvent} ${entry.firstSeq}`}
      {...(isWeb ? ({ onPointerDown: startWebDrag } as object) : null)}
    >
      <Text pointerEvents="none" style={styles.timelineClipText} numberOfLines={1}>
        {clipLabel}
      </Text>
    </View>
  );
}

interface ReplayInspectorLabels {
  time: string;
  seconds: string;
  visible: string;
  hidden: string;
  reset: string;
  resetAll: string;
  resetSelected: string;
  previous: string;
  next: string;
  nudgeLeft: string;
  nudgeRight: string;
  snap: string;
  fitTimeline: string;
  undo: string;
  redo: string;
  selectAll: string;
  clearSelection: string;
  hideSelected: string;
  showSelected: string;
  compactSelected: string;
  rippleDeleteSelected: string;
  removeGapRatioMode: string;
  removeGapTimeMode: string;
  removeGapStep: string;
  editEvents: string;
  doneEditingEvents: string;
  selectedCount: string;
  shortcutHint: string;
}

function SelectedEventInspector({
  entry,
  onSetHidden,
  onReset,
  onSelectPrevious,
  onSelectNext,
  eventEditorOpen,
  onToggleEventEditor,
  labels,
  eventLabels,
}: {
  entry: ReplayClipView;
  onSetHidden: (seq: number, hidden: boolean) => void;
  onReset: (seq: number) => void;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  eventEditorOpen: boolean;
  onToggleEventEditor: () => void;
  labels: ReplayInspectorLabels;
  eventLabels: ReplayEventLabels;
}) {
  const handleToggleHidden = useCallback(() => {
    onSetHidden(entry.firstSeq, !entry.hidden);
  }, [entry.firstSeq, entry.hidden, onSetHidden]);
  const handleReset = useCallback(() => {
    onReset(entry.firstSeq);
  }, [entry.firstSeq, onReset]);
  return (
    <View style={styles.inspector}>
      <View style={styles.inspectorSummary}>
        <View style={styles.inspectorSummaryText}>
          <Text style={styles.inspectorTitle} numberOfLines={1}>
            #{entry.firstSeq} {getEventTitle(entry, eventLabels)}
          </Text>
          <Text style={styles.inspectorPreview} numberOfLines={1}>
            {getEventPreview(entry, eventLabels)}
          </Text>
        </View>
        <View style={styles.inspectorNavigation}>
          <Button variant="ghost" size="xs" leftIcon={SkipBack} onPress={onSelectPrevious}>
            {labels.previous}
          </Button>
          <Button variant="ghost" size="xs" leftIcon={SkipForward} onPress={onSelectNext}>
            {labels.next}
          </Button>
        </View>
      </View>
      <View style={styles.inspectorToolbar}>
        <View style={styles.inspectorGroup}>
          <Button variant="outline" size="xs" leftIcon={ListTree} onPress={onToggleEventEditor}>
            {eventEditorOpen ? labels.doneEditingEvents : labels.editEvents}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            leftIcon={entry.hidden ? EyeOff : Eye}
            onPress={handleToggleHidden}
          >
            {entry.hidden ? labels.hidden : labels.visible}
          </Button>
          <Button variant="ghost" size="xs" onPress={handleReset}>
            {labels.reset}
          </Button>
        </View>
      </View>
    </View>
  );
}

function ClipEventInspector({
  clip,
  selectedRawSeq,
  onSelectEvent,
  onSetOffset,
  onSetHidden,
  onReset,
  labels,
  eventLabels,
}: {
  clip: ReplayClipView;
  selectedRawSeq: number | null;
  onSelectEvent: (seq: number) => void;
  onSetOffset: (seq: number, value: string) => void;
  onSetHidden: (seq: number, hidden: boolean) => void;
  onReset: (seq: number) => void;
  labels: ReplayInspectorLabels;
  eventLabels: ReplayEventLabels;
}) {
  return (
    <View style={styles.clipEventEditor}>
      <View style={styles.clipEventHeader}>
        <View style={styles.editorHeaderTitleGroup}>
          <Text style={styles.sectionTitle}>{eventLabels.itemEvents}</Text>
          <Text style={styles.shortcutHint}>{eventLabels.itemEventsDescription}</Text>
        </View>
        <Text style={styles.clipEventCount}>{clip.events.length}</Text>
      </View>
      <ScrollView style={styles.rawEventList}>
        {clip.events.map((entry) => (
          <RawEventRow
            key={entry.event.seq}
            entry={entry}
            selected={entry.event.seq === selectedRawSeq}
            onSelectEvent={onSelectEvent}
            onSetOffset={onSetOffset}
            onSetHidden={onSetHidden}
            onReset={onReset}
            labels={labels}
            eventLabels={eventLabels}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function RawEventRow({
  entry,
  selected,
  onSelectEvent,
  onSetOffset,
  onSetHidden,
  onReset,
  labels,
  eventLabels,
}: {
  entry: ReplayEventView;
  selected: boolean;
  onSelectEvent: (seq: number) => void;
  onSetOffset: (seq: number, value: string) => void;
  onSetHidden: (seq: number, hidden: boolean) => void;
  onReset: (seq: number) => void;
  labels: ReplayInspectorLabels;
  eventLabels: ReplayEventLabels;
}) {
  const handleOffsetSubmit = useCallback(
    (event: { nativeEvent: { text: string } }) => {
      onSetOffset(entry.event.seq, event.nativeEvent.text);
    },
    [entry.event.seq, onSetOffset],
  );
  const handleToggleHidden = useCallback(() => {
    onSetHidden(entry.event.seq, !entry.hidden);
  }, [entry.event.seq, entry.hidden, onSetHidden]);
  const handleReset = useCallback(() => {
    onReset(entry.event.seq);
  }, [entry.event.seq, onReset]);
  const handlePress = useCallback(() => {
    onSelectEvent(entry.event.seq);
  }, [entry.event.seq, onSelectEvent]);
  const rowStyle = selected ? styles.rawEventRowSelected : styles.rawEventRow;
  return (
    <Pressable style={rowStyle} onPress={handlePress}>
      <View style={styles.rawEventHeader}>
        <Text style={styles.rawEventTime}>{formatTime(entry.scheduledOffsetMs)}</Text>
        <View style={styles.rawEventBody}>
          <Text style={styles.rawEventTitle} numberOfLines={1}>
            #{entry.event.seq} {getRawEventTitle(entry, eventLabels)}
          </Text>
          <Text style={styles.rawEventPreview} numberOfLines={1}>
            {getRawEventPreview(entry, eventLabels)}
          </Text>
        </View>
      </View>
      <View style={styles.rawEventControls}>
        <View style={styles.offsetGroup}>
          <TextInput
            key={`${entry.event.seq}:${entry.effectiveOffsetMs}`}
            style={styles.offsetInput}
            keyboardType="numeric"
            defaultValue={(entry.effectiveOffsetMs / 1000).toFixed(2)}
            onSubmitEditing={handleOffsetSubmit}
            onEndEditing={handleOffsetSubmit}
          />
          <Text style={styles.fieldSuffix}>{labels.seconds}</Text>
        </View>
        <View style={styles.rawEventActions}>
          <Button
            variant="secondary"
            size="xs"
            leftIcon={entry.hidden ? EyeOff : Eye}
            onPress={handleToggleHidden}
          >
            {entry.hidden ? labels.hidden : labels.visible}
          </Button>
          <Button variant="ghost" size="xs" onPress={handleReset}>
            {labels.reset}
          </Button>
        </View>
      </View>
    </Pressable>
  );
}

function BulkEditToolbar({
  selectedCount,
  totalCount,
  hasRangeSelection,
  selectedHasVisible,
  removeGapMode,
  removeGapRatioPercent,
  removeGapSeconds,
  isRemoveGapSettingsOpen,
  labels,
  onToggleRemoveGapSettings,
  onSetRemoveGapMode,
  onSetRemoveGapRatioPercent,
  onSetRemoveGapSeconds,
  onSelectAll,
  onClearSelection,
  onToggleSelectedVisibility,
  onResetSelected,
  onCompactSelected,
  onRippleDeleteSelected,
}: {
  selectedCount: number;
  totalCount: number;
  hasRangeSelection: boolean;
  selectedHasVisible: boolean;
  removeGapMode: RemoveGapMode;
  removeGapRatioPercent: string;
  removeGapSeconds: string;
  isRemoveGapSettingsOpen: boolean;
  labels: ReplayInspectorLabels;
  onToggleRemoveGapSettings: () => void;
  onSetRemoveGapMode: (mode: RemoveGapMode) => void;
  onSetRemoveGapRatioPercent: (value: string) => void;
  onSetRemoveGapSeconds: (value: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleSelectedVisibility: () => void;
  onResetSelected: () => void;
  onCompactSelected: () => void;
  onRippleDeleteSelected: () => void;
}) {
  const hasSelection = selectedCount > 0;
  const hasAllSelected = totalCount > 0 && selectedCount === totalCount;
  const canRippleDelete = hasSelection || hasRangeSelection;
  const selectionToggleLabel =
    hasSelection || hasAllSelected ? labels.clearSelection : labels.selectAll;
  const handleToggleSelection = hasSelection || hasAllSelected ? onClearSelection : onSelectAll;
  const handleUseRatioMode = useCallback(() => {
    onSetRemoveGapMode("ratio");
  }, [onSetRemoveGapMode]);
  const handleUseTimeMode = useCallback(() => {
    onSetRemoveGapMode("time");
  }, [onSetRemoveGapMode]);
  const removeGapInputValue = removeGapMode === "ratio" ? removeGapRatioPercent : removeGapSeconds;
  const removeGapButtonStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.bulkIconButton, isRemoveGapSettingsOpen ? styles.bulkIconButtonActive : null],
    [isRemoveGapSettingsOpen],
  );
  const handleSetRemoveGapInput = useCallback(
    (value: string) => {
      if (removeGapMode === "ratio") {
        onSetRemoveGapRatioPercent(value);
        return;
      }
      onSetRemoveGapSeconds(value);
    },
    [onSetRemoveGapRatioPercent, onSetRemoveGapSeconds, removeGapMode],
  );
  return (
    <View style={styles.bulkToolbar}>
      <View style={styles.bulkToolbarMain}>
        <View style={styles.bulkToolbarSelection}>
          <Text style={styles.bulkToolbarText}>{labels.selectedCount}</Text>
          <View style={styles.bulkToolbarSelectionActions}>
            <Button
              variant="ghost"
              size="xs"
              onPress={handleToggleSelection}
              disabled={totalCount === 0}
            >
              {selectionToggleLabel}
            </Button>
            <Button variant="ghost" size="xs" onPress={onResetSelected} disabled={!hasSelection}>
              {labels.resetSelected}
            </Button>
          </View>
        </View>
        <View style={styles.bulkToolbarActions}>
          <Button
            variant={isRemoveGapSettingsOpen ? "default" : "secondary"}
            size="xs"
            leftIcon={Clapperboard}
            onPress={onToggleRemoveGapSettings}
            disabled={!hasSelection}
            accessibilityLabel={labels.compactSelected}
            style={removeGapButtonStyle}
          />
          <Button
            variant="secondary"
            size="xs"
            leftIcon={Trash2}
            onPress={onRippleDeleteSelected}
            disabled={!canRippleDelete}
            accessibilityLabel={labels.rippleDeleteSelected}
            style={styles.bulkIconButton}
          />
          <Button
            variant="secondary"
            size="xs"
            leftIcon={selectedHasVisible ? EyeOff : Eye}
            onPress={onToggleSelectedVisibility}
            disabled={!hasSelection}
            accessibilityLabel={selectedHasVisible ? labels.hideSelected : labels.showSelected}
            style={styles.bulkIconButton}
          />
        </View>
      </View>
      {isRemoveGapSettingsOpen ? (
        <View style={styles.removeGapSettings}>
          <Text style={styles.removeGapSettingsLabel}>{labels.removeGapStep}</Text>
          <View style={styles.removeGapStepControl}>
            <TextInput
              accessibilityLabel={labels.removeGapStep}
              keyboardType="numeric"
              onChangeText={handleSetRemoveGapInput}
              style={styles.removeGapStepInput}
              value={removeGapInputValue}
            />
            <Button
              variant={removeGapMode === "ratio" ? "secondary" : "ghost"}
              size="xs"
              onPress={handleUseRatioMode}
              accessibilityLabel={labels.removeGapRatioMode}
              style={styles.removeGapModeButton}
            >
              %
            </Button>
            <Button
              variant={removeGapMode === "time" ? "secondary" : "ghost"}
              size="xs"
              onPress={handleUseTimeMode}
              accessibilityLabel={labels.removeGapTimeMode}
              style={styles.removeGapModeButton}
            >
              {labels.seconds}
            </Button>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={Clapperboard}
              onPress={onCompactSelected}
              disabled={!hasSelection}
            >
              {labels.compactSelected}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function EventStrip({
  eventViews,
  primarySelectedSeq,
  selectedSeqs,
  onSelectEvent,
  onToggleSelection,
  eventLabels,
}: {
  eventViews: ReplayClipView[];
  primarySelectedSeq: number | null;
  selectedSeqs: number[];
  onSelectEvent: (seq: number) => void;
  onToggleSelection: (seq: number) => void;
  eventLabels: ReplayEventLabels;
}) {
  const keyExtractor = useCallback((entry: ReplayClipView) => entry.id, []);
  const renderItem = useCallback(
    ({ item }: { item: ReplayClipView }) => (
      <EventStripRow
        entry={item}
        selected={item.firstSeq === primarySelectedSeq}
        checked={selectedSeqs.includes(item.firstSeq)}
        onSelectEvent={onSelectEvent}
        onToggleSelection={onToggleSelection}
        eventLabels={eventLabels}
      />
    ),
    [eventLabels, onSelectEvent, onToggleSelection, primarySelectedSeq, selectedSeqs],
  );
  return (
    <FlatList
      contentContainerStyle={styles.eventStripListContent}
      data={eventViews}
      extraData={`${primarySelectedSeq}:${selectedSeqs.join(",")}`}
      initialNumToRender={24}
      keyExtractor={keyExtractor}
      maxToRenderPerBatch={32}
      renderItem={renderItem}
      style={styles.eventStripList}
      windowSize={7}
    />
  );
}

function EventStripRow({
  entry,
  selected,
  checked,
  onSelectEvent,
  onToggleSelection,
  eventLabels,
}: {
  entry: ReplayClipView;
  selected: boolean;
  checked: boolean;
  onSelectEvent: (seq: number) => void;
  onToggleSelection: (seq: number) => void;
  eventLabels: ReplayEventLabels;
}) {
  const rowStyle = selected ? styles.eventStripRowSelected : styles.eventStripRow;
  const accessibilityState = useMemo(() => ({ checked }), [checked]);
  const handlePress = useCallback(() => {
    onSelectEvent(entry.firstSeq);
  }, [entry.firstSeq, onSelectEvent]);
  const handleToggleSelection = useCallback(() => {
    onToggleSelection(entry.firstSeq);
  }, [entry.firstSeq, onToggleSelection]);
  return (
    <Pressable style={rowStyle} onPress={handlePress}>
      <Pressable
        style={checked ? styles.eventStripCheckboxChecked : styles.eventStripCheckbox}
        onPress={handleToggleSelection}
        accessibilityRole="checkbox"
        accessibilityState={accessibilityState}
        accessibilityLabel={`${eventLabels.selectEvent} ${entry.firstSeq}`}
      >
        {checked ? <ThemedCheck size={12} uniProps={checkboxIconColorMapping} /> : null}
      </Pressable>
      <Text style={styles.eventStripTime}>{formatTime(entry.scheduledOffsetMs)}</Text>
      <View style={styles.eventStripBody}>
        <Text style={styles.eventStripTitle} numberOfLines={1}>
          #{entry.firstSeq} {getEventTitle(entry, eventLabels)}
        </Text>
        <Text style={styles.eventStripPreview} numberOfLines={1}>
          {getEventPreview(entry, eventLabels)}
        </Text>
      </View>
    </Pressable>
  );
}

function buildTimelineTicks(
  startMs: number,
  durationMs: number,
  gridStepMs: number,
): TimelineTick[] {
  const effectiveDurationMs = Math.max(gridStepMs, Math.ceil(durationMs / gridStepMs) * gridStepMs);
  const ticks: TimelineTick[] = [];
  for (let ms = 0; ms <= effectiveDurationMs; ms += gridStepMs) {
    ticks.push({
      ms,
      left: (ms / gridStepMs) * TIMELINE_GRID_WIDTH,
      label: formatTime(startMs + ms),
    });
  }
  return ticks;
}

function getTimelineRange(
  entries: ReplayClipView[],
  useLocalRange: boolean,
): { durationMs: number; startMs: number } {
  if (entries.length === 0) {
    return { startMs: 0, durationMs: 0 };
  }
  if (!useLocalRange) {
    return {
      startMs: 0,
      durationMs: entries.reduce(
        (duration, entry) => Math.max(duration, entry.scheduledOffsetMs),
        0,
      ),
    };
  }
  const offsets = entries.map((entry) => entry.scheduledOffsetMs);
  const startMs = Math.min(...offsets);
  const endMs = Math.max(...offsets);
  return {
    startMs,
    durationMs: Math.max(0, endMs - startMs),
  };
}

function getNextTimelineGridStep(
  current: number,
  steps: readonly number[],
  direction: "coarser" | "finer",
): number {
  const fallbackIndex = steps.findIndex((step) => step >= current);
  const index = Math.max(0, fallbackIndex === -1 ? steps.length - 1 : fallbackIndex);
  const nextIndex =
    direction === "coarser" ? Math.min(steps.length - 1, index + 1) : Math.max(0, index - 1);
  return steps[nextIndex] ?? current;
}

function getTimelineLaneTop(entry: ReplayClipView): number {
  if (entry.kind === "user") {
    return TIMELINE_LANE_TOP.user;
  }
  if (entry.kind === "assistant" || entry.kind === "reasoning") {
    return TIMELINE_LANE_TOP.assistant;
  }
  return TIMELINE_LANE_TOP.other;
}

function createRawEventTimelineEntry(
  entry: ReplayEventView,
  labels: ReplayEventLabels,
): ReplayClipView {
  const kind = getRawEventTimelineKind(entry);
  return {
    id: `raw:${entry.event.seq}`,
    kind,
    events: [entry],
    firstSeq: entry.event.seq,
    effectiveOffsetMs: entry.effectiveOffsetMs,
    scheduledOffsetMs: entry.scheduledOffsetMs,
    durationMs: 0,
    hidden: entry.hidden,
    title: getRawEventTitle(entry, labels),
    shortLabel: getRawEventShortLabel(entry, labels),
    preview: getRawEventPreview(entry, labels),
  };
}

function getRawEventTimelineKind(entry: ReplayEventView): ReplayClipView["kind"] {
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

function getTimelineClipStyle(entry: ReplayClipView, selected: boolean): StyleProp<ViewStyle> {
  if (entry.hidden) {
    return selected ? styles.timelineClipHiddenSelected : styles.timelineClipHidden;
  }
  if (entry.kind === "user") {
    return selected ? styles.timelineClipUserSelected : styles.timelineClipUser;
  }
  if (entry.kind === "assistant" || entry.kind === "reasoning") {
    return selected ? styles.timelineClipAssistantSelected : styles.timelineClipAssistant;
  }
  return selected ? styles.timelineClipOtherSelected : styles.timelineClipOther;
}

interface ReplayEventLabels {
  ai: string;
  emptyTextChunk: string;
  emptyUserInput: string;
  itemEvents: string;
  itemEventsDescription: string;
  rangeEnd: string;
  rangeStart: string;
  reasoning: string;
  rawEvent: string;
  selectEvent: string;
  todoItems: string;
  user: string;
  userInput: string;
}

function getEventTitle(entry: ReplayClipView, labels: ReplayEventLabels): string {
  if (entry.kind === "user") {
    return labels.userInput;
  }
  if (entry.kind === "assistant") {
    return labels.ai;
  }
  if (entry.kind === "reasoning") {
    return labels.reasoning;
  }
  return entry.title;
}

function getEventShortLabel(entry: ReplayClipView, labels: ReplayEventLabels): string {
  if (entry.kind === "user") {
    return labels.user;
  }
  if (entry.kind === "assistant") {
    return labels.ai;
  }
  if (entry.kind === "reasoning") {
    return labels.reasoning;
  }
  return entry.shortLabel;
}

function getTimelineClipLabel(entry: ReplayClipView, labels: ReplayEventLabels): string {
  const preview = getEventPreview(entry, labels).trim();
  if (
    preview &&
    preview !== labels.emptyTextChunk &&
    preview !== labels.emptyUserInput &&
    preview !== labels.rawEvent
  ) {
    return preview;
  }
  return getEventShortLabel(entry, labels);
}

function getEventPreview(entry: ReplayClipView, labels: ReplayEventLabels): string {
  if (entry.kind === "user") {
    return entry.preview || labels.emptyUserInput;
  }
  return entry.preview || labels.emptyTextChunk;
}

function getRawEventTitle(entry: ReplayEventView, labels: ReplayEventLabels): string {
  if (entry.event.kind === "user_input") {
    return labels.userInput;
  }
  if (entry.event.kind !== "agent_stream_raw") {
    return labels.rawEvent;
  }
  const streamEvent = entry.event.payload.event;
  if (streamEvent.type !== "timeline") {
    return streamEvent.type;
  }
  const item = streamEvent.item;
  if (item.type === "assistant_message") {
    return labels.ai;
  }
  if (item.type === "reasoning") {
    return labels.reasoning;
  }
  if (item.type === "todo") {
    return labels.todoItems.replace("{count}", String(item.items.length));
  }
  if (item.type === "tool_call") {
    return item.name;
  }
  return item.type;
}

function getRawEventShortLabel(entry: ReplayEventView, labels: ReplayEventLabels): string {
  const title = getRawEventTitle(entry, labels);
  return title.length > 10 ? title.slice(0, 10) : title;
}

function getRawEventPreview(entry: ReplayEventView, labels: ReplayEventLabels): string {
  if (entry.event.kind === "user_input") {
    return entry.event.payload.text || labels.emptyUserInput;
  }
  if (entry.event.kind !== "agent_stream_raw") {
    return labels.rawEvent;
  }
  const streamEvent = entry.event.payload.event;
  if (streamEvent.type !== "timeline") {
    return streamEvent.type;
  }
  const item = streamEvent.item;
  if (item.type === "assistant_message" || item.type === "reasoning") {
    return item.text || labels.emptyTextChunk;
  }
  if (item.type === "tool_call") {
    return item.detail?.type === "shell" ? item.detail.command : item.name;
  }
  if (item.type === "todo") {
    return labels.todoItems.replace("{count}", String(item.items.length));
  }
  if (item.type === "error") {
    return item.message;
  }
  return item.type;
}

function formatTime(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function formatGridStep(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  if (seconds < 1) {
    return `${seconds.toFixed(2)}s`;
  }
  if (seconds < 10) {
    return `${seconds.toFixed(2)}s`;
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toFixed(0).padStart(2, "0")}`;
}

function handleReplayHistoryShortcut(
  event: KeyboardEvent,
  actions: {
    onRedo: () => void;
    onSelectAll: () => void;
    onUndo: () => void;
  },
): boolean {
  const usesCommandModifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (usesCommandModifier && key === "z" && !event.shiftKey) {
    event.preventDefault();
    actions.onUndo();
    return true;
  }
  if ((usesCommandModifier && event.shiftKey && key === "z") || (event.ctrlKey && key === "y")) {
    event.preventDefault();
    actions.onRedo();
    return true;
  }
  if (usesCommandModifier && key === "a") {
    event.preventDefault();
    actions.onSelectAll();
    return true;
  }
  return false;
}

function handleReplayNudgeShortcut(
  event: KeyboardEvent,
  onNudge: (deltaMs: number) => void,
): boolean {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    onNudge(-EVENT_NUDGE_MS);
    return true;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    onNudge(EVENT_NUDGE_MS);
    return true;
  }
  return false;
}

function handleReplayDeleteShortcut(
  event: KeyboardEvent,
  actions: {
    hasSelection: boolean;
    onHidePrimary: (seq: number, hidden: boolean) => void;
    onHideSelected: () => void;
    onRippleDeleteSelected: () => void;
    primarySeq: number | null;
  },
): boolean {
  if (event.key !== "Backspace" && event.key !== "Delete") {
    return false;
  }
  event.preventDefault();
  if (event.shiftKey && actions.hasSelection) {
    actions.onRippleDeleteSelected();
    return true;
  }
  if (actions.hasSelection) {
    actions.onHideSelected();
    return true;
  }
  if (actions.primarySeq !== null) {
    actions.onHidePrimary(actions.primarySeq, true);
  }
  return true;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const keyboardTarget = target as {
    tagName?: string;
    isContentEditable?: boolean;
  };
  const tagName = keyboardTarget.tagName?.toLowerCase();
  return (
    keyboardTarget.isContentEditable === true ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

function EmptyEvents({ label }: { label: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

const ThemedRadio = withUnistyles(Radio);
const ThemedX = withUnistyles(X);
const ThemedCheck = withUnistyles(Check);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

const recordingColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});

const checkboxIconColorMapping = (theme: Theme) => ({
  color: theme.colors.background,
});

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.38)",
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  panel: {
    width: "96%",
    maxWidth: 1560,
    height: "88%",
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  header: {
    height: 44,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14, fontWeight: "700", color: theme.colors.foreground },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface1,
  },
  errorText: { marginHorizontal: 14, marginTop: 6, color: theme.colors.destructive, fontSize: 12 },
  body: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: theme.colors.surface1 },
  sidebar: {
    width: 300,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    padding: 12,
    gap: 10,
    backgroundColor: theme.colors.background,
  },
  eventsPane: {
    flex: 1,
    padding: 12,
    gap: 10,
    minWidth: 0,
  },
  timelineSection: {
    gap: 8,
  },
  workspaceGrid: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    gap: 10,
  },
  inspectorColumn: {
    width: 430,
    minWidth: 360,
    maxWidth: 500,
    minHeight: 0,
    gap: 10,
  },
  clipsColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    gap: 10,
  },
  editorHeader: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  editorHeaderTitleGroup: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  shortcutHint: {
    color: theme.colors.mutedForeground,
    fontSize: 10,
    lineHeight: 15,
  },
  zoomControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  zoomButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  zoomText: { fontSize: 15, color: theme.colors.foreground, lineHeight: 18 },
  zoomLabel: {
    minWidth: 72,
    textAlign: "center",
    fontSize: 12,
    color: theme.colors.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.mutedForeground,
    letterSpacing: 0,
  },
  recordingList: { flex: 1 },
  recordingRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: "transparent",
    marginBottom: 8,
  },
  recordingRowSelected: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    marginBottom: 8,
  },
  recordingRowContent: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  recordingTextGroup: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  recordingTitle: { fontSize: 13, fontWeight: "800", color: theme.colors.foreground },
  recordingMeta: { fontSize: 11, color: theme.colors.mutedForeground },
  recordingReplayButton: {
    minWidth: 66,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.surface2,
  },
  recordingReplayText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  timelineFrame: {
    height: TIMELINE_TRACK_HEIGHT + 22,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    overflow: "hidden",
  },
  timelineScroll: { flex: 1 },
  timelineCanvas: {
    height: TIMELINE_TRACK_HEIGHT + 22,
    position: "relative",
    backgroundColor: theme.colors.background,
  },
  timelineTick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(15,23,42,0.08)",
  },
  timelineTickLabel: {
    position: "absolute",
    top: 8,
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  timelineLane: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 34,
    borderTopWidth: 1,
    borderTopColor: "rgba(15,23,42,0.08)",
  },
  timelineLaneLabel: {
    position: "absolute",
    left: 10,
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontWeight: "700",
  },
  timelineRangeSelection: {
    position: "absolute",
    top: 24,
    bottom: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: theme.colors.palette.blue[500],
    backgroundColor: "rgba(37,99,235,0.16)",
    zIndex: 2,
  },
  timelineRangeHandle: {
    position: "absolute",
    top: 22,
    bottom: 6,
    width: 3,
    borderRadius: 2,
    backgroundColor: theme.colors.palette.blue[600],
    zIndex: 11,
  },
  timelineRangeHandleLabel: {
    position: "absolute",
    top: -18,
    left: -16,
    minWidth: 34,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
    textAlign: "center",
    color: theme.colors.background,
    backgroundColor: theme.colors.palette.blue[600],
    fontSize: 10,
    fontWeight: "700",
  },
  timelinePlayhead: {
    position: "absolute",
    top: 24,
    bottom: 8,
    width: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.destructive,
    zIndex: 8,
  },
  timelinePlayheadLabel: {
    position: "absolute",
    top: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
    color: theme.colors.background,
    backgroundColor: theme.colors.destructive,
    fontSize: 10,
    fontWeight: "700",
    zIndex: 9,
  },
  timelineClipUser: {
    position: "absolute",
    height: 26,
    borderRadius: 6,
    paddingHorizontal: 8,
    justifyContent: "center",
    backgroundColor: theme.colors.palette.blue[600],
  },
  timelineClipUserSelected: {
    position: "absolute",
    height: 28,
    borderRadius: 7,
    paddingHorizontal: 8,
    justifyContent: "center",
    backgroundColor: theme.colors.palette.blue[700],
    borderWidth: 2,
    borderColor: theme.colors.palette.blue[200],
  },
  timelineClipAssistant: {
    position: "absolute",
    height: 26,
    borderRadius: 6,
    paddingHorizontal: 8,
    justifyContent: "center",
    backgroundColor: theme.colors.palette.green[600],
  },
  timelineClipAssistantSelected: {
    position: "absolute",
    height: 28,
    borderRadius: 7,
    paddingHorizontal: 8,
    justifyContent: "center",
    backgroundColor: theme.colors.statusSuccess,
    borderWidth: 2,
    borderColor: theme.colors.palette.green[200],
  },
  timelineClipOther: {
    position: "absolute",
    height: 26,
    borderRadius: 6,
    paddingHorizontal: 8,
    justifyContent: "center",
    backgroundColor: theme.colors.palette.zinc[500],
  },
  timelineClipOtherSelected: {
    position: "absolute",
    height: 28,
    borderRadius: 7,
    paddingHorizontal: 8,
    justifyContent: "center",
    backgroundColor: theme.colors.palette.zinc[600],
    borderWidth: 2,
    borderColor: theme.colors.palette.zinc[200],
  },
  timelineClipHidden: {
    position: "absolute",
    height: 26,
    borderRadius: 6,
    paddingHorizontal: 8,
    justifyContent: "center",
    backgroundColor: "rgba(113,113,122,0.24)",
    borderWidth: 1,
    borderColor: "rgba(113,113,122,0.4)",
  },
  timelineClipHiddenSelected: {
    position: "absolute",
    height: 28,
    borderRadius: 7,
    paddingHorizontal: 8,
    justifyContent: "center",
    backgroundColor: "rgba(113,113,122,0.28)",
    borderWidth: 2,
    borderColor: theme.colors.palette.zinc[400],
  },
  timelineClipDragging: {
    opacity: 0.84,
    transform: [{ scale: 1.04 }],
    zIndex: 10,
  },
  timelineClipSelectedLayer: {
    zIndex: 7,
  },
  timelineClipText: {
    color: theme.colors.palette.white,
    fontSize: 11,
    fontWeight: "700",
    minWidth: 0,
  },
  inspector: {
    minHeight: 0,
    gap: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  inspectorSummary: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  inspectorSummaryText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  inspectorNavigation: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inspectorTitle: { fontSize: 13, fontWeight: "800", color: theme.colors.foreground },
  inspectorPreview: { fontSize: 12, lineHeight: 17, color: theme.colors.mutedForeground },
  inspectorToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
    justifyContent: "flex-start",
    minWidth: 0,
  },
  inspectorGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 4,
    minHeight: 32,
  },
  inspectorTimeGroup: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: theme.colors.surface1,
  },
  inspectorField: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: "700", color: theme.colors.mutedForeground },
  offsetGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  fieldSuffix: { fontSize: 12, color: theme.colors.mutedForeground },
  visibilityButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.background,
  },
  visibilityText: { fontSize: 12, color: theme.colors.foreground },
  clipEventEditor: {
    flex: 1,
    minHeight: 0,
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  clipEventHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  clipEventCount: {
    minWidth: 28,
    height: 24,
    borderRadius: 12,
    overflow: "hidden",
    textAlign: "center",
    lineHeight: 24,
    color: theme.colors.mutedForeground,
    backgroundColor: theme.colors.background,
    fontSize: 11,
    fontWeight: "700",
  },
  rawEventList: {
    flex: 1,
    minHeight: 0,
  },
  rawEventRow: {
    minHeight: 76,
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: theme.colors.surface1,
    marginBottom: 8,
  },
  rawEventRowSelected: {
    minHeight: 76,
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    marginBottom: 8,
  },
  rawEventHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    minWidth: 0,
  },
  rawEventControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minWidth: 0,
  },
  rawEventActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  rawEventTime: {
    width: 50,
    color: theme.colors.mutedForeground,
    fontSize: 11,
    lineHeight: 17,
    fontVariant: ["tabular-nums"],
  },
  rawEventBody: {
    flex: 1,
    minWidth: 0,
  },
  rawEventTitle: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontWeight: "700",
  },
  rawEventPreview: {
    marginTop: 2,
    color: theme.colors.mutedForeground,
    fontSize: 11,
  },
  bulkToolbar: {
    minHeight: 0,
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  bulkToolbarMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  bulkToolbarSelection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  bulkToolbarText: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontWeight: "700",
  },
  bulkToolbarSelectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingRight: 10,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  bulkIconButton: {
    width: 32,
    height: 30,
    minHeight: 30,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 7,
  },
  bulkIconButtonActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  removeGapStepControl: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: theme.colors.surface1,
  },
  removeGapSettings: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  removeGapSettingsLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  removeGapStepInput: {
    width: 48,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.background,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  removeGapModeButton: {
    minWidth: 28,
    height: 24,
    minHeight: 24,
    paddingHorizontal: 6,
    paddingVertical: 0,
    borderRadius: 6,
  },
  bulkToolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },
  eventStrip: {
    flex: 1,
    minHeight: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    overflow: "hidden",
  },
  eventStripHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  eventStripList: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  eventStripListContent: {
    padding: 8,
  },
  eventStripRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  eventStripRowSelected: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 4,
  },
  eventStripCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  eventStripCheckboxChecked: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.foreground,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.foreground,
  },
  eventStripTime: {
    width: 54,
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  eventStripBody: { flex: 1, minWidth: 0 },
  eventStripTitle: { color: theme.colors.foreground, fontSize: 12, fontWeight: "700" },
  eventStripPreview: { marginTop: 2, color: theme.colors.mutedForeground, fontSize: 11 },
  eventList: { flex: 1 },
  eventRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  eventIcon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  eventBody: { flex: 1, minWidth: 0 },
  eventKind: { fontSize: 11, color: theme.colors.foreground },
  offsetInput: {
    marginTop: 0,
    height: 28,
    maxWidth: 116,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 8,
    color: theme.colors.foreground,
    fontSize: 12,
    backgroundColor: theme.colors.background,
  },
  resetButton: { paddingHorizontal: 6, height: 24, justifyContent: "center" },
  resetText: { fontSize: 11, color: theme.colors.mutedForeground },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: theme.colors.mutedForeground, fontSize: 14 },
}));
