import type { ConversationRecording } from "@getdoya/protocol/messages";
import { Pause, Play, Radio, RotateCcw, SlidersHorizontal, X } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/i18n";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import {
  type ConversationReplaySpeed,
  resolveRecordingToggleAction,
} from "./conversation-replay-controls";

const SPEEDS = [0.5, 1, 2, 4] as const;
type ReplaySpeed = ConversationReplaySpeed;

interface ActiveReplayControlsState {
  recording: ConversationRecording;
  positionMs: number;
  isPlaying: boolean;
  speed: ReplaySpeed;
}

function formatReplayTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ConversationReplayComposerControls({
  serverId,
  agentId,
  activeReplay,
  replayDurationMs,
  onOpenReplayPanel,
  onSetReplayPlaying,
  onRestartReplay,
  onSetReplaySpeed,
  onExitReplay,
}: {
  serverId: string;
  agentId?: string;
  activeReplay: ActiveReplayControlsState | null;
  replayDurationMs: number;
  onOpenReplayPanel: () => void;
  onSetReplayPlaying: (isPlaying: boolean) => void;
  onRestartReplay: () => void;
  onSetReplaySpeed: (speed: ReplaySpeed) => void;
  onExitReplay: () => void;
}) {
  const { t } = useI18n();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshActiveRecording = useCallback(async () => {
    if (!client || !agentId) {
      setActiveRecordingId(null);
      return;
    }
    const recordings = await client.listConversationRecordings(agentId);
    setActiveRecordingId(
      recordings.find((recording) => recording.status === "recording")?.recordingId ?? null,
    );
  }, [agentId, client]);

  useEffect(() => {
    void refreshActiveRecording().catch(() => undefined);
  }, [refreshActiveRecording]);

  const handleToggleRecording = useCallback(async () => {
    if (!client || !agentId || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      const action = resolveRecordingToggleAction(activeRecordingId);
      if (action.kind === "stop") {
        await client.stopConversationRecording(agentId, { recordingId: action.recordingId });
        setActiveRecordingId(null);
      } else {
        const recording = await client.startConversationRecording(agentId);
        setActiveRecordingId(recording.recordingId);
      }
    } finally {
      setIsBusy(false);
    }
  }, [activeRecordingId, agentId, client, isBusy]);
  const handleToggleReplayPlaying = useCallback(() => {
    if (activeReplay) {
      onSetReplayPlaying(!activeReplay.isPlaying);
    }
  }, [activeReplay, onSetReplayPlaying]);

  if (!agentId) {
    return null;
  }

  if (activeReplay) {
    return (
      <View style={styles.controls} testID="conversation-replay-composer-controls">
        <ComposerIconButton
          label={
            activeReplay.isPlaying
              ? t("replay.control.pauseReplay")
              : t("replay.control.playReplay")
          }
          onPress={handleToggleReplayPlaying}
        >
          {activeReplay.isPlaying ? (
            <ThemedPause size={16} uniProps={foregroundColorMapping} />
          ) : (
            <ThemedPlay size={16} uniProps={foregroundColorMapping} />
          )}
        </ComposerIconButton>
        <ComposerIconButton label={t("replay.control.restartReplay")} onPress={onRestartReplay}>
          <ThemedRotateCcw size={16} uniProps={foregroundColorMapping} />
        </ComposerIconButton>
        <Text style={styles.timeText}>
          {formatReplayTime(activeReplay.positionMs)} / {formatReplayTime(replayDurationMs)}
        </Text>
        {SPEEDS.map((speed) => (
          <ReplaySpeedButton
            key={speed}
            speed={speed}
            selected={activeReplay.speed === speed}
            onSetReplaySpeed={onSetReplaySpeed}
            label={t("replay.control.setSpeed", { speed })}
          />
        ))}
        <ComposerIconButton label={t("replay.control.exitReplay")} onPress={onExitReplay}>
          <ThemedX size={16} uniProps={foregroundColorMapping} />
        </ComposerIconButton>
      </View>
    );
  }

  return (
    <View style={styles.controls} testID="conversation-recording-composer-controls">
      <ComposerIconButton
        label={
          activeRecordingId ? t("replay.control.stopRecording") : t("replay.control.startRecording")
        }
        onPress={handleToggleRecording}
        disabled={!client || isBusy}
        active={Boolean(activeRecordingId)}
      >
        <ThemedRadio
          size={16}
          uniProps={activeRecordingId ? recordingColorMapping : foregroundColorMapping}
        />
      </ComposerIconButton>
      <ComposerIconButton label={t("replay.control.openTimeline")} onPress={onOpenReplayPanel}>
        <ThemedSlidersHorizontal size={16} uniProps={foregroundColorMapping} />
      </ComposerIconButton>
    </View>
  );
}

export function ConversationReplayDraftControls({
  recordConversation,
  onChangeRecordConversation,
}: {
  recordConversation: boolean;
  onChangeRecordConversation: (recordConversation: boolean) => void;
}) {
  const { t } = useI18n();
  const handlePress = useCallback(() => {
    onChangeRecordConversation(!recordConversation);
  }, [onChangeRecordConversation, recordConversation]);
  return (
    <View style={styles.controls} testID="conversation-recording-draft-controls">
      <ComposerIconButton
        label={
          recordConversation
            ? t("replay.control.recordNewChat")
            : t("replay.control.doNotRecordNewChat")
        }
        onPress={handlePress}
        active={recordConversation}
      >
        <ThemedRadio
          size={16}
          uniProps={recordConversation ? recordingColorMapping : foregroundColorMapping}
        />
      </ComposerIconButton>
    </View>
  );
}

function ComposerIconButton({
  label,
  onPress,
  disabled,
  active,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  let buttonStyle = styles.iconButton;
  if (active) {
    buttonStyle = styles.iconButtonActive;
  }
  if (disabled) {
    buttonStyle = styles.iconButtonDisabled;
  }
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityRole="button"
        style={buttonStyle}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ReplaySpeedButton({
  speed,
  selected,
  onSetReplaySpeed,
  label,
}: {
  speed: ReplaySpeed;
  selected: boolean;
  onSetReplaySpeed: (speed: ReplaySpeed) => void;
  label: string;
}) {
  const handlePress = useCallback(() => {
    onSetReplaySpeed(speed);
  }, [onSetReplaySpeed, speed]);
  return (
    <Pressable
      style={selected ? styles.speedButtonActive : styles.speedButton}
      onPress={handlePress}
      accessibilityLabel={label}
    >
      <Text style={styles.speedText}>{speed}x</Text>
    </Pressable>
  );
}

const ThemedPause = withUnistyles(Pause);
const ThemedPlay = withUnistyles(Play);
const ThemedRadio = withUnistyles(Radio);
const ThemedRotateCcw = withUnistyles(RotateCcw);
const ThemedSlidersHorizontal = withUnistyles(SlidersHorizontal);
const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

const recordingColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});

const styles = StyleSheet.create((theme) => ({
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface1,
  },
  iconButtonActive: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  iconButtonDisabled: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface1,
    opacity: 0.5,
  },
  timeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  speedButton: {
    height: 24,
    minWidth: 34,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface1,
  },
  speedButtonActive: {
    height: 24,
    minWidth: 34,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  speedText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontWeight: "600",
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
