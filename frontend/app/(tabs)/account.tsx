import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { api, clearToken } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

export default function AccountTab() {
  const router = useRouter();
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [totalPlants, setTotalPlants] = useState(0);
  const [changeOpen, setChangeOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [me, summary] = await Promise.all([api.me(), api.summary()]);
      setCreatedAt(me.created_at);
      setTotalPlants(summary.total);
    } catch (e) {
      console.warn("account load", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onLogout = async () => {
    Alert.alert("Log out?", "You'll need your PIN to get back in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          try { await api.logout(); } catch {}
          await clearToken();
          router.replace("/pin");
        },
      },
    ]);
  };

  const onChangePin = async () => {
    setError(null);
    if (newPin.length < 6 || !/^\d+$/.test(newPin)) {
      setError("New PIN must be 6–10 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setError("New PIN doesn't match confirmation");
      return;
    }
    setBusy(true);
    try {
      await api.changePin(currentPin, newPin);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
      setChangeOpen(false);
      setInfo("PIN updated. Other devices were signed out.");
    } catch (e: any) {
      const m = String(e?.message || "");
      if (m.includes("401")) setError("Current PIN is wrong");
      else if (m.includes("400")) setError("New PIN must be different and digits-only");
      else setError("Could not change PIN");
    } finally {
      setBusy(false);
    }
  };

  const onRegenerate = async () => {
    Alert.alert(
      "Generate a new recovery code?",
      "Your previous recovery code will stop working.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Generate",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await api.regenerateRecovery();
              setNewRecoveryCode(r.recovery_code);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              setError("Could not generate code");
            }
          },
        },
      ]
    );
  };

  const copyRecovery = async () => {
    if (!newRecoveryCode) return;
    await Clipboard.setStringAsync(newRecoveryCode);
    Haptics.selectionAsync();
    setInfo("Recovery code copied to clipboard.");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="account-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Account</Text>
          <Text style={styles.subtitle}>Manage your PIN, recovery code, and sign-out</Text>
        </View>

        <View style={styles.statsRow}>
          <Stat label="Plants tracked" value={String(totalPlants)} />
          <Stat label="Since" value={createdAt ? new Date(createdAt).toLocaleDateString() : "—"} />
        </View>

        {info ? (
          <View style={styles.infoBox}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.infoText}>{info}</Text>
          </View>
        ) : null}

        {newRecoveryCode ? (
          <View style={styles.codeBanner} testID="recovery-banner">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="key" size={18} color={colors.onWarning} />
              <Text style={styles.codeBannerTitle}>Save this recovery code</Text>
            </View>
            <Text style={styles.codeBannerHelp}>Stored hashed on the server — we can&apos;t show it again later.</Text>
            <Pressable onPress={copyRecovery} style={styles.codeBox}>
              <Text style={styles.codeText} selectable testID="recovery-code-value">{newRecoveryCode}</Text>
              <Ionicons name="copy-outline" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable onPress={() => setNewRecoveryCode(null)} style={styles.codeAck} testID="dismiss-recovery">
              <Text style={styles.codeAckText}>I&apos;ve saved it</Text>
            </Pressable>
          </View>
        ) : null}

        <Section title="Security">
          {!changeOpen ? (
            <Row
              testID="open-change-pin"
              icon="lock-closed-outline"
              label="Change PIN"
              onPress={() => { setChangeOpen(true); setError(null); setInfo(null); }}
            />
          ) : (
            <View style={styles.formCard}>
              <Text style={styles.label}>Current PIN</Text>
              <TextInput
                value={currentPin}
                onChangeText={(t) => setCurrentPin(t.replace(/\D/g, "").slice(0, 10))}
                secureTextEntry keyboardType="number-pad" maxLength={10}
                style={styles.pinField} testID="current-pin"
              />
              <Text style={styles.label}>New PIN (6–10 digits)</Text>
              <TextInput
                value={newPin}
                onChangeText={(t) => setNewPin(t.replace(/\D/g, "").slice(0, 10))}
                secureTextEntry keyboardType="number-pad" maxLength={10}
                style={styles.pinField} testID="new-pin"
              />
              <Text style={styles.label}>Confirm new PIN</Text>
              <TextInput
                value={confirmPin}
                onChangeText={(t) => setConfirmPin(t.replace(/\D/g, "").slice(0, 10))}
                secureTextEntry keyboardType="number-pad" maxLength={10}
                style={styles.pinField} testID="confirm-pin"
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 8 }}>
                <Pressable onPress={() => { setChangeOpen(false); setError(null); }} style={[styles.btn, styles.btnGhost]}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </Pressable>
              <Pressable disabled={busy} onPress={onChangePin} style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.6 }]} testID="submit-change-pin">
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.btnPrimaryText}>Save new PIN</Text>}
                </Pressable>
              </View>
            </View>
          )}

          <Row
            testID="regenerate-recovery"
            icon="refresh-outline"
            label="Generate new recovery code"
            sublabel="Invalidates your previous code"
            onPress={onRegenerate}
          />
        </Section>

        <Section title="Session">
          <Row
            testID="logout-button"
            icon="log-out-outline"
            label="Log out"
            danger
            onPress={onLogout}
          />
        </Section>

        <Text style={styles.appFooter}>BotanIQ</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ gap: spacing.xs }}>{children}</View>
    </View>
  );
}

function Row({ icon, label, sublabel, onPress, danger, testID }: any) {
  return (
    <Pressable onPress={onPress} style={styles.row} testID={testID}>
      <View style={[styles.rowIcon, danger && { backgroundColor: "#F8E4E4" }]}>
        <Ionicons name={icon} size={18} color={danger ? colors.error : colors.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.error }]}>{label}</Text>
        {sublabel ? <Text style={styles.rowSub}>{sublabel}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 140 },
  header: { gap: 4 },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.onSurfaceSecondary },
  statsRow: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  statLabel: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4 },
  infoBox: { flexDirection: "row", gap: 6, backgroundColor: colors.brandTertiary, padding: spacing.sm, borderRadius: radius.sm, alignItems: "center" },
  infoText: { color: colors.onBrandTertiary, fontSize: 13, flex: 1 },
  codeBanner: { backgroundColor: colors.warning, padding: spacing.lg, borderRadius: radius.md, gap: spacing.sm },
  codeBannerTitle: { color: colors.onWarning, fontSize: 15, fontWeight: "700" },
  codeBannerHelp: { color: "rgba(255,255,255,0.85)", fontSize: 12 },
  codeBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.sm, gap: 8 },
  codeText: { fontSize: 17, fontWeight: "700", color: colors.onSurface, letterSpacing: 2 },
  codeAck: { alignSelf: "flex-start", backgroundColor: "#fff", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  codeAckText: { color: colors.warning, fontWeight: "700", fontSize: 13 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 1 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  formCard: { backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  label: { fontSize: 12, fontWeight: "600", color: colors.onSurfaceSecondary },
  pinField: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 18, letterSpacing: 4, color: colors.onSurface,
  },
  error: { color: colors.error, fontSize: 13 },
  btn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: colors.surfaceTertiary },
  btnGhostText: { color: colors.onSurface, fontWeight: "700" },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: colors.onBrandPrimary, fontWeight: "700" },
  appFooter: { textAlign: "center", color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.lg, letterSpacing: 2 },
});
