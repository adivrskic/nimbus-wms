/**
 * Login — Nimbus rebuild.
 *
 * Drop-in replacement for app/login.tsx. Per §8.5 ("Authentication
 * surfaces always render in light mode, regardless of user theme"),
 * this screen overrides the theme to light so the entry experience
 * is consistent across operators, time of day, and device settings.
 *
 * Layout follows the desktop /signin pattern adapted for mobile:
 *   - Single Nimbus glyph at top
 *   - Centered form with sharp field-shells
 *   - Primary action below
 *   - Ghost link for the secondary action (sign-up / forgot password)
 *
 * Auth flow stays as supabase.auth.signInWithPassword. If you have a
 * separate auth setup (Clerk, etc.), this calls the same helpers as
 * before — only the chrome changes.
 *
 * NOT included (intentional, for separate migration rounds):
 *   - Sign-up flow (creates auth + profile + org_members row).
 *     Currently links to the desktop dashboard signup. Standing up
 *     mobile signup needs the workspace-creation flow worked out.
 *   - "Forgot password" flow — supabase.auth.resetPasswordForEmail
 *     stub provided, but the redirect/deep-link config isn't.
 *   - Biometric unlock — controlled by Settings; this screen just
 *     reads from lib/auth if a prior session can be biometric-resumed.
 */

