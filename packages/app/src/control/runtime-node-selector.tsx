import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { AccountBootstrapSession } from "@/account/account-api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getControlRuntimeNodeOptions,
  isControlApiConfigured,
  updateControlRuntimeNodePreference,
  type ControlRuntimeNodeOptions,
  type ControlSchedulerDaemonNodeRecord,
} from "@/control/control-api";
import {
  loadRuntimeNodePreference,
  saveRuntimeNodePreference,
  type RuntimeNodePreference,
} from "@/control/runtime-node-preference";
import { useToast } from "@/contexts/toast-context";
import { useI18n } from "@/i18n/i18n";
import { ChevronDown, RefreshCw } from "@/components/icons/lucide";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const CLOUD_CARD_BACKGROUND_SOURCE = require("../../assets/images/runtime-node-cloud-bg.png");
const LOCAL_CARD_BACKGROUND_SOURCE = require("../../assets/images/runtime-node-local-bg.png");
const FOOTER_GRADIENT_STYLE = inlineUnistylesStyle({
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundImage: "linear-gradient(180deg, rgba(244, 239, 255, 0.96) 0%, #ffffff 100%)",
});

interface RuntimeNodeSelectorProps {
  accountSession: AccountBootstrapSession | null;
  disabled?: boolean;
}

type PressableStyleState = PressableStateCallbackType & { hovered?: boolean };

