import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import * as Clipboard from "expo-clipboard";
import { openExternalUrl } from "@/utils/open-external-url";
import { BookOpen, Copy, RotateCw, TriangleAlert } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { DoyaLogo } from "@/components/icons/doya-logo";
import { Button } from "@/components/ui/button";
import { getDesktopDaemonLogs, type DesktopDaemonLogs } from "@/desktop/daemon/desktop-daemon";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { isWeb } from "@/constants/platform";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { translateNow } from "@/i18n/i18n";

interface StartupSplashScreenProps {
  bootstrapState?: {
    splashError: string | null;
    retry: () => void;
  };
}

const GITHUB_ISSUE_URL = "https://github.com/getpaseo/paseo/issues/new";
const DOCS_URL = "https://paseo.sh/docs";

const LOGO_SIZE = 96;
const LOGO_GROWTH_DURATION_MS = 1800;
const LOGO_GROWTH_PAUSE_MS = 450;
const DOYA_LOGO_COLORS = {
  stem: "#2E7D42",
  leftLeaf: "#43C463",
  rightLeaf: "#9BDB45",
  seed: "#D0A13A",
} as const;

function openGithubIssue(): void {
  void openExternalUrl(GITHUB_ISSUE_URL);
}

function openDocs(): void {
  void openExternalUrl(DOCS_URL);
}

function LogoGrowth() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: LOGO_GROWTH_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        }),
        withDelay(
          LOGO_GROWTH_PAUSE_MS,
          withTiming(0, {
            duration: 1,
            easing: Easing.linear,
          }),
        ),
      ),
      -1,
      false,
    );
  }, [progress]);

  const seedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.08, 1], [1, 1, 1], Extrapolation.CLAMP);
    const scale = interpolate(
      progress.value,
      [0, 0.12, 0.24, 1],
      [0.9, 1.08, 1, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity,
      transform: [
        { translateY: interpolate(progress.value, [0, 0.2], [8, 0], Extrapolation.CLAMP) },
        { scale },
      ],
    };
  });

  const stemStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.14, 0.22, 1], [0, 1, 1], Extrapolation.CLAMP);
    const scaleY = interpolate(progress.value, [0.18, 0.44], [0.08, 1], Extrapolation.CLAMP);

    return {
      opacity,
      transformOrigin: "50% 70%",
      transform: [{ scaleY }],
    };
  });

  const leftLeafStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.38, 0.48, 1], [0, 1, 1], Extrapolation.CLAMP);
    const scale = interpolate(progress.value, [0.4, 0.62], [0.42, 1], Extrapolation.CLAMP);
    const rotate = interpolate(progress.value, [0.4, 0.62], [18, 0], Extrapolation.CLAMP);

    return {
      opacity,
      transformOrigin: "50% 45%",
      transform: [{ scale }, { rotate: `${rotate}deg` }],
    };
  });

  const rightLeafStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.46, 0.56, 1], [0, 1, 1], Extrapolation.CLAMP);
    const scale = interpolate(progress.value, [0.48, 0.7], [0.42, 1], Extrapolation.CLAMP);
    const rotate = interpolate(progress.value, [0.48, 0.7], [-18, 0], Extrapolation.CLAMP);

    return {
      opacity,
      transformOrigin: "50% 45%",
      transform: [{ scale }, { rotate: `${rotate}deg` }],
    };
  });
  const seedCombinedStyle = useMemo(() => [styles.logoGrowthLayer, seedStyle], [seedStyle]);
  const stemCombinedStyle = useMemo(() => [styles.logoGrowthLayer, stemStyle], [stemStyle]);
  const leftLeafCombinedStyle = useMemo(
    () => [styles.logoGrowthLayer, leftLeafStyle],
    [leftLeafStyle],
  );
  const rightLeafCombinedStyle = useMemo(
    () => [styles.logoGrowthLayer, rightLeafStyle],
    [rightLeafStyle],
  );

  return (
    <View style={styles.logoGrowth}>
      <Animated.View style={seedCombinedStyle}>
        <Svg width={LOGO_SIZE} height={LOGO_SIZE} viewBox="0 0 24 24" fill="none">
          <Path
            d="M8.3 18.1c0-2 1.6-3.5 3.7-3.5s3.7 1.5 3.7 3.5c0 1.2-1.1 1.9-3.7 1.9s-3.7-.7-3.7-1.9Z"
            fill={DOYA_LOGO_COLORS.seed}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={stemCombinedStyle}>
        <Svg width={LOGO_SIZE} height={LOGO_SIZE} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 16.9V9.2"
            stroke={DOYA_LOGO_COLORS.stem}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={leftLeafCombinedStyle}>
        <Svg width={LOGO_SIZE} height={LOGO_SIZE} viewBox="0 0 24 24" fill="none">
          <Path
            d="M11.9 9.5C8.8 9.2 7 7.6 6.3 5.1c3.2-.3 5.2 1.1 6.2 3.8"
            fill={DOYA_LOGO_COLORS.leftLeaf}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={rightLeafCombinedStyle}>
        <Svg width={LOGO_SIZE} height={LOGO_SIZE} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12.1 9.5c3.1-.3 4.9-1.9 5.6-4.4-3.2-.3-5.2 1.1-6.2 3.8"
            fill={DOYA_LOGO_COLORS.rightLeaf}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[8],
  },
  errorScreen: {
    position: "relative",
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  errorScrollView: {
    flex: 1,
    ...(isWeb
      ? {
          overflowX: "auto",
          overflowY: "auto",
          WebkitAppRegion: "no-drag",
        }
      : null),
  },
  errorScrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[8],
    paddingTop: theme.spacing[16],
  },
  errorContent: {
    alignItems: "stretch",
    maxWidth: 720,
    width: "100%",
    gap: theme.spacing[6],
  },
  errorHeader: {
    alignItems: "flex-start",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
    textAlign: "left",
  },
  errorDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  errorMessage: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.code,
    lineHeight: 20,
    fontFamily: theme.fontFamily.mono,
  },
  logsMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  logsContainer: {
    height: 200,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  logsScroll: {
    flexGrow: 0,
  },
  logsContent: {
    padding: theme.spacing[4],
  },
  logsText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
    lineHeight: 18,
    ...(isWeb
      ? {
          whiteSpace: "pre",
          overflowWrap: "normal",
        }
      : null),
  },
  actionRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
    flexWrap: "wrap",
  },
  logoGrowth: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  logoGrowthLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
}));

