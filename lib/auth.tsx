import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session } from "@supabase/supabase-js";
import * as LocalAuthentication from "expo-local-authentication";
import { createContext, useContext, useEffect, useState } from "react";
import { getCredentials, supabase } from "./supabase";

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

  useEffect(() => {
    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function initAuth() {
    // Check if there's an existing session
    const {
      data: { session: existing },
    } = await supabase.auth.getSession();

    if (existing) {
      setSession(existing);
      setLoading(false);
      return;
    }

    // No active session — try biometric login with stored credentials
    const creds = await getCredentials();
    if (creds) {
      try {
        // Check if user has disabled biometric
        const bioPref = await AsyncStorage.getItem("nimbus_pref_biometric");
        const biometricEnabled = bioPref !== "false"; // default true

        if (biometricEnabled) {
          const hasHardware = await LocalAuthentication.hasHardwareAsync();
          const isEnrolled = await LocalAuthentication.isEnrolledAsync();

          if (hasHardware && isEnrolled) {
            const result = await LocalAuthentication.authenticateAsync({
              promptMessage: "Sign in to Nimbus WMS",
              fallbackLabel: "Use password",
              disableDeviceFallback: false,
            });

            if (result.success) {
              const { data, error } = await supabase.auth.signInWithPassword({
                email: creds.email,
                password: creds.password,
              });

              if (!error && data.session) {
                setSession(data.session);
              }
            }
          }
        }
      } catch (e) {
        // Biometric failed or unavailable — user will see login screen
      }
    }

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
