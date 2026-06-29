import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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

import { api, saveToken } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

export default function ForgotPin() {
  const router = useRouter();
  const [recovery, setRecovery] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (newPin.length < 6 || !/^\d+$/.test(newPin)) {
      setError("PIN must be 6–10 digits");
      return;
    }
    if (newPin !== confirm) {
      setError("PINs don't match");
      return;
    }
    if (recovery.replace(/[^A-Za-z0-9]/g, "").length < 8) {
      setError("Recovery code is required");
      return;
    }
    setBusy(true);
    try {
      const r = await api.resetPin(recovery.trim().toUpperCase(), newPin);
      await saveToken(r.token);
      setNewCode(r.recovery_code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const m = String(e?.message || "");
      if (m.includes("401")) setError("That recovery code didn't match");
      else if (m.includes("400")) setError("PIN or recovery code is invalid");
      else setError("Could not reset PIN");
    } finally {
      setBusy(false);
    }
  };

  const copyAndFinish = async () => {
    if (newCode) await Clipboard.setStringAsync(newCode);
    Haptics.selectionAsync();
    setNewCode(null);
    router.replace("/(tabs)");
  };

  // Auto-clear plaintext recovery code from memory after 60s (HP-2)
  useEffect(() => {
    if (!newCode) return;
    const t = setTimeout(() => {
      setNewCode(null);
      router.replace("/(tabs)");
    }, 60_000);
    return () => clearTimeout(t);
  }, [newCode, router]);

  if (newCode) {
    return (
      <SafeAreaView style={styles.container} testID="reset-success-screen">
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={48} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>PIN reset</Text>
          <Text style={styles.successBody}>
            Save your new recovery code below. It replaces the previous one and we won&apos;t show it again.
          </Text>
          <View style={styles.codeBox}>
            <Text style={styles.codeText} selectable testID="new-recovery-code">{newCode}</Text>
          </View>
          <Pressable onPress={copyAndFinish} style={styles.cta} testID="copy-and-finish">
            <Ionicons name="copy-outline" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.ctaText}>Copy and continue</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="forgot-pin-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn} testID="forgot-close">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Reset PIN</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.body}>
            Enter the 16-character recovery code you saved when you first set up the PIN, then choose a new PIN.
          </Text>

          <Text style={styles.label}>Recovery code</Text>
          <TextInput
            testID="recovery-input"
            value={recovery}
            onChangeText={setRecovery}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            placeholderTextColor="#8a988c"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={32}
            style={styles.input}
          />

          <Text style={styles.label}>New PIN (6–10 digits)</Text>
          <TextInput
            testID="new-pin-input"
            value={newPin}
            onChangeText={(t) => setNewPin(t.replace(/\D/g, "").slice(0, 10))}
            placeholder="••••••"
            placeholderTextColor="#8a988c"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={10}
            style={[styles.input, { textAlign: "center", letterSpacing: 6, fontSize: 22 }]}
          />

          <Text style={styles.label}>Confirm new PIN</Text>
          <TextInput
            testID="confirm-pin-input"
            value={confirm}
            onChangeText={(t) => setConfirm(t.replace(/\D/g, "").slice(0, 10))}
            placeholder="••••••"
            placeholderTextColor="#8a988c"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={10}
            style={[styles.input, { textAlign: "center", letterSpacing: 6, fontSize: 22 }]}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            testID="reset-submit"
            onPress={submit}
            disabled={busy}
            style={[styles.cta, busy && { opacity: 0.6 }]}
          >
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>Reset PIN</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  headerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  scroll: { padding: spacing.lg, gap: spacing.md },
  body: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: "600", color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: 15, color: colors.onSurface,
  },
  error: { color: colors.error, fontSize: 13, textAlign: "center" },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.md, borderRadius: radius.pill,
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 16 },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  successIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 24, fontWeight: "700", color: colors.onSurface },
  successBody: { fontSize: 14, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  codeBox: { backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, width: "100%" },
  codeText: { fontSize: 20, fontWeight: "700", color: colors.onSurface, letterSpacing: 2, textAlign: "center" },
});
