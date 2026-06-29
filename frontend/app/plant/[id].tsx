import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, HealthAnalysis, Plant, Reading } from "@/src/api";
import { colors, radius, spacing, statusMeta } from "@/src/theme";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1614594975525-e45190c55d0b?crop=entropy&cs=srgb&fm=jpg&w=900&q=80";

export default function PlantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [plant, setPlant] = useState<Plant | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [analyses, setAnalyses] = useState<HealthAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, r, a] = await Promise.all([
        api.getPlant(id),
        api.listReadings(id),
        api.listAnalyses(id),
      ]);
      setPlant(p);
      setReadings(r);
      setAnalyses(a);
    } catch (e) {
      console.warn("plant detail load", e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !plant) {
    return (
      <View style={[styles.center, { flex: 1, backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  const photo = plant.photo_base64
    ? plant.photo_base64.startsWith("data:") ? plant.photo_base64 : `data:image/jpeg;base64,${plant.photo_base64}`
    : FALLBACK_IMG;
  const meta = statusMeta[plant.status] || statusMeta.healthy;
  const latest = readings[0];

  const handleDelete = () => {
    Alert.alert("Delete plant?", `${plant.name} and all its history will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await api.deletePlant(plant.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="plant-detail-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={styles.heroWrap}>
          <Image source={{ uri: photo }} style={styles.heroImage} contentFit="cover" />
          <LinearGradient
            colors={["transparent", "rgba(35,42,37,0.85)"]}
            locations={[0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.heroTop, { paddingTop: insets.top + 8 }]}>
            <Pressable testID="back-button" onPress={() => router.back()} style={styles.iconBtn}>
              <Ionicons name="chevron-back" size={22} color={colors.onSurfaceInverse} />
            </Pressable>
            <Pressable testID="delete-plant-button" onPress={handleDelete} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={20} color={colors.onSurfaceInverse} />
            </Pressable>
          </View>
          <View style={styles.heroBottom}>
            <View style={[styles.statusChip, { backgroundColor: meta.bg }]}>
              <Text style={[styles.statusChipText, { color: meta.fg }]}>{meta.label}</Text>
            </View>
            <Text style={styles.heroTitle}>{plant.name}</Text>
            {plant.species ? <Text style={styles.heroSubtitle}>{plant.species}</Text> : null}
            {plant.location ? (
              <Text style={styles.heroLocation}>
                <Ionicons name="location-outline" size={12} /> {plant.location}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.qrCard}>
            <View>
              <Text style={styles.qrLabel}>Plant Tag</Text>
              <Text style={styles.qrCode} testID="plant-qr-code">{plant.qr_code}</Text>
            </View>
            <Ionicons name="qr-code" size={36} color={colors.brandPrimary} />
          </View>

          <Text style={styles.sectionTitle}>Latest Readings</Text>
          <View style={styles.metricGrid}>
            <Metric label="Moisture" value={latest?.moisture} unit="%" icon="water-outline" />
            <Metric label="Fertility" value={latest?.fertility} unit="%" icon="leaf-outline" />
            <Metric label="pH" value={latest?.ph} unit="" icon="flask-outline" />
            <Metric label="Light" value={latest?.light} unit="%" icon="sunny-outline" />
          </View>

          <Text style={styles.sectionTitle}>Timeline</Text>
          {analyses.length === 0 && readings.length === 0 ? (
            <Text style={styles.empty}>No history yet. Scan the meter or take a health photo.</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {analyses.map((a) => (
                <View key={a.id} style={styles.timelineCard} testID={`analysis-${a.id}`}>
                  <View style={styles.timelineHeader}>
                    <View style={[styles.tlBadge, { backgroundColor: (statusMeta[a.status] || statusMeta.healthy).bg }]}>
                      <Text style={[styles.tlBadgeText, { color: (statusMeta[a.status] || statusMeta.healthy).fg }]}>
                        AI · {(statusMeta[a.status] || statusMeta.healthy).label}
                      </Text>
                    </View>
                    <Text style={styles.tlTime}>{new Date(a.created_at).toLocaleString()}</Text>
                  </View>
                  {a.recommendation ? <Text style={styles.tlBody}>{a.recommendation}</Text> : null}
                  {a.issues?.length ? (
                    <View style={styles.issueList}>
                      {a.issues.map((iss, i) => (
                        <Text key={i} style={styles.issueChip}>• {iss}</Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
              {readings.map((r) => (
                <View key={r.id} style={styles.timelineCard} testID={`reading-${r.id}`}>
                  <View style={styles.timelineHeader}>
                    <View style={[styles.tlBadge, { backgroundColor: colors.brandTertiary }]}>
                      <Text style={[styles.tlBadgeText, { color: colors.onBrandTertiary }]}>
                        {r.source === "ai" ? "Meter · AI" : "Meter · Manual"}
                      </Text>
                    </View>
                    <Text style={styles.tlTime}>{new Date(r.created_at).toLocaleString()}</Text>
                  </View>
                  <Text style={styles.tlBody}>
                    {r.moisture != null ? `Moisture ${r.moisture.toFixed(0)}%  ·  ` : ""}
                    {r.fertility != null ? `Fertility ${r.fertility.toFixed(0)}%  ·  ` : ""}
                    {r.ph != null ? `pH ${r.ph.toFixed(1)}  ·  ` : ""}
                    {r.light != null ? `Light ${r.light.toFixed(0)}%` : ""}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          testID="log-reading-button"
          onPress={() =>
            router.push({ pathname: "/(tabs)/scan", params: { plantId: plant.id } })
          }
          style={styles.cta}
        >
          <Ionicons name="add-circle" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.ctaText}>Log New Reading</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Metric({ label, value, unit, icon }: { label: string; value: number | null | undefined; unit: string; icon: any }) {
  const display = value == null ? "—" : `${value.toFixed(unit === "" ? 1 : 0)}${unit}`;
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={18} color={colors.brandPrimary} />
      <Text style={styles.metricValue}>{display}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  heroWrap: { width: "100%", height: 360, backgroundColor: colors.surfaceTertiary },
  heroImage: { ...StyleSheet.absoluteFillObject },
  heroTop: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  heroBottom: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg, gap: spacing.xs },
  statusChip: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginBottom: 4 },
  statusChipText: { fontSize: 11, fontWeight: "700" },
  heroTitle: { fontSize: 30, fontWeight: "700", color: colors.onSurfaceInverse, letterSpacing: -0.5 },
  heroSubtitle: { fontSize: 14, color: "rgba(240,244,238,0.85)" },
  heroLocation: { fontSize: 12, color: "rgba(240,244,238,0.7)", marginTop: 2 },

  body: { padding: spacing.lg, gap: spacing.md },
  qrCard: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  qrLabel: { fontSize: 12, color: colors.onSurfaceSecondary, marginBottom: 4 },
  qrCode: { fontSize: 18, fontWeight: "700", color: colors.onSurface, letterSpacing: 1 },

  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface, marginTop: spacing.sm },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metricCard: {
    width: "48%",
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    gap: 6,
  },
  metricValue: { fontSize: 26, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  metricLabel: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: "600" },

  empty: { color: colors.onSurfaceSecondary, fontSize: 14, paddingVertical: spacing.md },
  timelineCard: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    gap: 6,
  },
  timelineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tlBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  tlBadgeText: { fontSize: 11, fontWeight: "700" },
  tlTime: { fontSize: 11, color: colors.onSurfaceSecondary },
  tlBody: { fontSize: 13, color: colors.onSurface, lineHeight: 19 },
  issueList: { gap: 2 },
  issueChip: { fontSize: 12, color: colors.onSurfaceSecondary },

  ctaBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    backgroundColor: "rgba(249,250,247,0.95)",
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.pill,
  },
  ctaText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "700" },
});
