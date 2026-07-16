import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session } from "@supabase/supabase-js";
import * as LocalAuthentication from "expo-local-authentication";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

type AuthContextType = {
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // While the biometric gate is up we hold the restored session back from the
  // rest of the app; onAuthStateChange must not leak it early.
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession((prev) => {
        // Ignore restore events until the biometric gate has cleared; accept
        // everything after that (sign-in, refresh, sign-out).
        if (!unlocked && prev === null && next !== null) return prev;
        return next;
      });
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function initAuth() {
    // The session persists in AsyncStorage (see lib/supabase.ts), so a cold
    // start restores it here instead of forcing a password re-entry.
    const {
      data: { session: existing },
    } = await supabase.auth.getSession();

    if (!existing) {
      setUnlocked(true);
      setLoading(false);
      return;
    }

    // Optional biometric gate in front of the restored session. The password
    // itself is never stored — failing the gate signs the device out.
    try {
      const bioPref = await AsyncStorage.getItem("nimbus_pref_biometric");
      const biometricEnabled = bioPref === "true"; // opt-in
      if (biometricEnabled) {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (hasHardware && isEnrolled) {
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage: "Unlock Nautilus Inventory",
            fallbackLabel: "Use device passcode",
            disableDeviceFallback: false,
          });
          if (!result.success) {
            await supabase.auth.signOut();
            setUnlocked(true);
            setLoading(false);
            return;
          }
        }
      }
    } catch {
      // Biometric hardware errored — fail open to the session we already
      // authenticated for, rather than locking the operator out on the floor.
    }

    setUnlocked(true);
    setSession(existing);
    setLoading(false);
  }

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
