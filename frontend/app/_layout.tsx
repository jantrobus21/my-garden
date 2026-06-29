import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F9FAF7" } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="add-plant" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="scan-result" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="plant/[id]" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
