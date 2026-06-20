import { useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";

type StatusBadgeVariant = "success" | "error" | "muted";

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
}

export function StatusBadge({ label, variant = "muted" }: StatusBadgeProps) {
  const pillStyle = useMemo(
    () => [
      styles.pill,
      variant === "success" && styles.pillSuccess,
      variant === "error" && styles.pillError,
    ],
    [variant],
  );
  const dotStyle = useMemo(
    () => [
      styles.dot,
      variant === "success" && styles.dotSuccess,
      variant === "error" && styles.dotError,
    ],
    [variant],
  );
  const textStyle = useMemo(
    () => [
      styles.pillText,
      variant === "success" && styles.pillTextSuccess,
      variant === "error" && styles.pillTextError,
    ],
    [variant],
  );

  return (
    <View style={pillStyle}>
      <View style={dotStyle} />
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 24,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    backgroundColor: "#f6f7f9",
    paddingHorizontal: theme.spacing[2],
  },
  pillSuccess: {
    backgroundColor: "#edf9f2",
    borderColor: "#bfe9d1",
  },
  pillError: {
    backgroundColor: "#fff5f3",
    borderColor: "#f1c7c3",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 6,
    backgroundColor: "#8a929f",
  },
  dotSuccess: {
    backgroundColor: "#19a66a",
  },
  dotError: {
    backgroundColor: "#d84f45",
  },
  pillText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: "#5f6875",
  },
  pillTextSuccess: {
    color: "#167a4a",
  },
  pillTextError: {
    color: "#b13b33",
  },
}));
