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
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import QrScannerModal from "@/src/components/QrScannerModal";

export default function EditPlant() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [location, setLocation] = useState("");
  const [plantNumber, setPlantNumber] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [photoB64, setPhotoB64] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    api.getPlant(id).then((p) => {
      setName(p.name);
      setSpecies(p.species || "");
      setLocation(p.location || "");
      setPlantNumber(p.plant_number || "");
      setQrCode(p.qr_code || "");
      setPhotoB64(p.photo_base64 || "");
      setLoading(false);
    }).catch(() => {
      setError("Could not load plant");
      setLoading(false);
    });
  }, [id]);

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
    if (!id) return;
    if (!name.trim()) {
      setError("Please enter a name");
      return;
    }
    const pn = plantNumber.trim().toUpperCase();
    if (pn && !/^P\d+$/.test(pn)) {
      setError("Plant ID must be P followed by digits (e.g. P0001)");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updatePlant(id, {
        name: name.trim(),
        species: species.trim(),
        location: location.trim(),
        plant_number: pn,
        qr_code: qrCode.trim(),
        photo_base64: photoB64,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("409")) setError("That Plant ID or QR code is already in use by another plant.");
      else if (msg.includes("400")) setError("Plant ID must be P followed by digits (e.g. P0001).");
      else setError("Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="edit-plant-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <Pressable testID="close-edit-plant" onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Edit Plant</Text>
          <View style={{ width: 40 }} />
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              <Pressable onPress={() => pick("library")} style={styles.photoSlot} testID="edit-photo">
                {photoB64 ? (
                  <Image
                    source={{ uri: photoB64.startsWith("data:") ? photoB64 : `data:image/jpeg;base64,${photoB64}` }}
                    style={styles.photo}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.photoEmpty}>
                    <Ionicons name="image-outline" size={42} color={colors.brandPrimary} />
                    <Text style={styles.photoText}>Tap to change photo</Text>
                  </View>
                )}
              </Pressable>

              <View style={styles.photoBtnRow}>
                <Pressable onPress={() => pick("camera")} style={styles.photoMiniBtn} testID="edit-photo-camera">
                  <Ionicons name="camera-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.photoMiniText}>Camera</Text>
                </Pressable>
                <Pressable onPress={() => pick("library")} style={styles.photoMiniBtn} testID="edit-photo-library">
                  <Ionicons name="images-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.photoMiniText}>Library</Text>
                </Pressable>
              </View>

              <Field label="Name *" value={name} onChange={setName} placeholder="Plant name" testID="edit-name" />
              <Field label="Species" value={species} onChange={setSpecies} placeholder="Scientific name" testID="edit-species" />
              <Field label="Location" value={location} onChange={setLocation} placeholder="Where it lives" testID="edit-location" />

              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Plant ID</Text>
                <Text style={styles.helper}>P followed by digits (e.g. P0001 or P12345).</Text>
                <TextInput
                  testID="edit-plant-number"
                  value={plantNumber}
                  onChangeText={(t) => setPlantNumber(t.toUpperCase().slice(0, 12))}
                  placeholder="P0001"
                  placeholderTextColor="#8a988c"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  style={[styles.input, { letterSpacing: 1 }]}
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={styles.label}>QR tag</Text>
                <View style={styles.qrRow}>
                  <TextInput
                    testID="edit-qr"
                    value={qrCode}
                    onChangeText={setQrCode}
                    placeholder="QR code"
                    placeholderTextColor="#8a988c"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={[styles.input, { flex: 1, letterSpacing: 1 }]}
                  />
                  <Pressable
                    testID="edit-qr-scan"
                    onPress={() => setScannerOpen(true)}
                    style={styles.scanBtn}
                  >
                    <Ionicons name="qr-code-outline" size={18} color={colors.onBrandPrimary} />
                    <Text style={styles.scanBtnText}>Scan</Text>
                  </Pressable>
                </View>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>

            <View style={styles.footer}>
              <Pressable testID="save-edit-button" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Changes</Text>}
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>

      <QrScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(code) => {
          setQrCode(code);
          setScannerOpen(false);
        }}
      />
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
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  helper: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: 15, color: colors.onSurface,
  },
  qrRow: { flexDirection: "row", gap: spacing.sm, alignItems: "stretch" },
  scanBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md, borderRadius: radius.md,
  },
  scanBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 },
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
