import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type DocumentViewerKind = "pdf" | "docx" | "pptx" | "csv" | "xlsx";

export interface DocumentViewerProps {
  kind: DocumentViewerKind;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

export function DocumentViewer({ fileName }: DocumentViewerProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{fileName}</Text>
      <Text style={styles.message}>Document preview is available on web and desktop.</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    marginBottom: theme.spacing[2],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
