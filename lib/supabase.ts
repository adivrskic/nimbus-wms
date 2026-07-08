import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import "react-native-url-polyfill/auto";

// nimbus-wms — the same Supabase project the desktop app (app-nimbus1) uses.
// The old american-flooring-services project had no `app` schema, so every
// query from this client 406'd against it.
const SUPABASE_URL = "https://seypbrzjjiuibrwyxewj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-KEIXG0jaD_gHypYjzevZA_KNF-mSku";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: "app" },
});

// Store credentials securely on device for biometric re-login
const CRED_KEY = "nimbus_wms_creds";

export async function saveCredentials(email: string, password: string) {
  await SecureStore.setItemAsync(CRED_KEY, JSON.stringify({ email, password }));
}

export async function getCredentials(): Promise<{
  email: string;
  password: string;
} | null> {
  const raw = await SecureStore.getItemAsync(CRED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearCredentials() {
  await SecureStore.deleteItemAsync(CRED_KEY);
}
