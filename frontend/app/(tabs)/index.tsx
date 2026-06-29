import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { api, Plant } from "@/src/api";
import { colors, radius, spacing, statusMeta } from "@/src/theme";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1614594975525-e45190c55d0b?crop=entropy&cs=srgb&fm=jpg&w=600&q=80";

export default function Dashboard() {
  const router = useRouter();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<{ needs_water: number; needs_fertilizer: number; issues: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.listPlants(), api.summary()]);
      setPlants(p);
      setSummary(s);
    } catch (e) {
      console.warn("load failed", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
  }, [load]);

  const onAdd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/add-plant");
  };

  const renderItem = ({ item }: { item: Plant }) => {
    const meta = statusMeta[item.status] || statusMeta.healthy;
    const photo = item.photo_base64
      ? (item.photo_base64.startsWith("data:") ? item.photo_base64 : `data:image/jpeg;base64,${item.photo_base64}`)
      : FALLBACK_IMG;
    return (
      <Pressable
        testID={`plant-card-${item.id}`}
        onPress={() => {
          Haptics.selectionAsync();
          router.push(`/plant/${item.id}`);
        }}
        style={styles.card}
      >
        <Image source={{ uri: photo }} style={styles.cardImage} contentFit="cover" transition={200} />
        <LinearGradient
          colors={["transparent", "rgba(35,42,37,0.85)"]}
          style={StyleSheet.absoluteFill}
          locations={[0.4, 1]}
        />
        <View style={[styles.statusChip, { backgroundColor: meta.bg }]}>
          <Text style={[styles.statusChipText, { color: meta.fg }]}>{meta.label}</Text>
        </View>
        <View style={styles.cardFooter}>
          {item.plant_number ? (
            <Text style={styles.cardNumber}>{item.plant_number}</Text>
          ) : null}
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          {item.species ? <Text style={styles.cardSubtitle} numberOfLines={1}>{item.species}</Text> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="dashboard-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>My Garden</Text>
          <Text style={styles.subgreeting}>
            {summary
              ? `${summary.total} plant${summary.total === 1 ? "" : "s"} tracked`
              : "Loading…"}
          </Text>
        </View>
        <Pressable testID="add-plant-button" onPress={onAdd} style={styles.addBtn}>
          <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      {summary && summary.total > 0 ? (
        <View style={styles.summaryRow}>
          <SummaryBadge label="Thirsty" value={summary.needs_water} color={statusMeta.thirsty.bg} fg={statusMeta.thirsty.fg} />
          <SummaryBadge label="Feed" value={summary.needs_fertilizer} color={statusMeta.needs_fertilizer.bg} fg={statusMeta.needs_fertilizer.fg} />
          <SummaryBadge label="Issues" value={summary.issues} color={statusMeta.issue.bg} fg={statusMeta.issue.fg} />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : plants.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="leaf" size={48} color={colors.brandPrimary} />
          </View>
          <Text style={styles.emptyTitle}>Your greenhouse is empty</Text>
          <Text style={styles.emptyBody}>Add a plant to start tracking moisture, fertility, and health.</Text>
          <Pressable testID="empty-add-plant-button" onPress={onAdd} style={styles.emptyCta}>
            <Text style={styles.emptyCtaText}>Add First Plant</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={plants}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: 120, paddingTop: spacing.sm }}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.brandPrimary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function SummaryBadge({ label, value, color, fg }: { label: string; value: number; color: string; fg: string }) {
  return (
    <View style={[styles.summaryBadge, { backgroundColor: color }]}>
      <Text style={[styles.summaryBadgeValue, { color: fg }]}>{value}</Text>
      <Text style={[styles.summaryBadgeLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  greeting: { fontSize: 28, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subgreeting: { fontSize: 14, color: colors.onSurfaceSecondary, marginTop: 2 },
  addBtn: {
    width: 44, height: 44, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  summaryRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  summaryBadge: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  summaryBadgeValue: { fontSize: 22, fontWeight: "700" },
  summaryBadgeLabel: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  card: {
    flex: 1,
    aspectRatio: 0.78,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceTertiary,
  },
  cardImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  cardFooter: { position: "absolute", left: 12, right: 12, bottom: 12 },
  cardNumber: { color: "rgba(240,244,238,0.85)", fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 2 },
  cardTitle: { color: colors.onSurfaceInverse, fontSize: 17, fontWeight: "700" },
  cardSubtitle: { color: "rgba(240,244,238,0.8)", fontSize: 12, marginTop: 2 },
  statusChip: {
    position: "absolute", top: 10, right: 10,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusChipText: { fontSize: 11, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.brandSecondary,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.xs },
  emptyBody: { fontSize: 14, color: colors.onSurfaceSecondary, textAlign: "center", marginBottom: spacing.xl, lineHeight: 20 },
  emptyCta: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  emptyCtaText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 15 },
});
