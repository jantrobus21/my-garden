import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Plant } from "@/src/api";
import { colors, radius, spacing, statusMeta } from "@/src/theme";

function relTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export default function HistoryTab() {
  const router = useRouter();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const p = await api.listPlants();
      setPlants(p);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = setInterval(load, 0);
    clearInterval(unsub);
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="history-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>Recent updates across your garden</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : plants.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="time-outline" size={48} color={colors.borderStrong} />
          <Text style={styles.emptyText}>No activity yet. Add and scan plants to see updates here.</Text>
        </View>
      ) : (
        <FlatList
          data={plants}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120, gap: spacing.sm }}
          renderItem={({ item }) => {
            const meta = statusMeta[item.status] || statusMeta.healthy;
            return (
              <Pressable
                testID={`activity-row-${item.id}`}
                onPress={() => router.push(`/plant/${item.id}`)}
                style={styles.row}
              >
                <View style={[styles.dot, { backgroundColor: meta.bg }]}>
                  <Ionicons
                    name={
                      item.status === "thirsty"
                        ? "water"
                        : item.status === "needs_fertilizer"
                        ? "nutrition"
                        : item.status === "issue"
                        ? "warning"
                        : "checkmark-circle"
                    }
                    size={18}
                    color={meta.fg}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.rowTime}>{relTime(item.created_at)}</Text>
                  </View>
                  <Text style={styles.rowDetail} numberOfLines={2}>
                    {item.latest_summary || meta.label}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.onSurfaceSecondary, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowName: { fontSize: 15, fontWeight: "700", color: colors.onSurface, flex: 1 },
  rowTime: { fontSize: 12, color: colors.onSurfaceSecondary },
  rowDetail: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 2 },
});
