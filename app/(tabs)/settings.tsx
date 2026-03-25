import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { APP_CONFIG, THEME } from "../../lib/config";
import { clearCredentials, supabase } from "../../lib/supabase";

export default function SettingsScreen() {
  const [email, setEmail] = useState("");
  const [warehouseName, setWarehouseName] = useState("");

  useEffect(() => {
    loadInfo();
  }, []);

  async function loadInfo() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setEmail(user?.email || "");

    const { data: warehouse } = await supabase
      .from("warehouses")
      .select("name")
      .limit(1)
      .single();
    setWarehouseName(warehouse?.name || "");
  }

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await clearCredentials();
          await supabase.auth.signOut();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.avatarCircle}>
          <FontAwesome name="user" size={28} color="#FFF" />
        </View>
        <Text style={styles.email}>{email}</Text>
        <Text style={styles.warehouse}>{warehouseName}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Platform</Text>
          <Text style={styles.rowValue}>{APP_CONFIG.productName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Client</Text>
          <Text style={styles.rowValue}>{APP_CONFIG.clientName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>1.0.0</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <FontAwesome name="sign-out" size={18} color={THEME.primary} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  card: {
    backgroundColor: THEME.secondary,
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: THEME.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  email: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  warehouse: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    marginTop: 4,
  },
  section: {
    backgroundColor: THEME.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  rowLabel: {
    fontSize: 15,
    color: THEME.textPrimary,
  },
  rowValue: {
    fontSize: 15,
    color: THEME.textSecondary,
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingVertical: 16,
  },
  signOutText: {
    fontSize: 16,
    color: THEME.primary,
    fontWeight: "600",
    marginLeft: 10,
  },
});