export function StartupSplashScreen({ bootstrapState }: StartupSplashScreenProps) {
  const { theme } = useUnistyles();
  const webScrollbarStyle = useWebScrollbarStyle();
  const errorScrollViewStyle = useMemo(
    () => [styles.errorScrollView, webScrollbarStyle],
    [webScrollbarStyle],
  );
  const logsScrollStyle = useMemo(
    () => [styles.logsScroll, webScrollbarStyle],
    [webScrollbarStyle],
  );
  const [daemonLogs, setDaemonLogs] = useState<DesktopDaemonLogs | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const isError = bootstrapState !== undefined && bootstrapState.splashError !== null;

  useEffect(() => {
    if (!isError) {
      setDaemonLogs(null);
      setLogsError(null);
      setIsLoadingLogs(false);
      return;
    }

    let isCancelled = false;
    setIsLoadingLogs(true);
    setLogsError(null);

    void getDesktopDaemonLogs()
      .then((logs) => {
        if (isCancelled) {
          return;
        }
        setDaemonLogs(logs);
        return;
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setDaemonLogs(null);
        setLogsError(`Unable to load daemon logs: ${message}`);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingLogs(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isError]);

  const logsText = useMemo(() => {
    if (isLoadingLogs) {
      return "Loading daemon logs...";
    }
    if (daemonLogs?.contents) {
      return daemonLogs.contents;
    }
    if (logsError) {
      return logsError;
    }
    return "No daemon logs available.";
  }, [daemonLogs?.contents, isLoadingLogs, logsError]);

  const handleCopyLogs = useCallback(() => {
    const payload = daemonLogs?.logPath
      ? `${daemonLogs.logPath}\n\n${daemonLogs.contents}`
      : logsText;
    void Clipboard.setStringAsync(payload);
  }, [daemonLogs?.logPath, daemonLogs?.contents, logsText]);

  const copyIcon = useMemo(
    () => <Copy size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );
  const warningIcon = useMemo(
    () => <TriangleAlert size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );
  const bookIcon = useMemo(
    () => <BookOpen size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );
  const retryIcon = useMemo(
    () => <RotateCw size={16} color={theme.colors.palette.white} />,
    [theme.colors.palette.white],
  );

  if (!isError) {
    return (
      <View testID="startup-splash" style={styles.container}>
        <TitlebarDragRegion />
        <LogoGrowth />
      </View>
    );
  }

  return (
    <View style={styles.errorScreen}>
      <TitlebarDragRegion />
      <ScrollView
        style={errorScrollViewStyle}
        contentContainerStyle={styles.errorScrollContent}
        showsVerticalScrollIndicator
      >
        <View style={styles.errorContent}>
          <View style={styles.errorHeader}>
            <DoyaLogo size={64} />
            <Text style={styles.title}>{translateNow("ui.something.went.wrong.h3jr53")}</Text>
          </View>

          <Text style={styles.errorDescription}>
            {translateNow("ui.the.local.server.failed.to.start.if.fs6dqk")}
          </Text>

          <Text dataSet={CODE_SURFACE_DATASET} style={styles.errorMessage}>
            {bootstrapState.splashError}
          </Text>

          {daemonLogs?.logPath ? <Text style={styles.logsMeta}>{daemonLogs.logPath}</Text> : null}

          <View style={styles.logsContainer}>
            <ScrollView
              style={logsScrollStyle}
              contentContainerStyle={styles.logsContent}
              showsVerticalScrollIndicator
            >
              <Text dataSet={CODE_SURFACE_DATASET} selectable style={styles.logsText}>
                {logsText}
              </Text>
            </ScrollView>
          </View>

          <View style={styles.actionRow}>
            <Button variant="secondary" leftIcon={copyIcon} onPress={handleCopyLogs}>
              {translateNow("ui.copy.logs.1l2rqze")}
            </Button>
            <Button variant="outline" leftIcon={warningIcon} onPress={openGithubIssue}>
              {translateNow("ui.open.github.issue.wdw3te")}
            </Button>
            <Button variant="outline" leftIcon={bookIcon} onPress={openDocs}>
              {translateNow("ui.docs.19rvf")}
            </Button>
            <Button variant="default" leftIcon={retryIcon} onPress={bootstrapState.retry}>
              {translateNow("ui.retry.1ay360")}
            </Button>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
