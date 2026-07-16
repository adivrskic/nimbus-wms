import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-reanimated";
import { AuthProvider, useAuth } from "../lib/auth";
import { OfflineProvider } from "../lib/offline";
import { ConflictModal } from "../lib/offlineUI";
import { PushNotificationsBridge } from "../lib/push";
import { ThemeProvider } from "../lib/theme";
import { ToastProvider } from "../lib/ui";
import { WarehouseProvider } from "../lib/warehouse";
export { ErrorBoundary } from "expo-router";
SplashScreen.preventAutoHideAsync();

function useProtectedRoute() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const onLoginScreen = segments[0] === "login";

    if (!session && !onLoginScreen) {
      router.replace("/login");
    } else if (session && onLoginScreen) {
      router.replace("/(tabs)");
    }
  }, [session, loading, segments]);
}

function RootLayoutNav() {
  useProtectedRoute();

  return (
    <>
      {/* Every screen renders its own Nimbus ScreenHeader — the native
          header is off globally so undeclared routes don't get a second
          header bar. */}
      <Stack screenOptions={{ headerShown: false }} />
      <ConflictModal />
      <PushNotificationsBridge />
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    // Brand faces — one family name per weight (RN/Android won't synthesize
    // weights on custom fonts; lib/nimbus/tokens.ts maps weights → these names).
    Satoshi: require("../assets/fonts/Satoshi-Regular.otf"),
    "Satoshi-Medium": require("../assets/fonts/Satoshi-Medium.otf"),
    "Satoshi-Bold": require("../assets/fonts/Satoshi-Bold.otf"),
    JetBrainsMono: require("../assets/fonts/JetBrainsMono-Regular.ttf"),
    "JetBrainsMono-Medium": require("../assets/fonts/JetBrainsMono-Medium.ttf"),
    "JetBrainsMono-SemiBold": require("../assets/fonts/JetBrainsMono-SemiBold.ttf"),
    "JetBrainsMono-Bold": require("../assets/fonts/JetBrainsMono-Bold.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <WarehouseProvider>
          <OfflineProvider>
            <ToastProvider>
              <RootLayoutNav />
            </ToastProvider>
          </OfflineProvider>
        </WarehouseProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
