import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";

type Mode = "health" | "meter" | "qr";

export default function ScanHub() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("health");
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [qrLocked, setQrLocked] = useState(false);

  const pickAndAnalyze = useCallback(
    async (source: "camera" | "library") => {
      if (busy) return;
      try {
        if (source === "camera") {
          const camPerm = await ImagePicker.requestCameraPermissionsAsync();
          if (!camPerm.granted) return;
        }
        const result =
          source === "camera"
            ? await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                base64: true,
                quality: 0.6,
                allowsEditing: false,
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                base64: true,
                quality: 0.6,
              });

        if (result.canceled || !result.assets?.[0]?.base64) return;
        const b64 = result.assets[0].base64!;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setBusy(true);
        router.push({
          pathname: "/scan-result",
          params: { mode, image_base64: b64 },
        });
      } finally {
        setBusy(false);
      }
    },
    [mode, router, busy]
  );

  const handleQr = useCallback(
    async (data: string) => {
      if (qrLocked) return;
      setQrLocked(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      try {
        const plant = await api.getPlantByQr(data);
        router.push(`/plant/${plant.id}`);
      } catch {
        router.push({ pathname: "/scan-result", params: { mode: "qr_unknown", qr: data } });
      }
      setTimeout(() => setQrLocked(false), 1500);
    },
    [qrLocked, router]
  );

  const canUseCamera = Platform.OS !== "web";
  const showQrCamera = mode === "qr" && canUseCamera && permission?.granted;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="scan-hub-screen">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Scan</Text>
        <Text style={styles.subtitle}>Capture health, meter, or QR tag</Text>
      </View>

      <View style={styles.modeRow}>
        {(["health", "meter", "qr"] as Mode[]).map((m) => (
          <Pressable
            key={m}
            testID={`mode-${m}`}
            style={[styles.modeChip, mode === m && styles.modeChipActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setMode(m);
            }}
          >
            <Ionicons
              name={m === "health" ? "leaf-outline" : m === "meter" ? "speedometer-outline" : "qr-code-outline"}
              size={16}
              color={mode === m ? colors.onBrandPrimary : colors.onSurfaceSecondary}
            />
            <Text style={[styles.modeChipText, mode === m && styles.modeChipTextActive]}>
              {m === "health" ? "Plant Health" : m === "meter" ? "Meter" : "QR Tag"}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.viewfinderWrap}>
        {showQrCamera ? (
          <CameraView
            testID="qr-camera-view"
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(e) => handleQr(e.data)}
          />
        ) : (
          <View style={styles.viewfinderPlaceholder}>
            <Ionicons
              name={mode === "health" ? "leaf" : mode === "meter" ? "speedometer" : "qr-code"}
              size={72}
              color={colors.brandPrimary}
            />
            <Text style={styles.placeholderText}>
              {mode === "health"
                ? "Snap a photo of your plant. AI will tell you what it needs."
                : mode === "meter"
                ? "Photograph your soil meter. AI reads moisture, fertility, pH."
                : permission?.granted
                ? "Point camera at a plant QR tag"
                : "Allow camera to scan QR tags"}
            </Text>
            {mode === "qr" && !permission?.granted ? (
              <Pressable testID="qr-permission-button" onPress={requestPermission} style={styles.permBtn}>
                <Text style={styles.permBtnText}>Enable Camera</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        <View style={styles.viewfinderFrame} pointerEvents="none" />
      </View>

      {mode !== "qr" ? (
        <View style={styles.actionRow}>
          <Pressable
            testID="capture-from-library"
            onPress={() => pickAndAnalyze("library")}
            style={[styles.actionBtn, styles.actionSecondary]}
          >
            <Ionicons name="images-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.actionSecondaryText}>Library</Text>
          </Pressable>
          <Pressable
            testID="capture-button"
            onPress={() => pickAndAnalyze("camera")}
            disabled={busy}
            style={[styles.actionBtn, styles.actionPrimary]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Ionicons name="camera" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.actionPrimaryText}>Capture</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <Text style={styles.qrHint}>
            {showQrCamera ? "Aim at QR tag — it scans automatically" : "Camera permission required for QR scanning"}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  headerRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.onSurfaceSecondary, marginTop: 2 },
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  modeChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  modeChipText: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  modeChipTextActive: { color: colors.onBrandPrimary },
  viewfinderWrap: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceInverse,
    aspectRatio: 0.85,
    marginBottom: spacing.lg,
  },
  viewfinderPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.surfaceInverse,
  },
  placeholderText: {
    color: colors.onSurfaceInverse,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.85,
  },
  viewfinderFrame: {
    position: "absolute",
    top: "15%",
    left: "10%",
    right: "10%",
    bottom: "15%",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
    borderRadius: radius.md,
  },
  permBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  permBtnText: { color: colors.onBrandPrimary, fontWeight: "700" },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  actionPrimary: { flex: 2, backgroundColor: colors.brandPrimary },
  actionPrimaryText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 15 },
  actionSecondary: { flex: 1, backgroundColor: colors.brandSecondary },
  actionSecondaryText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: 15 },
  qrHint: {
    flex: 1,
    textAlign: "center",
    color: colors.onSurfaceSecondary,
    fontSize: 13,
  },
});
