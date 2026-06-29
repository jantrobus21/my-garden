import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
};

export default function QrScannerModal({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (visible) setLocked(false);
  }, [visible]);

  const handle = (data: string) => {
    if (locked || !data) return;
    setLocked(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onScanned(data);
  };

  const canUse = Platform.OS !== "web";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container} testID="qr-scanner-modal">
        {canUse && permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(e) => handle(e.data)}
          />
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="qr-code-outline" size={72} color={colors.brandPrimary} />
            <Text style={styles.fallbackTitle}>
              {canUse ? "Camera permission needed" : "QR scanning works on a real device"}
            </Text>
            <Text style={styles.fallbackBody}>
              {canUse
                ? "Allow camera to scan the QR code on your 3D-printed plant tag."
                : "Open this app on iOS or Android (Expo Go or a build) to scan tags. You can still type the QR code manually."}
            </Text>
            {canUse && !permission?.granted ? (
              <Pressable testID="qr-grant-permission" onPress={requestPermission} style={styles.grantBtn}>
                <Text style={styles.grantText}>Enable Camera</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={styles.frame} pointerEvents="none">
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        <View style={styles.top}>
          <Pressable onPress={onClose} style={styles.closeBtn} testID="qr-scanner-close">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.topTitle}>Scan plant tag</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.bottom}>
          <Text style={styles.bottomHint}>
            Align the QR code on your 3D-printed tag inside the frame
          </Text>
          {locked ? (
            <View style={styles.lockedRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.lockedText}>Captured</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInverse,
    padding: spacing.xl,
    gap: spacing.md,
  },
  fallbackTitle: { color: colors.onSurfaceInverse, fontSize: 18, fontWeight: "700", textAlign: "center" },
  fallbackBody: { color: "rgba(240,244,238,0.8)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  grantBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  grantText: { color: colors.onBrandPrimary, fontWeight: "700" },
  top: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    paddingTop: 56, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)" },
  topTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  frame: {
    position: "absolute",
    top: "28%", left: "12%", right: "12%", height: 260,
  },
  corner: { position: "absolute", width: 28, height: 28, borderColor: "#fff" },
  cornerTL: { top: 0, left: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 6 },
  bottom: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: 48,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    gap: spacing.sm,
  },
  bottomHint: { color: "rgba(255,255,255,0.85)", textAlign: "center", fontSize: 13, lineHeight: 19 },
  lockedRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  lockedText: { color: "#fff", fontWeight: "600" },
});
