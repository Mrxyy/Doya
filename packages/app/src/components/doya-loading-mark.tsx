import { useEffect, useMemo } from "react";
import { View } from "react-native";
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
import { StyleSheet } from "react-native-unistyles";

const LOGO_SIZE = 96;
const LOGO_GROWTH_DURATION_MS = 1800;
const LOGO_GROWTH_PAUSE_MS = 450;
const DOYA_LOGO_COLORS = {
  stem: "#2E7D42",
  leftLeaf: "#43C463",
  rightLeaf: "#9BDB45",
  seed: "#D0A13A",
} as const;

export function DoyaLoadingMark() {
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

  const seedCombinedStyle = useMemo(() => [styles.layer, seedStyle], [seedStyle]);
  const stemCombinedStyle = useMemo(() => [styles.layer, stemStyle], [stemStyle]);
  const leftLeafCombinedStyle = useMemo(() => [styles.layer, leftLeafStyle], [leftLeafStyle]);
  const rightLeafCombinedStyle = useMemo(() => [styles.layer, rightLeafStyle], [rightLeafStyle]);

  return (
    <View style={styles.container}>
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

const styles = StyleSheet.create(() => ({
  container: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
}));
