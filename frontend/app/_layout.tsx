import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { loadToken, setAuthFailHandler, getCachedToken } from "@/src/api";

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const [authChecked, setAuthChecked] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    loadToken().then((t) => {
      setHasToken(!!t);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // Redirect logic based on auth state + current route
  useEffect(() => {
    if (!authChecked) return;
    const inAuth = segments[0] === "pin";
    if (!hasToken && !inAuth) {
      router.replace("/pin");
    } else if (hasToken && inAuth) {
      router.replace("/(tabs)");
    }
  }, [authChecked, hasToken, segments, router]);

  // Wire 401 handler so api requests can punt to login
  useEffect(() => {
    setAuthFailHandler(() => {
      setHasToken(false);
      router.replace("/pin");
    });
    return () => setAuthFailHandler(null);
  }, [router]);

  // Re-check token cache whenever route changes (so post-login the token is recognized)
  useEffect(() => {
    if (!authChecked) return;
    const t = getCachedToken();
    if (!!t !== hasToken) setHasToken(!!t);
  }, [segments, authChecked, hasToken]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F9FAF7" } }}>
          <Stack.Screen name="pin" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="add-plant" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="edit-plant/[id]" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="scan-result" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="plant/[id]" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
