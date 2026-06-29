import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { api, saveToken } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

type Mode = "setup" | "login";

export default function PinScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    api.health()
      .then((h) => setMode(h.configured ? "login" : "setup"))
      .catch(() => setMode("login"));
  }, []);

  useEffect(() => {
    if (mode) setTimeout(() => inputRef.current?.focus(), 200);
  }, [mode]);

  const submit = async () => {
    if (busy || !mode) return;
    if (pin.length < 4 || pin.length > 10 || !/^\d+$/.test(pin)) {
      setError("PIN must be 4–10 digits");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = mode === "setup" ? await api.setupPin(pin) : await api.loginPin(pin);
      await saveToken(res.token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = String(e?.message || "");
      if (msg.includes("429")) setError("Too many attempts. Wait 30 seconds.");
      else if (msg.includes("401")) setError("Incorrect PIN.");
      else if (msg.includes("409")) {
        setMode("login");
        setError("Already set up. Enter your existing PIN.");
      } else if (msg.includes("400")) setError("PIN must be digits only.");
      else setError("Something went wrong. Try again.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="pin-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.inner}>
          <View style={styles.iconWrap}>
            <Ionicons name="leaf" size={48} color={colors.brandPrimary} />
          </View>
          <Text style={styles.title}>BotanIQ</Text>
          <Text style={styles.subtitle}>
            {mode === null
              ? "Loading…"
              : mode === "setup"
              ? "Create a PIN to protect your garden data"
              : "Enter your PIN to unlock"}
          </Text>

          {mode !== null ? (
            <>
              <TextInput
                ref={inputRef}
                testID="pin-input"
                value={pin}
                onChangeText={(t) => { setError(null); setPin(t.replace(/\D/g, "").slice(0, 10)); }}
                placeholder="••••"
                placeholderTextColor="#8a988c"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={10}
                style={styles.pinInput}
                returnKeyType="done"
                onSubmitEditing={submit}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                testID="pin-submit"
                disabled={busy || pin.length < 4}
                onPress={submit}
                style={[styles.cta, (busy || pin.length < 4) && { opacity: 0.5 }]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.ctaText}>{mode === "setup" ? "Create PIN" : "Unlock"}</Text>
                )}
              </Pressable>
              {mode === "setup" ? (
                <Text style={styles.hint}>
                  4–10 digits. You&apos;ll use this PIN whenever the app needs to re-authenticate.
                </Text>
              ) : null}
            </>
          ) : (
            <ActivityIndicator color={colors.brandPrimary} />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  inner: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  iconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.brandSecondary,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 32, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 21, marginBottom: spacing.md },
  pinInput: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    width: "70%", textAlign: "center",
    fontSize: 32, letterSpacing: 8, fontWeight: "700",
    paddingVertical: spacing.md,
    color: colors.onSurface,
  },
  cta: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill, minWidth: 200, alignItems: "center",
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 16 },
  error: { color: colors.error, fontSize: 13 },
  hint: { color: colors.onSurfaceSecondary, fontSize: 12, textAlign: "center", marginTop: spacing.sm, lineHeight: 17 },
});
