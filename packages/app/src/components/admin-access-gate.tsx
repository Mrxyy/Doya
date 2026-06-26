import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import { useI18n } from "@/i18n/i18n";
import { KeyRound } from "@/components/icons/lucide";

const DEFAULT_ADMIN_PASSWORD = "123789xyy";
const ADMIN_SESSION_UNLOCKED_KEY = "doya.admin.unlocked";

export function AdminAccessGate({
  children,
  onUnlock,
}: {
  children: ReactNode;
  onUnlock?: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!readAdminSessionUnlocked()) {
      return;
    }
    setIsUnlocked(true);
    onUnlock?.();
  }, [onUnlock]);

  const handleUnlock = useCallback(() => {
    if (password === DEFAULT_ADMIN_PASSWORD) {
      writeAdminSessionUnlocked();
      setIsUnlocked(true);
      setHasError(false);
      onUnlock?.();
      return;
    }
    setHasError(true);
  }, [onUnlock, password]);

  if (isUnlocked) {
    return <>{children}</>;
  }

  return (
    <View style={styles.shell}>
      <View style={styles.card}>
        <View style={styles.iconBadge}>
          <KeyRound size={22} color={styles.iconColor.color} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{t("admin.access.title")}</Text>
          <Text style={styles.hint}>{t("admin.access.description")}</Text>
        </View>
        <TextInput
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleUnlock}
          placeholder={t("admin.access.passwordPlaceholder")}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={hasError ? styles.inputError : styles.input}
          accessibilityLabel={t("admin.access.passwordPlaceholder")}
        />
        {hasError ? <Text style={styles.errorText}>{t("admin.access.error")}</Text> : null}
        <Button variant="default" size="md" onPress={handleUnlock}>
          {t("admin.access.unlock")}
        </Button>
      </View>
    </View>
  );
}

function readAdminSessionUnlocked(): boolean {
  if (!isWeb || typeof window === "undefined") {
    return false;
  }
  return window.sessionStorage.getItem(ADMIN_SESSION_UNLOCKED_KEY) === "1";
}

function writeAdminSessionUnlocked() {
  if (!isWeb || typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(ADMIN_SESSION_UNLOCKED_KEY, "1");
}

const styles = StyleSheet.create((theme) => ({
  shell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[6],
  },
  iconBadge: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface3,
  },
  iconColor: {
    color: theme.colors.foreground,
  },
  copy: {
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingHorizontal: theme.spacing[3],
  },
  inputError: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingHorizontal: theme.spacing[3],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
