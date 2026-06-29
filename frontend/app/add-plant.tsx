import { useState } from "react";
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
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

export default function AddPlant() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [location, setLocation] = useState("");
  const [photoB64, setPhotoB64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: "camera" | "library") => {
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const res =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5, allowsEditing: true, aspect: [1, 1] })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, allowsEditing: true, aspect: [1, 1] });
    if (!res.canceled && res.assets[0]?.base64) {
      setPhotoB64(res.assets[0].base64);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Please enter a name");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const plant = await api.createPlant({
        name: name.trim(),
        species: species.trim(),
        location: location.trim(),
        photo_base64: photoB64 || "",
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/plant/${plant.id}`);
    } catch (e: any) {
      setError(e?.message || "Could not save plant");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="add-plant-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <Pressable testID="close-add-plant" onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Add Plant</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => pick("library")} style={styles.photoSlot} testID="add-plant-photo">
            {photoB64 ? (
              <Image source={{ uri: `data:image/jpeg;base64,${photoB64}` }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={styles.photoEmpty}>
                <Ionicons name="image-outline" size={42} color={colors.brandPrimary} />
                <Text style={styles.photoText}>Tap to add a photo</Text>
              </View>
            )}
          </Pressable>

          <View style={styles.photoBtnRow}>
            <Pressable onPress={() => pick("camera")} style={styles.photoMiniBtn} testID="photo-camera">
              <Ionicons name="camera-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.photoMiniText}>Camera</Text>
            </Pressable>
            <Pressable onPress={() => pick("library")} style={styles.photoMiniBtn} testID="photo-library">
              <Ionicons name="images-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.photoMiniText}>Library</Text>
            </Pressable>
          </View>

          <Field label="Name *" value={name} onChange={setName} placeholder="e.g. Monstera Mike" testID="input-name" />
          <Field label="Species" value={species} onChange={setSpecies} placeholder="e.g. Monstera deliciosa" testID="input-species" />
          <Field label="Location" value={location} onChange={setLocation} placeholder="e.g. Living room window" testID="input-location" />

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable testID="save-plant-button" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Plant</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, testID }: any) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#8a988c"
        style={styles.input}
      />
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
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  photoSlot: {
    height: 220, borderRadius: radius.lg, overflow: "hidden",
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  photo: { width: "100%", height: "100%" },
  photoEmpty: { alignItems: "center", gap: 8 },
  photoText: { color: colors.onSurfaceSecondary, fontSize: 14 },
  photoBtnRow: { flexDirection: "row", gap: spacing.sm },
  photoMiniBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.brandSecondary, paddingVertical: spacing.sm, borderRadius: radius.pill,
  },
  photoMiniText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: 13 },
  label: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: "600" },
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
  saveBtn: {
    backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.pill,
    alignItems: "center",
  },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 16 },
});
