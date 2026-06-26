import { useCallback, type ReactNode } from "react";
import { Pressable } from "react-native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { translateNow } from "@/i18n/i18n";
import { ArrowLeft } from "@/components/icons/lucide";

interface BackHeaderProps {
  title?: string;
  titleAccessory?: ReactNode;
  rightContent?: ReactNode;
  onBack?: () => void;
}

function goBack(): void {
  router.back();
}

export function BackHeader({ title, titleAccessory, rightContent, onBack }: BackHeaderProps) {
  const { theme } = useUnistyles();
  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    goBack();
  }, [onBack]);

  return (
    <ScreenHeader
      left={
        <>
          <Pressable
            onPress={handleBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={translateNow("ui.back.187if")}
          >
            <ArrowLeft size={theme.iconSize.lg} color={theme.colors.foregroundMuted} />
          </Pressable>
          {title && <ScreenTitle>{title}</ScreenTitle>}
          {titleAccessory}
        </>
      }
      right={rightContent}
      leftStyle={styles.left}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  left: {
    gap: theme.spacing[2],
  },
  backButton: {
    padding: {
      xs: theme.spacing[3],
      md: theme.spacing[2],
    },
    borderRadius: theme.borderRadius.lg,
  },
}));