import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../lib/nimbus/Icon";
import { color, layout, space, type } from "../lib/nimbus/tokens";
import { supabase } from "../lib/supabase";
import { haptic } from "../lib/ui";

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT MODE PALETTE — locked, ignores system theme per §8.5
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors the relevant slice of the Nimbus light tokens. We don't read
// from useTheme() here because §8.5 wants auth chrome consistent
// regardless of system state.
const L = {
  bg: color.white, // #ffffff
  bgElevated: "#fafafa",
  text: color.nearBlack, // #0a0a0a
  textMuted: "#6b6b6b",
  textDim: "#9a9a9a",
  border: "rgba(0,0,0,0.10)",
  borderSubtle: "rgba(0,0,0,0.06)",
  borderHover: "rgba(0,0,0,0.20)",
  accent: color.accent, // #d4a853
  accentDim: "rgba(212,168,83,0.10)",
  accentBright: "#e0b970",
  danger: "#c53030",
  surface2: "rgba(0,0,0,0.03)",
};

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(
    null
  );

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError("Email and password required");
      return;
    }
    setError(null);
    setSubmitting(true);
    haptic.medium();

    try {
      const { error: e } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (e) {
        haptic.warning();
        setError(e.message);
      } else {
        haptic.success();
        // Routing is normally handled by an auth guard in the root layout.
        // Forcing a push here as a fallback in case the guard isn't wired.
        router.replace("/" as any);
      }
    } catch (e: any) {
      setError(e?.message ?? "Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      Alert.alert(
        "Enter your email",
        "We'll send a password reset link to that address."
      );
      return;
    }
    haptic.light();
    try {
      const { error: e } = await supabase.auth.resetPasswordForEmail(
        email.trim()
      );
      if (e) {
        Alert.alert("Couldn't send reset", e.message);
      } else {
        Alert.alert(
          "Check your email",
          `If an account exists for ${email.trim()}, a reset link is on its way.`
        );
      }
    } catch (e: any) {
      Alert.alert("Couldn't send reset", e?.message ?? "Try again.");
    }
  }

  function openSignUp() {
    haptic.light();
    Linking.openURL("https://nimbuswms.com/signup").catch(() => {
      Alert.alert(
        "Open sign-up",
        "Use the dashboard at nimbuswms.com to create a workspace."
      );
    });
  }

  return (
    <View
      style={[styles.screen, { backgroundColor: L.bg, paddingTop: insets.top }]}
    >
      {/* Status bar would normally be styled in app/_layout.tsx —
          add { headerShown: false, statusBarStyle: 'dark' } there
          for this route. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Nimbus mark */}
          <View style={styles.markWrap}>
            <View style={[styles.mark, { borderColor: L.accent }]}>
              <Text
                style={[
                  type.displayLg,
                  { color: L.accent, fontSize: 22, letterSpacing: -0.5 },
                ]}
              >
                N
              </Text>
            </View>
            <Text
              style={[
                type.label,
                {
                  color: L.textMuted,
                  letterSpacing: 3,
                  marginTop: space.s12,
                },
              ]}
            >
              NIMBUS WMS
            </Text>
          </View>

          {/* Headline */}
          <View style={styles.copy}>
            <Text style={[type.displayLg, { color: L.text, fontSize: 30 }]}>
              Sign in
            </Text>
            <Text
              style={[
                type.body,
                { color: L.textMuted, marginTop: space.s8, fontSize: 15 },
              ]}
            >
              Welcome back. Enter your credentials to access your workspace.
            </Text>
          </View>

          {/* Form */}
          <View style={{ gap: space.s16 }}>
            <Field label="Email" focused={focusedField === "email"}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor={L.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                style={[type.body, { color: L.text, padding: 0, fontSize: 15 }]}
              />
            </Field>

            <Field
              label="Password"
              focused={focusedField === "password"}
              trailing={
                <Pressable
                  onPress={() => setShowPassword((s) => !s)}
                  hitSlop={10}
                  accessibilityLabel={
                    showPassword ? "Hide password" : "Show password"
                  }
                >
                  <Text
                    style={[
                      type.labelSm,
                      { color: L.textMuted, letterSpacing: 1.5 },
                    ]}
                  >
                    {showPassword ? "HIDE" : "SHOW"}
                  </Text>
                </Pressable>
              }
            >
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={L.textDim}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                onSubmitEditing={handleSignIn}
                returnKeyType="go"
                style={[type.body, { color: L.text, padding: 0, fontSize: 15 }]}
              />
            </Field>

            {/* Error banner — §9.5 alert escalation in light mode */}
            {error ? (
              <View style={[styles.errorBanner, { borderColor: L.danger }]}>
                <Icon name="alert-circle" size={14} color={L.danger} />
                <Text
                  style={[
                    type.bodySm,
                    {
                      color: L.danger,
                      marginLeft: space.s8,
                      flex: 1,
                      fontSize: 13,
                    },
                  ]}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            {/* Primary action */}
            <Pressable
              onPress={handleSignIn}
              disabled={submitting}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: pressed ? L.accentBright : L.accent,
                  opacity: submitting ? 0.6 : 1,
                },
              ]}
              accessibilityLabel="Sign in"
            >
              <Text style={[type.label, { color: L.text, letterSpacing: 2 }]}>
                {submitting ? "SIGNING IN…" : "SIGN IN"}
              </Text>
            </Pressable>

            {/* Forgot password — ghost link */}
            <Pressable
              onPress={handleResetPassword}
              style={styles.ghostLink}
              hitSlop={10}
            >
              <Text
                style={[
                  type.labelSm,
                  { color: L.textMuted, letterSpacing: 1.5 },
                ]}
              >
                FORGOT PASSWORD?
              </Text>
            </Pressable>
          </View>

          {/* Divider + sign up */}
          <View style={[styles.divider, { backgroundColor: L.borderSubtle }]} />
          <View style={styles.signupRow}>
            <Text style={[type.bodySm, { color: L.textMuted, fontSize: 13 }]}>
              Don't have a workspace yet?
            </Text>
            <Pressable onPress={openSignUp} hitSlop={10}>
              <Text
                style={[
                  type.label,
                  { color: L.accent, letterSpacing: 2, marginLeft: space.s8 },
                ]}
              >
                CREATE ONE
              </Text>
            </Pressable>
          </View>

          <View style={{ height: space.s32 }} />

          {/* Footer */}
          <Text
            style={[
              type.labelSm,
              {
                color: L.textDim,
                letterSpacing: 1.5,
                textAlign: "center",
                marginBottom: insets.bottom + space.s12,
              },
            ]}
          >
            NIMBUS · {new Date().getFullYear()}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD — light-mode shell with gold focus caret per §8.5
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  focused,
  children,
  trailing,
}: {
  label: string;
  focused: boolean;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <View>
      <Text
        style={[
          type.labelSm,
          {
            color: focused ? L.accent : L.textMuted,
            letterSpacing: 2,
            marginBottom: space.s8,
          },
        ]}
      >
        {label.toUpperCase()}
      </Text>
      <View
        style={[
          styles.field,
          {
            borderColor: focused ? L.accent : L.border,
            // Left-edge accent caret when focused — visual cue from §8.5
            borderLeftWidth: focused ? 2 : layout.hairlineWidth,
            borderLeftColor: focused ? L.accent : L.border,
          },
        ]}
      >
        <View style={{ flex: 1 }}>{children}</View>
        {trailing}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    // Center contents vertically on tall screens but keep top alignment
    // when keyboard pushes things up.
    justifyContent: "flex-start",
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },

  // Brand mark
  markWrap: {
    alignItems: "center",
    marginTop: 32,
    marginBottom: 48,
  },
  mark: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    // SHARP corners per §1.1
  },

  // Copy block
  copy: {
    marginBottom: 32,
  },

  // Field
  field: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
    backgroundColor: L.bgElevated,
    borderWidth: layout.hairlineWidth,
    // SHARP corners per §1.1
  },

  // Error banner
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
    borderWidth: 1,
    borderLeftWidth: 4,
    backgroundColor: "rgba(197,48,48,0.04)",
  },

  // Primary
  primary: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    marginTop: space.s8,
    // SHARP corners per §1.1
  },

  // Ghost
  ghostLink: {
    alignItems: "center",
    paddingVertical: space.s12,
  },

  // Divider
  divider: {
    height: 1,
    marginVertical: 32,
  },

  // Signup row
  signupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
  },
});
