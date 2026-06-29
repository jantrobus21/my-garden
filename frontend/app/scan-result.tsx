import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { api, HealthAnalysis, Plant } from "@/src/api";
import { colors, radius, spacing, statusMeta } from "@/src/theme";

type Mode = "health" | "meter" | "qr_unknown";

type MeterData = {
  moisture: number | null;
  fertility: number | null;
  ph: number | null;
  light: number | null;
};

export default function ScanResult() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode: string; image_base64?: string; qr?: string; plantId?: string }>();
  const mode = (params.mode || "health") as Mode;
  const imageB64 = typeof params.image_base64 === "string" ? params.image_base64 : "";
  const qr = typeof params.qr === "string" ? params.qr : "";

  const [analysis, setAnalysis] = useState<HealthAnalysis | null>(null);
  const [meter, setMeter] = useState<MeterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [chosenPlant, setChosenPlant] = useState<string | null>(typeof params.plantId === "string" ? params.plantId : null);
  const [saving, setSaving] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "health") {
        const a = await api.analyzeHealth(imageB64);
        setAnalysis(a);
      } else if (mode === "meter") {
        const m = await api.analyzeMeter(imageB64);
        setMeter({ moisture: m.moisture, fertility: m.fertility, ph: m.ph, light: m.light });
      }
      const list = await api.listPlants();
      setPlants(list);
    } catch (e: any) {
      setError(e?.message || "AI analysis failed");
    } finally {
      setLoading(false);
    }
  }, [mode, imageB64]);

  useEffect(() => {
    if (mode === "qr_unknown") {
      setLoading(false);
      return;
    }
    run();
  }, [run, mode]);

  const saveResult = useCallback(async () => {
    if (!chosenPlant) return;
    setSaving(true);
    try {
      if (mode === "health" && analysis) {
        await api.analyzeHealth(imageB64, chosenPlant);
      } else if (mode === "meter" && meter) {
        await api.createReading({
          plant_id: chosenPlant,
          moisture: meter.moisture ?? undefined,
          fertility: meter.fertility ?? undefined,
          ph: meter.ph ?? undefined,
          light: meter.light ?? undefined,
          source: "ai",
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/plant/${chosenPlant}`);
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }, [chosenPlant, analysis, meter, mode, imageB64, router]);

  return (
    <SafeAreaView style={styles.container} testID="scan-result-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn} testID="scan-result-close">
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {mode === "health" ? "Health Analysis" : mode === "meter" ? "Meter Reading" : "QR Tag"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 160 }}>
        {imageB64 ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${imageB64}` }}
            style={styles.preview}
            contentFit="cover"
          />
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
            <Text style={styles.loadingText}>Analyzing image…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={24} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
            {mode !== "qr_unknown" && (
              <Pressable onPress={run} style={styles.retryBtn} testID="retry-button">
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            )}
          </View>
        ) : mode === "qr_unknown" ? (
          <View style={styles.unknownBox}>
            <Ionicons name="help-circle" size={32} color={colors.warning} />
            <Text style={styles.unknownTitle}>Unknown tag</Text>
            <Text style={styles.unknownText}>Scanned code: <Text style={{ fontWeight: "700" }}>{qr}</Text></Text>
            <Text style={styles.unknownText}>No plant is registered with this tag yet. Add a plant and set this code as its tag.</Text>
          </View>
        ) : mode === "health" && analysis ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.statusBig, { backgroundColor: (statusMeta[analysis.status] || statusMeta.healthy).bg }]}>
              <Text style={[styles.statusBigText, { color: (statusMeta[analysis.status] || statusMeta.healthy).fg }]}>
                {(statusMeta[analysis.status] || statusMeta.healthy).label}
              </Text>
            </View>
            {analysis.recommendation ? (
              <View style={styles.adviceCard}>
                <Text style={styles.adviceTitle}>Recommendation</Text>
                <Text style={styles.adviceBody}>{analysis.recommendation}</Text>
              </View>
            ) : null}
            <View style={styles.actionsRow}>
              <FlagPill label="Needs Water" on={analysis.needs_water} icon="water" />
              <FlagPill label="Needs Feed" on={analysis.needs_fertilizer} icon="nutrition" />
            </View>
            {analysis.issues?.length ? (
              <View style={styles.adviceCard}>
                <Text style={styles.adviceTitle}>Issues</Text>
                {analysis.issues.map((iss, i) => (
                  <Text key={i} style={styles.issueRow}>•  {iss}</Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : mode === "meter" && meter ? (
          <View style={styles.meterGrid}>
            <BigMetric label="Moisture" value={meter.moisture} unit="%" />
            <BigMetric label="Fertility" value={meter.fertility} unit="%" />
            <BigMetric label="pH" value={meter.ph} unit="" />
            <BigMetric label="Light" value={meter.light} unit="%" />
          </View>
        ) : null}

        {!loading && !error && mode !== "qr_unknown" ? (
          <View style={styles.assignBox}>
            <Text style={styles.assignTitle}>Save to plant</Text>
            {plants.length === 0 ? (
              <Text style={styles.assignEmpty}>Add a plant first to save this reading.</Text>
            ) : (
              <View style={styles.plantPicker}>
                {plants.map((p) => (
                  <Pressable
                    key={p.id}
                    testID={`assign-plant-${p.id}`}
                    onPress={() => setChosenPlant(p.id)}
                    style={[styles.plantPill, chosenPlant === p.id && styles.plantPillActive]}
                  >
                    <Text style={[styles.plantPillText, chosenPlant === p.id && styles.plantPillTextActive]}>
                      {p.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>

      {!loading && !error && mode !== "qr_unknown" ? (
        <View style={styles.footer}>
          <Pressable
            testID="save-result-button"
            onPress={saveResult}
            disabled={!chosenPlant || saving}
            style={[styles.saveBtn, (!chosenPlant || saving) && { opacity: 0.5 }]}
          >
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save to Plant</Text>}
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function BigMetric({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <View style={styles.bigMetric}>
      <Text style={styles.bigMetricValue}>
        {value == null ? "—" : `${value.toFixed(unit === "" ? 1 : 0)}${unit}`}
      </Text>
      <Text style={styles.bigMetricLabel}>{label}</Text>
    </View>
  );
}

function FlagPill({ label, on, icon }: { label: string; on: boolean; icon: any }) {
  return (
    <View style={[styles.flagPill, { backgroundColor: on ? statusMeta.thirsty.bg : colors.surfaceTertiary }]}>
      <Ionicons name={icon} size={16} color={on ? statusMeta.thirsty.fg : colors.onSurfaceSecondary} />
      <Text style={[styles.flagText, { color: on ? statusMeta.thirsty.fg : colors.onSurfaceSecondary }]}>
        {on ? `${label}: yes` : `${label}: no`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  preview: { width: "100%", height: 200, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary },
  center: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  loadingText: { color: colors.onSurfaceSecondary, fontSize: 14 },
  errorBox: {
    alignItems: "center", gap: spacing.sm,
    backgroundColor: "#F8E4E4", padding: spacing.lg, borderRadius: radius.md,
  },
  errorText: { color: colors.error, textAlign: "center" },
  retryBtn: { backgroundColor: colors.error, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  retryText: { color: colors.onError, fontWeight: "700" },
  unknownBox: { backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md, gap: spacing.sm, alignItems: "center" },
  unknownTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  unknownText: { color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  statusBig: { alignSelf: "flex-start", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  statusBigText: { fontSize: 16, fontWeight: "700" },
  adviceCard: { backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 6 },
  adviceTitle: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  adviceBody: { color: colors.onSurface, fontSize: 15, lineHeight: 22 },
  issueRow: { color: colors.onSurface, fontSize: 14, lineHeight: 22 },
  actionsRow: { flexDirection: "row", gap: spacing.sm },
  flagPill: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
  },
  flagText: { fontSize: 13, fontWeight: "600" },
  meterGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  bigMetric: {
    width: "48%", backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, alignItems: "center",
  },
  bigMetricValue: { fontSize: 32, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  bigMetricLabel: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: "600", marginTop: 4 },
  assignBox: { gap: spacing.sm },
  assignTitle: { fontSize: 13, fontWeight: "700", color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  assignEmpty: { color: colors.onSurfaceSecondary, fontSize: 13 },
  plantPicker: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  plantPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  plantPillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  plantPillText: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  plantPillTextActive: { color: colors.onBrandPrimary },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: spacing.lg, backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 16 },
});
