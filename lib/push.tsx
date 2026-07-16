/**
 * Push notifications — Expo push token registration + tap handling.
 *
 * Delivery pipeline:
 *   desk crons INSERT app.notifications
 *     → pg_cron job send-push-notifications (every minute, desk migration
 *       20260715210000_push_notifications.sql) batches unpushed rows,
 *       joins app.user_push_tokens and POSTs to the Expo push API
 *     → Expo → FCM / APNs → this device.
 *
 * This module owns the device side: permission prompt, Expo push token,
 * upsert into app.user_push_tokens (RLS: own rows only), and routing taps.
 *
 * Requires an EAS project id (Constants.expoConfig.extra.eas.projectId,
 * written by `eas init`). Without it registration reports "no-eas-project"
 * and the app behaves exactly as before — the toggle explains why.
 * Note: remote push does NOT work in Expo Go (SDK 53+) — needs a dev build.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useAuth } from "./auth";
import { color } from "./nimbus/tokens";
import { supabase } from "./supabase";

const PUSH_TOKEN_KEY = "nautilus_push_token";
const PREF_NOTIFICATIONS = "nimbus_pref_notifications";

// Foreground presentation: show the banner (floor workers glance, not dig).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushRegisterResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not-device" | "no-eas-project" | "permission-denied" | "error";
      message: string;
    };

function easProjectId(): string | null {
  return (
    (Constants.expoConfig?.extra as any)?.eas?.projectId ??
    (Constants as any).easConfig?.projectId ??
    null
  );
}

/**
 * Request permission, fetch the Expo push token and upsert it for this user.
 * Safe to call repeatedly (idempotent upsert keyed on the token).
 */
export async function registerForPushNotifications(
  userId: string
): Promise<PushRegisterResult> {
  if (!Device.isDevice) {
    return {
      ok: false,
      reason: "not-device",
      message: "Push notifications need a physical device.",
    };
  }
  const projectId = easProjectId();
  if (!projectId) {
    return {
      ok: false,
      reason: "no-eas-project",
      message:
        "This build isn't linked to an EAS project yet — run `eas init` and rebuild.",
    };
  }

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Warehouse alerts",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: color.accent,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") {
      return {
        ok: false,
        reason: "permission-denied",
        message:
          "Notifications are blocked for this app — enable them in system settings.",
      };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const { error } = await supabase.from("user_push_tokens").upsert(
      {
        token,
        user_id: userId,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" }
    );
    if (error) {
      return { ok: false, reason: "error", message: error.message };
    }
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      reason: "error",
      message: e?.message ?? "Push registration failed.",
    };
  }
}

/** Remove THIS device's token (toggle off / sign-out). Best effort. */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (token) {
      await supabase.from("user_push_tokens").delete().eq("token", token);
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    }
  } catch {
    // Losing the row just means one stale token; the sender tolerates it.
  }
}

/** Mobile routes a notification tap is allowed to land on directly. */
const ROUTABLE_PREFIXES = [
  "/orders/",
  "/product/",
  "/po/",
  "/purchase-orders",
  "/returns",
  "/waves",
  "/cycle-counts",
  "/inbound",
  "/work-orders",
  "/notifications",
];

/**
 * Mounted once inside the root layout's providers. Registers the token when
 * a session exists (and the pref allows it) and routes notification taps —
 * desk-shaped links that don't exist on mobile fall back to the inbox.
 */
export function PushNotificationsBridge() {
  const { session } = useAuth();
  const router = useRouter();
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || registeredFor.current === userId) return;
    registeredFor.current = userId;
    (async () => {
      const pref = await AsyncStorage.getItem(PREF_NOTIFICATIONS);
      if (pref === "false") return;
      await registerForPushNotifications(userId);
    })();
  }, [session?.user?.id]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const link = response.notification.request.content.data?.link;
        const target =
          typeof link === "string" &&
          ROUTABLE_PREFIXES.some((p) => link.startsWith(p))
            ? link
            : "/notifications";
        router.push(target as any);
      }
    );
    return () => sub.remove();
  }, [router]);

  return null;
}