export function RuntimeNodeSelector({ accountSession, disabled }: RuntimeNodeSelectorProps) {
  const { t } = useI18n();
  const { theme } = useUnistyles();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [preference, setPreference] = useState<RuntimeNodePreference>({ mode: "cloud" });
  const [nodes, setNodes] = useState<ControlSchedulerDaemonNodeRecord[]>([]);
  const isControlConfigured = isControlApiConfigured();
  const canUseControl =
    isControlConfigured && accountSession?.workspace.workspaceId.startsWith("control:") === true;

  const reloadOptions = useCallback(async () => {
    const state = await resolveRuntimeNodeState({
      accountSession: canUseControl ? accountSession : null,
    });
    setPreference(state.preference);
    setNodes(state.nodes);
  }, [accountSession, canUseControl]);
  const handleControlError = useCallback(
    (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
    [toast],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const state = await resolveRuntimeNodeState({
        accountSession: canUseControl ? accountSession : null,
      });
      if (!cancelled) {
        setPreference(state.preference);
        setNodes(state.nodes);
      }
    }
    void load().catch(() => {
      if (!cancelled) {
        setNodes([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accountSession, canUseControl]);

  const selectedNode = useMemo(
    () =>
      preference.mode === "fixed"
        ? (nodes.find((node) => node.id === preference.nodeId) ?? null)
        : null,
    [nodes, preference],
  );
  const label = selectedNode
    ? t("runtimeNode.selector.localDaemon")
    : t("runtimeNode.selector.cloudAuto");
  const isLocalNodeSelected = Boolean(selectedNode);
  const triggerInnerStyle = useMemo(
    () => [
      styles.triggerInner,
      isLocalNodeSelected ? styles.triggerInnerLocal : styles.triggerInnerCloud,
      disabled ? styles.triggerInnerDisabled : null,
    ],
    [disabled, isLocalNodeSelected],
  );
  const triggerIconStyle = useMemo(
    () => [styles.iconTile, isLocalNodeSelected ? styles.iconTileLocal : styles.iconTileCloud],
    [isLocalNodeSelected],
  );
  const handleSelectCloud = useCallback(async () => {
    try {
      const nextPreference = await persistPreference({
        accountSession: canUseControl ? accountSession : null,
        preference: { mode: "cloud" },
      });
      setPreference(nextPreference);
      setMenuOpen(false);
      toast.show(t("runtimeNode.selector.toastCloud"));
    } catch (error) {
      handleControlError(error);
    }
  }, [accountSession, canUseControl, handleControlError, t, toast]);

  const handleSelectNode = useCallback(
    async (nodeId: string) => {
      try {
        const nextPreference = await persistPreference({
          accountSession: canUseControl ? accountSession : null,
          preference: { mode: "fixed", nodeId },
        });
        setPreference(nextPreference);
        setMenuOpen(false);
        toast.show(t("runtimeNode.selector.toastFixed"));
      } catch (error) {
        handleControlError(error);
      }
    },
    [accountSession, canUseControl, handleControlError, t, toast],
  );

  const handlePressCloud = useCallback(() => {
    void handleSelectCloud();
  }, [handleSelectCloud]);
  const handlePressNode = useCallback(
    (nodeId: string) => {
      void handleSelectNode(nodeId);
    },
    [handleSelectNode],
  );
  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    void reloadOptions()
      .catch(handleControlError)
      .finally(() => {
        setIsRefreshing(false);
      });
  }, [handleControlError, isRefreshing, reloadOptions]);

  if (nodes.length === 0 || (!isControlConfigured && preference.mode !== "fixed")) {
    return null;
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger disabled={disabled} style={styles.trigger}>
        <View style={triggerInnerStyle}>
          {isLocalNodeSelected ? <TriggerLocalBackdrop /> : <TriggerCloudBackdrop />}
          <View style={triggerIconStyle}>
            {isLocalNodeSelected ? (
              <LocalDaemonGlyph size={17} color={theme.colors.palette.purple[600]} />
            ) : (
              <CloudUploadGlyph size={20} color="#087f5b" strokeWidth={3.2} />
            )}
            {isLocalNodeSelected ? null : <View style={styles.triggerIconDot} />}
          </View>
          <View style={styles.triggerTextGroup}>
            <Text style={styles.triggerLabel} numberOfLines={1}>
              {label}
            </Text>
          </View>
          <View style={styles.chevronBadge}>
            <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </View>
        </View>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={276} maxHeight={220} offset={16}>
        <View style={styles.menuPanel}>
          <CloudRuntimeOption selected={preference.mode === "cloud"} onPress={handlePressCloud} />

          {nodes.map((node) => (
            <LocalRuntimeOption
              key={node.id}
              node={node}
              selected={preference.mode === "fixed" && preference.nodeId === node.id}
              onSelect={handlePressNode}
            />
          ))}

          <RuntimeSelectorFooter isRefreshing={isRefreshing} onRefresh={handleRefresh} />
        </View>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TriggerCloudBackdrop() {
  return (
    <View style={styles.triggerCloudBackdrop} pointerEvents="none">
      <Image
        source={CLOUD_CARD_BACKGROUND_SOURCE}
        style={styles.triggerCloudBackdropImage}
        resizeMode="cover"
      />
    </View>
  );
}

function TriggerLocalBackdrop() {
  return (
    <View style={styles.triggerLocalBackdrop} pointerEvents="none">
      <Image
        source={LOCAL_CARD_BACKGROUND_SOURCE}
        style={styles.triggerLocalBackdropImage}
        resizeMode="cover"
      />
    </View>
  );
}

function CloudRuntimeOption({ selected, onPress }: { selected: boolean; onPress: () => void }) {
  const { t } = useI18n();
  const cardStyle = useCallback(
    ({ pressed, hovered }: PressableStyleState): StyleProp<ViewStyle> => [
      styles.optionCard,
      selected ? styles.cloudCardSelected : styles.cloudCard,
      selected ? styles.optionCardSelected : null,
      pressed || hovered ? styles.optionCardInteractive : null,
    ],
    [selected],
  );

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={cardStyle}>
      <CloudBackdrop selected={selected} />
      <View style={styles.cloudIconHalo}>
        <CloudUploadGlyph size={26} color="#079455" strokeWidth={3.6} />
      </View>
      <View style={styles.optionCopy}>
        <View style={styles.optionTitleRow}>
          <Text style={styles.optionTitle}>{t("runtimeNode.selector.cloudAuto")}</Text>
        </View>
        <Text style={styles.optionDescription} numberOfLines={1}>
          {t("runtimeNode.selector.cloudDescription")}
        </Text>
      </View>
    </Pressable>
  );
}

function CloudBackdrop({ selected }: { selected: boolean }) {
  const backdropStyle = useMemo(
    () => [styles.cloudBackdrop, selected ? styles.cloudBackdropSelected : null],
    [selected],
  );
  return (
    <View style={backdropStyle} pointerEvents="none">
      <Image
        source={CLOUD_CARD_BACKGROUND_SOURCE}
        style={styles.cloudBackdropImage}
        resizeMode="cover"
      />
    </View>
  );
}

function LocalRuntimeOption({
  node,
  selected,
  onSelect,
}: {
  node: ControlSchedulerDaemonNodeRecord;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  const cardStyle = useCallback(
    ({ pressed, hovered }: PressableStyleState): StyleProp<ViewStyle> => [
      styles.optionCard,
      styles.localCard,
      selected ? styles.localCardSelected : null,
      pressed || hovered ? styles.optionCardInteractive : null,
    ],
    [selected],
  );
  const handlePress = useCallback(() => {
    onSelect(node.id);
  }, [node.id, onSelect]);

  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={cardStyle}>
      <LocalBackdrop selected={selected} />
      <View style={styles.localIconTile}>
        <LocalDaemonGlyph size={20} color="#4f46e5" />
      </View>
      <View style={styles.optionCopy}>
        <Text style={styles.optionTitle}>{t("runtimeNode.selector.localDaemon")}</Text>
        <View style={styles.nodeMetaRow}>
          <Text style={styles.nodeId} numberOfLines={1}>
            {node.id}
          </Text>
          <Text style={styles.nodeSeparator}>|</Text>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>{node.status}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function LocalBackdrop({ selected }: { selected: boolean }) {
  const backdropStyle = useMemo(
    () => [styles.localBackdrop, selected ? styles.localBackdropSelected : null],
    [selected],
  );
  return (
    <View style={backdropStyle} pointerEvents="none">
      <Image
        source={LOCAL_CARD_BACKGROUND_SOURCE}
        style={styles.localBackdropImage}
        resizeMode="cover"
      />
    </View>
  );
}

function CloudUploadGlyph({
  size,
  color,
  strokeWidth,
}: {
  size: number;
  color: string;
  strokeWidth: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path
        d="M18 34H15.5C10.8 34 7 30.2 7 25.5S10.8 17 15.5 17C17.2 11.8 22 8 27.7 8C34.5 8 40 13.5 40 20.3C43.1 21.2 45.3 24 45.3 27.3C45.3 31.3 42 34.6 38 34.6H35"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M26.5 41V24M26.5 24L18.5 32M26.5 24L34.5 32"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function LocalDaemonGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path d="M11 20L14 11H34L37 20" stroke={color} strokeWidth={3} strokeLinejoin="round" />
      <Rect x={9} y={20} width={30} height={18} rx={3} stroke={color} strokeWidth={3} />
      <Circle cx={18} cy={29} r={2.2} fill={color} />
      <Circle cx={25} cy={29} r={2.2} fill={color} />
    </Svg>
  );
}

function RuntimeSelectorFooter({
  isRefreshing,
  onRefresh,
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useUnistyles();
  const rotation = useSharedValue(0);
  const actionStyle = useCallback(
    ({ pressed, hovered }: PressableStyleState): StyleProp<ViewStyle> => [
      styles.footerAction,
      pressed || hovered ? styles.footerActionInteractive : null,
    ],
    [],
  );
  const refreshIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  useEffect(() => {
    if (isRefreshing) {
      rotation.value = withRepeat(
        withTiming(360, {
          duration: 800,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
      return;
    }
    cancelAnimation(rotation);
    rotation.value = withTiming(0, {
      duration: 120,
      easing: Easing.out(Easing.ease),
    });
  }, [isRefreshing, rotation]);

  return (
    <View style={styles.menuFooter}>
      <View style={FOOTER_GRADIENT_STYLE} pointerEvents="none" />
      <View style={styles.footerDecorLine} pointerEvents="none" />
      <View style={styles.footerDecorDotOne} pointerEvents="none" />
      <View style={styles.footerDecorDotTwo} pointerEvents="none" />
      <Pressable
        accessibilityRole="button"
        disabled={isRefreshing}
        onPress={onRefresh}
        style={actionStyle}
      >
        <View style={styles.footerIconButton}>
          <Animated.View style={refreshIconStyle}>
            <RefreshCw size={14} color={theme.colors.palette.purple[500]} />
          </Animated.View>
        </View>
        <Text style={styles.footerActionText}>{t("runtimeNode.selector.refreshStatus")}</Text>
      </Pressable>
    </View>
  );
}

async function resolveRuntimeNodeState(input: {
  accountSession: AccountBootstrapSession | null;
}): Promise<{
  preference: RuntimeNodePreference;
  nodes: ControlSchedulerDaemonNodeRecord[];
}> {
  if (!input.accountSession) {
    return {
      preference: await loadRuntimeNodePreference(),
      nodes: [],
    };
  }
  const options = await getControlRuntimeNodeOptions({ accountSession: input.accountSession });
  return {
    preference: normalizeControlPreference(options),
    nodes: options.nodes,
  };
}

function normalizeControlPreference(options: ControlRuntimeNodeOptions): RuntimeNodePreference {
  if (options.preference.mode === "fixed" && options.preference.nodeId) {
    void saveRuntimeNodePreference({ mode: "fixed", nodeId: options.preference.nodeId });
    return { mode: "fixed", nodeId: options.preference.nodeId };
  }
  void saveRuntimeNodePreference({ mode: "cloud" });
  return { mode: "cloud" };
}

async function persistPreference(input: {
  accountSession: AccountBootstrapSession | null;
  preference: RuntimeNodePreference;
}): Promise<RuntimeNodePreference> {
  const localPreference = await saveRuntimeNodePreference(input.preference);
  if (!input.accountSession) {
    return localPreference;
  }
  const controlPreference = await updateControlRuntimeNodePreference({
    accountSession: input.accountSession,
    preference:
      localPreference.mode === "fixed"
        ? { mode: "fixed", nodeId: localPreference.nodeId }
        : { mode: "cloud" },
  });
  if (controlPreference.mode === "fixed" && controlPreference.nodeId) {
    return saveRuntimeNodePreference({ mode: "fixed", nodeId: controlPreference.nodeId });
  }
  return saveRuntimeNodePreference({ mode: "cloud" });
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexShrink: 1,
  },
  triggerInner: {
    position: "relative",
    height: 48,
    width: 188,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 19,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: 9,
    paddingVertical: 6,
    shadowColor: "rgba(59, 79, 120, 0.12)",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 22,
    elevation: 3,
    overflow: "hidden",
  },
  triggerInnerCloud: {
    backgroundColor: "rgba(244, 255, 249, 0.88)",
    borderColor: "rgba(187, 247, 208, 0.75)",
  },
  triggerInnerLocal: {
    backgroundColor: "rgba(250, 245, 255, 0.86)",
    borderColor: "rgba(216, 180, 254, 0.58)",
  },
  triggerInnerDisabled: {
    opacity: 0.65,
  },
  triggerCloudBackdrop: {
    position: "absolute",
    right: -4,
    top: 0,
    width: 86,
    height: 48,
    opacity: 0.42,
    zIndex: 0,
  },
  triggerCloudBackdropImage: {
    width: "100%",
    height: "100%",
  },
  triggerLocalBackdrop: {
    position: "absolute",
    right: -7,
    top: 0,
    width: 86,
    height: 48,
    opacity: 0.32,
    zIndex: 0,
  },
  triggerLocalBackdropImage: {
    width: "100%",
    height: "100%",
  },
  iconTile: {
    position: "relative",
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
    shadowColor: "rgba(34, 197, 94, 0.16)",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 14,
    zIndex: 1,
  },
  iconTileCloud: {
    backgroundColor: "rgba(198, 255, 223, 0.82)",
    borderColor: "rgba(105, 235, 175, 0.42)",
  },
  iconTileLocal: {
    backgroundColor: "rgba(168, 85, 247, 0.12)",
    borderColor: "rgba(168, 85, 247, 0.22)",
  },
  triggerIconDot: {
    position: "absolute",
    right: -2,
    bottom: 5,
    width: 9,
    height: 9,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#12b76a",
    borderWidth: 2,
    borderColor: "#ffffff",
    shadowColor: "rgba(18, 183, 106, 0.42)",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  triggerTextGroup: {
    minWidth: 0,
    flexShrink: 1,
    zIndex: 1,
  },
  triggerLabel: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 18,
  },
  chevronBadge: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f2f4f8",
    marginLeft: "auto",
    zIndex: 1,
  },
  menuPanel: {
    padding: 8,
    paddingTop: 8,
    paddingBottom: 0,
    gap: 7,
    backgroundColor: "rgba(255, 255, 255, 0.82)",
  },
  optionCard: {
    position: "relative",
    minHeight: 48,
    borderRadius: 12,
    borderWidth: theme.borderWidth[1],
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: "hidden",
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  cloudCard: {
    minHeight: 68,
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    borderColor: "rgba(218, 225, 236, 0.9)",
    paddingRight: 88,
  },
  cloudCardSelected: {
    minHeight: 68,
    backgroundColor: "rgba(235, 255, 247, 0.82)",
    borderColor: "rgba(21, 185, 124, 0.54)",
    paddingRight: 88,
  },
  optionCardSelected: {
    borderColor: "rgba(21, 185, 124, 0.46)",
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  optionCardInteractive: {
    transform: [{ translateY: -1 }],
  },
  optionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "nowrap",
  },
  optionTitle: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "800",
  },
  optionDescription: {
    marginTop: 3,
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 15,
  },
  cloudBackdrop: {
    position: "absolute",
    right: -1,
    top: 0,
    width: 128,
    height: 68,
    opacity: 0.28,
    zIndex: 0,
  },
  cloudBackdropSelected: {
    opacity: 0.9,
  },
  cloudBackdropImage: {
    width: "100%",
    height: "100%",
  },
  cloudIconHalo: {
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    shadowColor: "rgba(18, 183, 106, 0.14)",
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 1,
    shadowRadius: 18,
    zIndex: 1,
  },
  optionCopy: {
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
    zIndex: 1,
  },
  localCard: {
    minHeight: 60,
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    borderColor: "rgba(218, 225, 236, 0.9)",
  },
  localCardSelected: {
    borderColor: "rgba(168, 85, 247, 0.38)",
    backgroundColor: "rgba(250, 245, 255, 0.72)",
  },
  emptyCard: {
    opacity: 0.78,
  },
  localIconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef0ff",
    shadowColor: "rgba(99, 102, 241, 0.13)",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 18,
    zIndex: 1,
  },
  localBackdrop: {
    position: "absolute",
    right: -10,
    top: 0,
    width: 112,
    height: 60,
    opacity: 0.24,
    zIndex: 0,
  },
  localBackdropSelected: {
    opacity: 0.34,
  },
  localBackdropImage: {
    width: "100%",
    height: "100%",
  },
  nodeMetaRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    zIndex: 1,
  },
  nodeId: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
  nodeSeparator: {
    color: "#cbd5e1",
    fontSize: 12,
    marginHorizontal: 4,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#12b76a",
    shadowColor: "rgba(18, 183, 106, 0.1)",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  onlineText: {
    color: "#079455",
    fontSize: 12,
  },
  menuFooter: {
    position: "relative",
    height: 30,
    marginHorizontal: -7,
    marginTop: 0,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: "rgba(218, 225, 236, 0.86)",
    backgroundColor: "transparent",
    paddingHorizontal: 7,
    paddingVertical: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[3],
    overflow: "hidden",
  },
  footerDecorLine: {
    position: "absolute",
    left: 14,
    right: 92,
    bottom: 7,
    height: 1,
    backgroundColor: "rgba(167, 139, 250, 0.2)",
    transform: [{ rotate: "-7deg" }],
  },
  footerDecorDotOne: {
    position: "absolute",
    left: 100,
    bottom: 7,
    width: 4,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(147, 197, 253, 0.55)",
  },
  footerDecorDotTwo: {
    position: "absolute",
    left: 142,
    top: 7,
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(196, 181, 253, 0.62)",
  },
  footerAction: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingRight: theme.spacing[3],
    zIndex: 1,
  },
  footerActionInteractive: {
    backgroundColor: theme.colors.surface0,
  },
  footerIconButton: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(203, 213, 225, 0.55)",
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  footerActionText: {
    color: "#4b5565",
    fontSize: 12,
    fontWeight: theme.fontWeight.semibold,
  },
}));
