import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../lib/auth";
import { APP_CONFIG } from "../lib/config";
import { saveCredentials, supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

export default function LoginScreen() {
  const T = useTheme();
  const { loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const hasAutoSubmitted = useRef(false);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-submit after iOS keychain autofill populates both fields
  useEffect(() => {
    if (isSignUp || hasAutoSubmitted.current || loading) return;
    if (email.trim() && password.trim()) {
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
      autoSubmitTimer.current = setTimeout(() => {
        hasAutoSubmitted.current = true;
        handleAuth();
      }, 300);
    }
    return () => {
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    };
  }, [email, password]);

  // While auth.tsx is running biometric/session check, show spinner
  if (authLoading)
    return (
      <View
        style={[
          s.screen,
          {
            backgroundColor: T.background,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <ActivityIndicator size="large" color={T.primary} />
        <Text style={{ color: T.textSecondary, fontSize: 14, marginTop: 12 }}>
          Signing in...
        </Text>
      </View>
    );

  async function handleAuth() {
    if (!email.trim() || !password.trim()) return;
    if (isSignUp && !fullName.trim()) {
      alert("Please enter your name.");
      return;
    }
    setLoading(true);
    if (isSignUp) {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
        },
      });
      if (error) {
        alert(error.message);
        setLoading(false);
        return;
      }
      if (signUpData.user) {
        const { error: profileErr } = await supabase.from("profiles").insert({
          id: signUpData.user.id,
          email: email.trim(),
          full_name: fullName.trim(),
        });
        if (profileErr) {
          console.warn("Profile insert failed:", profileErr.message);
        }
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        alert(error.message);
        setLoading(false);
        return;
      }
    }
    await saveCredentials(email.trim(), password);
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={[s.screen, { backgroundColor: T.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.content}>
        {/* Logo */}
        <View style={s.logoWrap}>
          {APP_CONFIG.clientLogo ? (
            <Image
              source={APP_CONFIG.clientLogo}
              style={s.logo}
              resizeMode="contain"
            />
          ) : (
            <View
              style={[s.logoPlaceholder, { backgroundColor: T.primary + "12" }]}
            >
              <FontAwesome name="cloud" size={40} color={T.primary} />
            </View>
          )}
        </View>

        {/* Form */}
        <Text style={[s.title, { color: T.textPrimary }]}>
          {isSignUp ? "Create account" : "Welcome back"}
        </Text>
        <Text style={[s.subtitle, { color: T.textSecondary }]}>
          {isSignUp ? "Sign up to get started" : "Sign in to continue"}
        </Text>

        {isSignUp && (
          <TextInput
            style={[
              s.input,
              {
                backgroundColor: T.surface,
                borderColor: T.borderInput,
                color: T.textPrimary,
              },
            ]}
            placeholder="Full Name"
            placeholderTextColor={T.textSecondary}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />
        )}

        <TextInput
          style={[
            s.input,
            {
              backgroundColor: T.surface,
              borderColor: T.borderInput,
              color: T.textPrimary,
            },
          ]}
          placeholder="Email"
          placeholderTextColor={T.textSecondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          style={[
            s.input,
            {
              backgroundColor: T.surface,
              borderColor: T.borderInput,
              color: T.textPrimary,
            },
          ]}
          placeholder="Password"
          placeholderTextColor={T.textSecondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleAuth}
          disabled={loading}
        >
          <LinearGradient
            colors={T.headerGradient}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={s.button}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={s.buttonText}>
                {isSignUp ? "Sign Up" : "Sign In"}
              </Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setIsSignUp(!isSignUp)}
          style={s.toggleWrap}
        >
          <Text style={[s.toggleText, { color: T.textSecondary }]}>
            {isSignUp ? "Already have an account? " : "Don't have an account? "}
            <Text style={{ color: T.primary, fontWeight: "600" }}>
              {isSignUp ? "Sign In" : "Sign Up"}
            </Text>
          </Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={s.footer}>
        <FontAwesome
          name="cloud"
          size={14}
          color={T.mode === "dark" ? "#333" : "#CCC"}
        />
        <Text
          style={[s.footerText, { color: T.mode === "dark" ? "#333" : "#CCC" }]}
        >
          Powered by {APP_CONFIG.productName}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  logoWrap: { alignItems: "center", marginBottom: 32 },
  logo: { width: 240 },
  logoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: { fontSize: 14, textAlign: "center", marginBottom: 28 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: { color: "#FFF", fontSize: 16, fontWeight: "bold" },
  toggleWrap: { marginTop: 20, alignItems: "center" },
  toggleText: { fontSize: 14 },
  footer: {
    alignItems: "center",
    paddingBottom: 36,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  footerText: { fontSize: 10 },
});
