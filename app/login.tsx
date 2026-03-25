import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { APP_CONFIG, THEME } from "../lib/config";
import { saveCredentials, supabase } from "../lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Enter email and password.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      Alert.alert("Login Error", error.message);
    } else {
      // Save credentials for biometric re-login
      await saveCredentials(email.trim(), password);
    }
  }

  async function handleSignUp() {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Enter email and password.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() || undefined } },
    });
    setLoading(false);
    if (error) {
      Alert.alert("Sign Up Error", error.message);
    } else {
      Alert.alert(
        "Account Created",
        "Check your email for a confirmation link, or sign in if auto-confirm is enabled.",
        [{ text: "OK", onPress: () => setIsSignUp(false) }]
      );
    }
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Client logo */}
          <View style={styles.logoArea}>
            <Image
              source={APP_CONFIG.clientLogo}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {/* Form */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {isSignUp ? "Create Account" : "Sign In"}
            </Text>

            {isSignUp && (
              <TextInput
                style={styles.input}
                placeholder="Full Name"
                placeholderTextColor={THEME.textSecondary}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={THEME.textSecondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={THEME.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={styles.button}
              onPress={isSignUp ? handleSignUp : handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>
                  {isSignUp ? "Create Account" : "Sign In"}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchRow}
              onPress={() => {
                setIsSignUp(!isSignUp);
                setFullName("");
              }}
            >
              <Text style={styles.switchText}>
                {isSignUp
                  ? "Already have an account? "
                  : "Don't have an account? "}
              </Text>
              <Text style={styles.switchLink}>
                {isSignUp ? "Sign In" : "Sign Up"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Powered by — pinned to bottom */}
      <View style={styles.poweredBy}>
        <FontAwesome name="cloud" size={18} color="#CCCCCC" />
        <Text style={styles.poweredByText}>
          {"Powered by "}
          {APP_CONFIG.productName}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  logoArea: {
    alignItems: "center",
    marginBottom: 32,
  },
  logo: {
    width: 280,
    height: 100,
  },
  formCard: {
    backgroundColor: THEME.surface,
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    backgroundColor: THEME.background,
    borderWidth: 1,
    borderColor: THEME.borderInput,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 14,
    color: THEME.textPrimary,
  },
  button: {
    backgroundColor: THEME.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 18,
  },
  switchText: {
    fontSize: 14,
    color: THEME.textSecondary,
  },
  switchLink: {
    fontSize: 14,
    color: THEME.primary,
    fontWeight: "bold",
  },
  poweredBy: {
    alignItems: "center",
    paddingBottom: 36,
    paddingTop: 12,
  },
  poweredByText: {
    fontSize: 12,
    color: "#CCCCCC",
    marginTop: 6,
  },
});
