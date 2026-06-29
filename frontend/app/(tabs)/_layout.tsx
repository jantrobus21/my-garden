import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";

import { colors } from "@/src/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: "#7A8A7C",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          position: "absolute",
          borderTopWidth: 0,
          elevation: 0,
          backgroundColor:
            Platform.OS === "ios" ? "rgba(249,250,247,0.7)" : colors.surfaceSecondary,
          height: 84,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Garden",
          tabBarIcon: ({ color, size }) => <Ionicons name="leaf-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Activity",
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
