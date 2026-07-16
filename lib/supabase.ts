import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import "react-native-url-polyfill/auto";

// nimbus-wms — the same Supabase project the desktop app (app-nimbus1) uses.
// The old american-flooring-services project had no `app` schema, so every
// query from this client 406'd against it.
const SUPABASE_URL = "https://seypbrzjjiuibrwyxewj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-KEIXG0jaD_gHypYjzevZA_KNF-mSku";

// RN has no localStorage, so without an explicit storage the session lived in
// memory only and every cold start landed on the login screen. Persist it in
// AsyncStorage (tokens are short-lived + revocable; we deliberately do NOT
// store the password anywhere — biometric unlock gates the restored session
// in lib/auth.tsx instead).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: "app" },
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// supabase-js only refreshes tokens while "focused"; RN must drive that off
// AppState or a backgrounded app comes back with an expired session.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/**
 * Sign out AND scrub per-user device state. Shared scanners get handed
 * between operators — without this, user A's queued offline ops would sync
 * under user B's session and B could read A's cached inventory.
 */
export async function signOutDevice() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter(
      (k) =>
        k.startsWith("nimbus_cache_") ||
        k === "nimbus_offline_queue" ||
        k === "nimbus_active_warehouse_id"
    );
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {
    // Best effort — never block sign-out on storage cleanup.
  }
  await supabase.auth.signOut();
}
