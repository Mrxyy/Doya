import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";
import { isNative } from "@/constants/platform";
import { translateNow } from "@/i18n/i18n";
import { ClipboardPaste, Link2, QrCode } from "@/components/icons/lucide";

const ADD_CONNECTION_HEADER: SheetHeader = { title: translateNow("ui.add.connection.1vro999") };

const styles = StyleSheet.create((theme) => ({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  optionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  optionSubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  optionBody: {
    flex: 1,
  },
}));

export interface AddHostMethodModalProps {
  visible: boolean;
  onClose: () => void;
  onDirectConnection: () => void;
  onScanQr: () => void;
  onPasteLink: () => void;
}

export function AddHostMethodModal({
  visible,
  onClose,
  onDirectConnection,
  onScanQr,
  onPasteLink,
}: AddHostMethodModalProps) {
  const { theme } = useUnistyles();

  const handleDirect = useCallback(() => {
    onDirectConnection();
  }, [onDirectConnection]);

  const handleScan = useCallback(() => {
    onScanQr();
  }, [onScanQr]);

  const handlePaste = useCallback(() => {
    onPasteLink();
  }, [onPasteLink]);

  return (
    <AdaptiveModalSheet
      header={ADD_CONNECTION_HEADER}
      visible={visible}
      onClose={onClose}
      testID="add-host-method-modal"
    >
      <Pressable
        style={styles.option}
        onPress={handleDirect}
        accessibilityRole="button"
        accessibilityLabel={translateNow("ui.direct.connection.g05fth")}
        testID="add-host-method-direct"
      >
        <Link2 size={18} color={theme.colors.foreground} />
        <View style={styles.optionBody}>
          <Text style={styles.optionText}>{translateNow("ui.direct.connection.g05fth")}</Text>
          <Text style={styles.optionSubtext}>
            {translateNow("ui.local.network.or.vpn.1keeii8")}
          </Text>
        </View>
      </Pressable>

      {isNative ? (
        <Pressable
          style={styles.option}
          onPress={handleScan}
          accessibilityRole="button"
          accessibilityLabel={translateNow("ui.scan.qr.code.185k4qx")}
        >
          <QrCode size={18} color={theme.colors.foreground} />
          <View style={styles.optionBody}>
            <Text style={styles.optionText}>{translateNow("ui.scan.qr.code.185k4qx")}</Text>
            <Text style={styles.optionSubtext}>
              {translateNow("ui.encrypted.relay.connection.w9951")}
            </Text>
          </View>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.option}
        onPress={handlePaste}
        accessibilityRole="button"
        accessibilityLabel={translateNow("ui.paste.pairing.link.1yypom7")}
        testID="add-host-method-pair-link"
      >
        <ClipboardPaste size={18} color={theme.colors.foreground} />
        <View style={styles.optionBody}>
          <Text style={styles.optionText}>{translateNow("ui.paste.pairing.link.1yypom7")}</Text>
          <Text style={styles.optionSubtext}>
            {translateNow("ui.encrypted.relay.connection.w9951")}
          </Text>
        </View>
      </Pressable>
    </AdaptiveModalSheet>
  );
}
