import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import "react-native-url-polyfill/auto";

const SUPABASE_URL = "https://wbtudewmkomijnrgeuvd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndidHVkZXdta29taWpucmdldXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODkyMDMsImV4cCI6MjA4OTg2NTIwM30.pPra_OylHKz0urjj5aISXVeWpbSSyuG75r7aRnokHM4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
