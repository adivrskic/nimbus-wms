import FontAwesome from "@expo/vector-icons/FontAwesome";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ScreenHeader, useHeaderScroll } from "../../lib/Header";
import { APP_CONFIG } from "../../lib/config";
import { usePermissions } from "../../lib/permissions";
import { clearCredentials, supabase } from "../../lib/supabase";
import { useTheme, useThemeToggle } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

const STATUS_BAR = Platform.OS === "ios" ? 54 : 36;

export default function SettingsScreen() {
  const wh = useWarehouse();
  const perms = usePermissions();
  const router = useRouter();
  const T = useTheme();
  const toggleTheme = useThemeToggle();

  const { scrollY, onScroll } = useHeaderScroll();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(true);

  // Modal states
  const [showManageWarehouses, setShowManageWarehouses] = useState(false);
  const [showStaffManagement, setShowStaffManagement] = useState(false);
  const [showLabelPrinting, setShowLabelPrinting] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Profile edit form
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    loadInfo();
    loadPrefs();
  }, []);

  async function loadPrefs() {
    try {
      const notif = await AsyncStorage.getItem("nimbus_pref_notifications");
      const bio = await AsyncStorage.getItem("nimbus_pref_biometric");
      if (notif !== null) setNotificationsEnabled(notif === "true");
      if (bio !== null) setBiometricEnabled(bio === "true");
    } catch {}
  }

  async function setNotifPref(value: boolean) {
    setNotificationsEnabled(value);
    haptic.selection();
    try {
      await AsyncStorage.setItem("nimbus_pref_notifications", String(value));
    } catch {}
  }

  async function setBiometricPref(value: boolean) {
    setBiometricEnabled(value);
    haptic.selection();
    try {
      await AsyncStorage.setItem("nimbus_pref_biometric", String(value));
    } catch {}
  }

  async function loadInfo() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setEmail(user.email || "");
    setFullName(user.user_metadata?.full_name || "");

    // Load extra fields from profiles table
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone, role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile) {
      setPhone(profile.phone || "");
      setRole(profile.role || "staff");
    }
  }

  function openProfileEdit() {
    haptic.light();
    setEditName(fullName);
    setEditPhone(phone);
    setShowProfileEdit(true);
  }

  async function saveProfile() {
    if (!editName.trim()) {
      Alert.alert("Error", "Name is required.");
      return;
    }
    setSavingProfile(true);
    haptic.medium();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSavingProfile(false);
      return;
    }

    // Update auth user_metadata
    const { error: authErr } = await supabase.auth.updateUser({
      data: { full_name: editName.trim() },
    });
    if (authErr) {
      Alert.alert("Error", authErr.message);
      setSavingProfile(false);
      return;
    }

    // Update profiles table
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({
        full_name: editName.trim(),
        phone: editPhone.trim() || null,
      })
      .eq("id", user.id);
    if (profileErr) {
      Alert.alert("Error", profileErr.message);
      setSavingProfile(false);
      return;
    }

    haptic.success();
    setFullName(editName.trim());
    setPhone(editPhone.trim());
    setShowProfileEdit(false);
    setSavingProfile(false);
  }

  function getInitials() {
    if (fullName)
      return fullName
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    if (email) return email[0].toUpperCase();
    return "?";
  }

  async function handleSignOut() {
    Alert.alert("Sign Out", "You will need to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          haptic.medium();
          await clearCredentials();
          await supabase.auth.signOut();
        },
      },
    ]);
  }

  return (
    <View style={[styles.screen, { backgroundColor: T.background }]}>
      <ScreenHeader {...wh} scrollY={scrollY} />
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* Profile */}
        <TouchableOpacity
          style={[
            styles.profileCard,
            { backgroundColor: T.surface, borderColor: T.border },
          ]}
          activeOpacity={0.7}
          onPress={openProfileEdit}
        >
          <LinearGradient
            colors={T.headerGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{getInitials()}</Text>
          </LinearGradient>
          <View style={styles.profileInfo}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={[styles.profileName, { color: T.textPrimary }]}>
                {fullName || "User"}
              </Text>
              {role ? (
                <View
                  style={[
                    styles.rolePill,
                    { backgroundColor: T.primary + "12" },
                  ]}
                >
                  <Text style={[styles.rolePillText, { color: T.primary }]}>
                    {role}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.profileEmail, { color: T.textSecondary }]}>
              {email}
            </Text>
          </View>
          <FontAwesome name="chevron-right" size={12} color={T.textSecondary} />
        </TouchableOpacity>

        {/* Preferences */}
        <Text style={[styles.sectionLabel, { color: T.textSecondary }]}>
          Preferences
        </Text>
        <View
          style={[
            styles.section,
            { backgroundColor: T.surface, borderColor: T.border },
          ]}
        >
          <SettingsRow
            T={T}
            icon="bell"
            label="Push Notifications"
            trailing={
              <Switch
                value={notificationsEnabled}
                onValueChange={setNotifPref}
                trackColor={{
                  true: T.primary,
                  false: T.mode === "dark" ? "#333" : "#DDD",
                }}
              />
            }
          />
          <SettingsRow
            T={T}
            icon="lock"
            label="Face ID / Biometric"
            trailing={
              <Switch
                value={biometricEnabled}
                onValueChange={setBiometricPref}
                trackColor={{
                  true: T.primary,
                  false: T.mode === "dark" ? "#333" : "#DDD",
                }}
              />
            }
          />
          <SettingsRow
            T={T}
            icon={T.mode === "dark" ? "moon-o" : "sun-o"}
            label="Dark Mode"
            trailing={
              <Switch
                value={T.mode === "dark"}
                onValueChange={() => {
                  toggleTheme();
                  haptic.selection();
                }}
                trackColor={{
                  true: T.primary,
                  false: T.mode === "dark" ? "#333" : "#DDD",
                }}
              />
            }
            isLast
          />
        </View>

        {/* Warehouse — manager and above only */}
        {perms.canEditSettings && (
          <>
            <Text style={[styles.sectionLabel, { color: T.textSecondary }]}>
              Warehouse
            </Text>
            <View
              style={[
                styles.section,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              <SettingsRow
                T={T}
                icon="building"
                label="Manage Warehouses"
                onPress={() => {
                  haptic.light();
                  setShowManageWarehouses(true);
                }}
              />
              <SettingsRow
                T={T}
                icon="users"
                label="Staff Management"
                onPress={() => {
                  haptic.light();
                  setShowStaffManagement(true);
                }}
              />
              <SettingsRow
                T={T}
                icon="print"
                label="Label Printing"
                onPress={() => {
                  haptic.light();
                  setShowLabelPrinting(true);
                }}
                isLast
              />
            </View>
          </>
        )}

        {/* About */}
        <Text style={[styles.sectionLabel, { color: T.textSecondary }]}>
          About
        </Text>
        <View
          style={[
            styles.section,
            { backgroundColor: T.surface, borderColor: T.border },
          ]}
        >
          <SettingsRow
            T={T}
            icon="cloud"
            label="Platform"
            value={APP_CONFIG.productName}
          />
          <SettingsRow
            T={T}
            icon="briefcase"
            label="Client"
            value={APP_CONFIG.clientName}
          />
          <SettingsRow T={T} icon="code-fork" label="Version" value="1.0.0" />
          <SettingsRow
            T={T}
            icon="file-text-o"
            label="Terms of Service"
            onPress={() => {
              haptic.light();
              setShowTerms(true);
            }}
          />
          <SettingsRow
            T={T}
            icon="shield"
            label="Privacy Policy"
            onPress={() => {
              haptic.light();
              setShowPrivacy(true);
            }}
            isLast
          />
        </View>

        {/* Sign out */}
        <TouchableOpacity
          style={[
            styles.signOutButton,
            { backgroundColor: T.surface, borderColor: T.danger + "20" },
          ]}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <FontAwesome name="sign-out" size={16} color={T.danger} />
          <Text style={[styles.signOutText, { color: T.danger }]}>
            Sign Out
          </Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <FontAwesome
            name="cloud"
            size={16}
            color={T.mode === "dark" ? "#333" : "#DDD"}
          />
          <Text
            style={[
              styles.footerText,
              { color: T.mode === "dark" ? "#333" : "#DDD" },
            ]}
          >
            Powered by {APP_CONFIG.productName}
          </Text>
        </View>
      </ScrollView>

      {/* Manage Warehouses Modal */}
      <ManageWarehousesModal
        visible={showManageWarehouses}
        onClose={() => setShowManageWarehouses(false)}
        T={T}
        wh={wh}
      />

      {/* Staff Management Modal */}
      <StaffManagementModal
        visible={showStaffManagement}
        onClose={() => setShowStaffManagement(false)}
        T={T}
        warehouseId={wh.warehouseId}
        warehouseName={wh.warehouseName}
        userId={wh.userId}
      />

      {/* Label Printing Modal */}
      <LabelPrintingModal
        visible={showLabelPrinting}
        onClose={() => setShowLabelPrinting(false)}
        T={T}
      />

      {/* Profile Edit Modal */}
      <Modal
        visible={showProfileEdit}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={[ms.screen, { backgroundColor: T.background }]}>
          <LinearGradient
            colors={T.headerGradient}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={ms.header}
          >
            <View style={ms.handle} />
            <View style={ms.headerRow}>
              <TouchableOpacity
                onPress={() => setShowProfileEdit(false)}
                style={ms.closeBtn}
              >
                <FontAwesome
                  name="times"
                  size={16}
                  color="rgba(255,255,255,0.6)"
                />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={ms.headerSub}>Settings</Text>
                <Text style={ms.headerTitle}>Edit Profile</Text>
              </View>
            </View>
          </LinearGradient>

          <ScrollView
            style={ms.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ alignItems: "center", marginBottom: 24 }}>
              <LinearGradient
                colors={T.headerGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.avatar,
                  { width: 72, height: 72, borderRadius: 36 },
                ]}
              >
                <Text style={[styles.avatarText, { fontSize: 28 }]}>
                  {getInitials()}
                </Text>
              </LinearGradient>
            </View>

            <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
              Email
            </Text>
            <View
              style={[
                ms.editInput,
                {
                  backgroundColor: T.surface,
                  borderColor: T.borderInput,
                  opacity: 0.6,
                },
              ]}
            >
              <Text style={{ color: T.textSecondary, fontSize: 14 }}>
                {email}
              </Text>
            </View>

            <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
              Full name
            </Text>
            <TextInput
              style={[
                ms.editInput,
                {
                  backgroundColor: T.surface,
                  borderColor: T.borderInput,
                  color: T.textPrimary,
                },
              ]}
              value={editName}
              onChangeText={setEditName}
              placeholder="Your name"
              placeholderTextColor={T.textSecondary}
              autoCapitalize="words"
            />

            <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
              Phone
            </Text>
            <TextInput
              style={[
                ms.editInput,
                {
                  backgroundColor: T.surface,
                  borderColor: T.borderInput,
                  color: T.textPrimary,
                },
              ]}
              value={editPhone}
              onChangeText={setEditPhone}
              placeholder="Phone number"
              placeholderTextColor={T.textSecondary}
              keyboardType="phone-pad"
            />

            {role ? (
              <>
                <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
                  Role
                </Text>
                <View
                  style={[
                    ms.editInput,
                    {
                      backgroundColor: T.surface,
                      borderColor: T.borderInput,
                      opacity: 0.6,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: T.textSecondary,
                      fontSize: 14,
                      textTransform: "capitalize",
                    }}
                  >
                    {role}
                  </Text>
                </View>
              </>
            ) : null}

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={saveProfile}
              disabled={savingProfile}
              style={{ marginTop: 16 }}
            >
              <LinearGradient
                colors={T.headerGradient}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={{
                  borderRadius: 14,
                  paddingVertical: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {savingProfile ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <FontAwesome
                      name="check-circle"
                      size={16}
                      color="#FFF"
                      style={{ marginRight: 8 }}
                    />
                    <Text
                      style={{
                        color: "#FFF",
                        fontSize: 15,
                        fontWeight: "bold",
                      }}
                    >
                      Save Changes
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* Terms of Service Modal */}
      <Modal
        visible={showTerms}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={[ms.screen, { backgroundColor: T.background }]}>
          <LinearGradient
            colors={T.headerGradient}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={ms.header}
          >
            <View style={ms.handle} />
            <View style={ms.headerRow}>
              <TouchableOpacity
                onPress={() => setShowTerms(false)}
                style={ms.closeBtn}
              >
                <FontAwesome
                  name="times"
                  size={16}
                  color="rgba(255,255,255,0.6)"
                />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={ms.headerSub}>{APP_CONFIG.productName}</Text>
                <Text style={ms.headerTitle}>Terms of Service</Text>
              </View>
            </View>
          </LinearGradient>
          <ScrollView style={ms.body} showsVerticalScrollIndicator={false}>
            <Text style={[styles.legalDate, { color: T.textSecondary }]}>
              Last updated: January 1, 2025
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              1. Acceptance of Terms
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              By accessing or using {APP_CONFIG.productName}, you agree to be
              bound by these Terms of Service. If you do not agree, do not use
              the application.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              2. Use of Service
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              You may use {APP_CONFIG.productName} solely for lawful warehouse
              management purposes. You are responsible for maintaining the
              confidentiality of your account credentials and for all activity
              under your account.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              3. Data and Privacy
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              Your use of the service is also governed by our Privacy Policy.
              Inventory data, scan history, and user information are stored
              securely and used only to provide the service.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              4. Service Availability
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              We strive to maintain uptime but do not guarantee uninterrupted
              access. The service may be temporarily unavailable for maintenance
              or updates.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              5. Limitation of Liability
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              {APP_CONFIG.productName} is provided "as is" without warranties of
              any kind. We are not liable for any damages arising from your use
              of the service, including but not limited to loss of data or
              inventory discrepancies.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              6. Changes to Terms
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              We may update these terms from time to time. Continued use of the
              service after changes constitutes acceptance of the revised terms.
            </Text>
            <Text
              style={[
                styles.legalBody,
                { color: T.textSecondary, marginTop: 20, fontStyle: "italic" },
              ]}
            >
              For questions about these terms, contact {APP_CONFIG.clientName}.
            </Text>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* Privacy Policy Modal */}
      <Modal
        visible={showPrivacy}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={[ms.screen, { backgroundColor: T.background }]}>
          <LinearGradient
            colors={T.headerGradient}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={ms.header}
          >
            <View style={ms.handle} />
            <View style={ms.headerRow}>
              <TouchableOpacity
                onPress={() => setShowPrivacy(false)}
                style={ms.closeBtn}
              >
                <FontAwesome
                  name="times"
                  size={16}
                  color="rgba(255,255,255,0.6)"
                />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={ms.headerSub}>{APP_CONFIG.productName}</Text>
                <Text style={ms.headerTitle}>Privacy Policy</Text>
              </View>
            </View>
          </LinearGradient>
          <ScrollView style={ms.body} showsVerticalScrollIndicator={false}>
            <Text style={[styles.legalDate, { color: T.textSecondary }]}>
              Last updated: January 1, 2025
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              Information We Collect
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              We collect information you provide directly: your name, email
              address, and phone number when you create an account. We also
              collect usage data including scan history, inventory actions, and
              warehouse activity logs.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              How We Use Your Information
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              Your information is used to provide and improve the{" "}
              {APP_CONFIG.productName} service, including inventory tracking,
              analytics, and team collaboration features. We do not sell your
              data to third parties.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              Data Storage and Security
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              Data is stored securely using industry-standard encryption.
              Authentication credentials are stored on-device using secure
              storage. Database access is controlled through row-level security
              policies.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              Data Retention
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              Your data is retained as long as your account is active. Scan
              history and activity logs are kept for audit purposes. You may
              request deletion of your account and associated data at any time.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              Your Rights
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              You have the right to access, correct, or delete your personal
              data. You may update your profile information through the app
              settings. For data deletion requests, contact{" "}
              {APP_CONFIG.clientName}.
            </Text>
            <Text style={[styles.legalHeading, { color: T.textPrimary }]}>
              Changes to This Policy
            </Text>
            <Text style={[styles.legalBody, { color: T.textSecondary }]}>
              We may update this policy periodically. We will notify you of
              significant changes through the app. Continued use after changes
              constitutes acceptance.
            </Text>
            <Text
              style={[
                styles.legalBody,
                { color: T.textSecondary, marginTop: 20, fontStyle: "italic" },
              ]}
            >
              For privacy inquiries, contact {APP_CONFIG.clientName}.
            </Text>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ============================================================
// MANAGE WAREHOUSES MODAL
// ============================================================
function ManageWarehousesModal({
  visible,
  onClose,
  T,
  wh,
}: {
  visible: boolean;
  onClose: () => void;
  T: any;
  wh: any;
}) {
  const [editing, setEditing] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editState, setEditState] = useState("");
  const [editZip, setEditZip] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit(warehouse: any) {
    haptic.light();
    setEditing(warehouse);
    setEditName(warehouse.name || "");
    setEditAddress(warehouse.address || "");
    setEditCity(warehouse.city || "");
    setEditState(warehouse.state || "");
    setEditZip(warehouse.zip || "");
    setEditPhone(warehouse.phone || "");
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function saveEdit() {
    if (!editName.trim()) {
      Alert.alert("Error", "Name is required.");
      return;
    }
    setSaving(true);
    haptic.medium();
    const { error } = await supabase
      .from("warehouses")
      .update({
        name: editName.trim(),
        address: editAddress.trim() || null,
        city: editCity.trim() || null,
        state: editState.trim() || null,
        zip: editZip.trim() || null,
        phone: editPhone.trim() || null,
      })
      .eq("id", editing.id);
    setSaving(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    haptic.success();
    setEditing(null);
    wh.refreshWarehouses();
  }

  const warehouses = wh.accessibleWarehouses || [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={[ms.screen, { backgroundColor: T.background }]}>
        <LinearGradient
          colors={T.headerGradient}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={ms.header}
        >
          <View style={ms.handle} />
          <View style={ms.headerRow}>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <FontAwesome
                name="times"
                size={16}
                color="rgba(255,255,255,0.6)"
              />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={ms.headerSub}>Settings</Text>
              <Text style={ms.headerTitle}>Manage Warehouses</Text>
            </View>
          </View>
        </LinearGradient>

        <ScrollView
          style={ms.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {warehouses.map((warehouse: any) => {
            const isEditing = editing?.id === warehouse.id;
            const isActive = warehouse.id === wh.warehouseId;

            if (isEditing) {
              return (
                <View
                  key={warehouse.id}
                  style={[
                    ms.editCard,
                    {
                      backgroundColor: T.surface,
                      borderColor: T.primary + "40",
                    },
                  ]}
                >
                  <Text style={[ms.editLabel, { color: T.textSecondary }]}>
                    Name *
                  </Text>
                  <TextInput
                    style={[
                      ms.editInput,
                      {
                        backgroundColor: T.background,
                        borderColor: T.borderInput,
                        color: T.textPrimary,
                      },
                    ]}
                    value={editName}
                    onChangeText={setEditName}
                  />
                  <Text style={[ms.editLabel, { color: T.textSecondary }]}>
                    Address
                  </Text>
                  <TextInput
                    style={[
                      ms.editInput,
                      {
                        backgroundColor: T.background,
                        borderColor: T.borderInput,
                        color: T.textPrimary,
                      },
                    ]}
                    value={editAddress}
                    onChangeText={setEditAddress}
                  />
                  <View style={{ flexDirection: "row" }}>
                    <View style={{ flex: 1, marginRight: 6 }}>
                      <Text style={[ms.editLabel, { color: T.textSecondary }]}>
                        City
                      </Text>
                      <TextInput
                        style={[
                          ms.editInput,
                          {
                            backgroundColor: T.background,
                            borderColor: T.borderInput,
                            color: T.textPrimary,
                          },
                        ]}
                        value={editCity}
                        onChangeText={setEditCity}
                      />
                    </View>
                    <View style={{ width: 70, marginRight: 6 }}>
                      <Text style={[ms.editLabel, { color: T.textSecondary }]}>
                        State
                      </Text>
                      <TextInput
                        style={[
                          ms.editInput,
                          {
                            backgroundColor: T.background,
                            borderColor: T.borderInput,
                            color: T.textPrimary,
                          },
                        ]}
                        value={editState}
                        onChangeText={setEditState}
                        autoCapitalize="characters"
                        maxLength={2}
                      />
                    </View>
                    <View style={{ width: 90 }}>
                      <Text style={[ms.editLabel, { color: T.textSecondary }]}>
                        ZIP
                      </Text>
                      <TextInput
                        style={[
                          ms.editInput,
                          {
                            backgroundColor: T.background,
                            borderColor: T.borderInput,
                            color: T.textPrimary,
                          },
                        ]}
                        value={editZip}
                        onChangeText={setEditZip}
                        keyboardType="number-pad"
                      />
                    </View>
                  </View>
                  <Text style={[ms.editLabel, { color: T.textSecondary }]}>
                    Phone
                  </Text>
                  <TextInput
                    style={[
                      ms.editInput,
                      {
                        backgroundColor: T.background,
                        borderColor: T.borderInput,
                        color: T.textPrimary,
                      },
                    ]}
                    value={editPhone}
                    onChangeText={setEditPhone}
                    keyboardType="phone-pad"
                  />
                  <View style={{ flexDirection: "row", marginTop: 8 }}>
                    <TouchableOpacity
                      style={[ms.editCancelBtn, { borderColor: T.border }]}
                      onPress={cancelEdit}
                    >
                      <Text
                        style={[ms.editCancelTxt, { color: T.textSecondary }]}
                      >
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[ms.editSaveBtn, { backgroundColor: T.primary }]}
                      onPress={saveEdit}
                      disabled={saving}
                    >
                      {saving ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={ms.editSaveTxt}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            return (
              <TouchableOpacity
                key={warehouse.id}
                style={[
                  ms.whCard,
                  { backgroundColor: T.surface, borderColor: T.border },
                  isActive && { borderColor: T.primary + "40" },
                ]}
                activeOpacity={0.7}
                onPress={() => startEdit(warehouse)}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={[ms.whName, { color: T.textPrimary }]}>
                      {warehouse.name}
                    </Text>
                    {isActive && (
                      <View
                        style={[
                          ms.activePill,
                          { backgroundColor: T.primary + "15" },
                        ]}
                      >
                        <Text style={[ms.activePillTxt, { color: T.primary }]}>
                          Active
                        </Text>
                      </View>
                    )}
                  </View>
                  {warehouse.address ? (
                    <Text style={[ms.whDetail, { color: T.textSecondary }]}>
                      {warehouse.address}
                      {warehouse.city ? `, ${warehouse.city}` : ""}
                      {warehouse.state ? ` ${warehouse.state}` : ""}
                      {warehouse.zip ? ` ${warehouse.zip}` : ""}
                    </Text>
                  ) : null}
                  {warehouse.phone ? (
                    <Text style={[ms.whDetail, { color: T.textSecondary }]}>
                      {warehouse.phone}
                    </Text>
                  ) : null}
                </View>
                <FontAwesome name="pencil" size={12} color={T.textSecondary} />
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ============================================================
// STAFF MANAGEMENT MODAL
// ============================================================
function StaffManagementModal({
  visible,
  onClose,
  T,
  warehouseId,
  warehouseName,
  userId,
}: {
  visible: boolean;
  onClose: () => void;
  T: any;
  warehouseId: string;
  warehouseName: string;
  userId: string;
}) {
  const perms = usePermissions();
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (visible && warehouseId) loadStaff();
  }, [visible, warehouseId]);

  async function loadStaff() {
    setLoading(true);
    const { data } = await supabase
      .from("warehouse_access")
      .select("id, user_id, granted_at, profiles(full_name, email, role)")
      .eq("warehouse_id", warehouseId);
    setStaff(data || []);
    setLoading(false);
  }

  async function handleInvite() {
    const emailVal = inviteEmail.trim().toLowerCase();
    if (!emailVal) return;
    setInviting(true);
    haptic.medium();

    // Look up the user by email in profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", emailVal)
      .maybeSingle();

    if (!profile) {
      Alert.alert(
        "Not found",
        "No user with that email exists. They need to create an account first."
      );
      setInviting(false);
      return;
    }

    // Check if already has access
    const existing = staff.find((s) => s.user_id === profile.id);
    if (existing) {
      Alert.alert(
        "Already added",
        "This user already has access to this warehouse."
      );
      setInviting(false);
      return;
    }

    const { error } = await supabase.from("warehouse_access").insert({
      user_id: profile.id,
      warehouse_id: warehouseId,
      granted_by: userId,
    });

    setInviting(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    haptic.success();
    setInviteEmail("");
    loadStaff();
  }

  async function handleRemove(accessRow: any) {
    if (accessRow.user_id === userId) {
      Alert.alert(
        "Cannot remove",
        "You cannot remove yourself from this warehouse."
      );
      return;
    }
    const name =
      accessRow.profiles?.full_name || accessRow.profiles?.email || "this user";
    Alert.alert("Remove access", `Remove ${name} from ${warehouseName}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          haptic.medium();
          await supabase
            .from("warehouse_access")
            .delete()
            .eq("id", accessRow.id);
          loadStaff();
        },
      },
    ]);
  }

  function handleChangeRole(row: any) {
    if (row.user_id === userId) {
      Alert.alert("Cannot change", "You cannot change your own role.");
      return;
    }
    const currentRole = row.profiles?.role || "staff";
    const options: any[] = [
      { text: "Cancel", style: "cancel" },
      { text: "Staff", onPress: () => applyRole(row.user_id, "staff") },
      { text: "Manager", onPress: () => applyRole(row.user_id, "manager") },
    ];
    if (perms.canPromoteToSuperAdmin) {
      options.push({
        text: "Super Admin",
        onPress: () => applyRole(row.user_id, "super_admin"),
      });
    }
    Alert.alert(
      "Change role",
      `${row.profiles?.full_name || "User"} is currently ${currentRole}`,
      options
    );
  }

  async function applyRole(targetUserId: string, newRole: string) {
    haptic.medium();
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", targetUserId);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    haptic.success();
    loadStaff();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={[ms.screen, { backgroundColor: T.background }]}>
        <LinearGradient
          colors={T.headerGradient}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={ms.header}
        >
          <View style={ms.handle} />
          <View style={ms.headerRow}>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <FontAwesome
                name="times"
                size={16}
                color="rgba(255,255,255,0.6)"
              />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={ms.headerSub}>{warehouseName}</Text>
              <Text style={ms.headerTitle}>Staff Management</Text>
            </View>
          </View>
        </LinearGradient>

        <ScrollView
          style={ms.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Invite section */}
          <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
            Grant access
          </Text>
          <View style={{ flexDirection: "row", marginBottom: 20 }}>
            <TextInput
              style={[
                ms.editInput,
                {
                  flex: 1,
                  marginRight: 10,
                  marginBottom: 0,
                  backgroundColor: T.surface,
                  borderColor: T.borderInput,
                  color: T.textPrimary,
                },
              ]}
              placeholder="Email address"
              placeholderTextColor={T.textSecondary}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TouchableOpacity
              style={[ms.inviteBtn, { backgroundColor: T.primary }]}
              onPress={handleInvite}
              disabled={inviting}
            >
              {inviting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <FontAwesome name="plus" size={14} color="#FFF" />
              )}
            </TouchableOpacity>
          </View>

          {/* Staff list */}
          <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
            Users with access ({staff.length})
          </Text>
          {loading ? (
            <ActivityIndicator color={T.primary} style={{ marginTop: 20 }} />
          ) : (
            staff.map((row) => {
              const isYou = row.user_id === userId;
              return (
                <View
                  key={row.id}
                  style={[
                    ms.staffCard,
                    { backgroundColor: T.surface, borderColor: T.border },
                  ]}
                >
                  <View
                    style={[
                      ms.staffAvatar,
                      { backgroundColor: T.primary + "15" },
                    ]}
                  >
                    <FontAwesome name="user" size={14} color={T.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[ms.staffName, { color: T.textPrimary }]}>
                      {row.profiles?.full_name || "Unknown"}
                      {isYou ? " (you)" : ""}
                    </Text>
                    <Text style={[ms.staffEmail, { color: T.textSecondary }]}>
                      {row.profiles?.email || ""}
                    </Text>
                  </View>
                  {!isYou && perms.canAssignRoles ? (
                    <TouchableOpacity
                      onPress={() => handleChangeRole(row)}
                      style={[
                        ms.roleBadge,
                        { backgroundColor: T.primary + "10" },
                      ]}
                      activeOpacity={0.7}
                    >
                      <Text style={[ms.roleBadgeTxt, { color: T.primary }]}>
                        {row.profiles?.role || "staff"}
                      </Text>
                      <FontAwesome
                        name="pencil"
                        size={8}
                        color={T.primary}
                        style={{ marginLeft: 4 }}
                      />
                    </TouchableOpacity>
                  ) : (
                    <View
                      style={[
                        ms.roleBadge,
                        { backgroundColor: T.primary + "10" },
                      ]}
                    >
                      <Text style={[ms.roleBadgeTxt, { color: T.primary }]}>
                        {row.profiles?.role || "staff"}
                      </Text>
                    </View>
                  )}
                  {!isYou && (
                    <TouchableOpacity
                      style={{ marginLeft: 10, padding: 4 }}
                      onPress={() => handleRemove(row)}
                    >
                      <FontAwesome
                        name="times-circle"
                        size={18}
                        color={T.danger}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ============================================================
// LABEL PRINTING MODAL
// ============================================================
function LabelPrintingModal({
  visible,
  onClose,
  T,
}: {
  visible: boolean;
  onClose: () => void;
  T: any;
}) {
  const [labelSize, setLabelSize] = useState<"small" | "medium" | "large">(
    "medium"
  );
  const [includePrice, setIncludePrice] = useState(false);
  const [includeLocation, setIncludeLocation] = useState(true);

  const sizes = [
    { value: "small" as const, label: "Small", desc: '1" x 2"' },
    { value: "medium" as const, label: "Medium", desc: '2" x 3"' },
    { value: "large" as const, label: "Large", desc: '3" x 4"' },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={[ms.screen, { backgroundColor: T.background }]}>
        <LinearGradient
          colors={T.headerGradient}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={ms.header}
        >
          <View style={ms.handle} />
          <View style={ms.headerRow}>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <FontAwesome
                name="times"
                size={16}
                color="rgba(255,255,255,0.6)"
              />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={ms.headerSub}>Settings</Text>
              <Text style={ms.headerTitle}>Label Printing</Text>
            </View>
          </View>
        </LinearGradient>

        <ScrollView style={ms.body} showsVerticalScrollIndicator={false}>
          {/* Printer connection */}
          <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
            Printer
          </Text>
          <View
            style={[
              ms.comingSoonCard,
              { backgroundColor: T.surface, borderColor: T.border },
            ]}
          >
            <View
              style={[ms.comingSoonIcon, { backgroundColor: T.primary + "10" }]}
            >
              <FontAwesome name="print" size={20} color={T.primary} />
            </View>
            <Text style={[ms.comingSoonTitle, { color: T.textPrimary }]}>
              Bluetooth printer setup
            </Text>
            <Text style={[ms.comingSoonSub, { color: T.textSecondary }]}>
              Printer pairing is coming in a future update. Configure your label
              preferences below.
            </Text>
          </View>

          {/* Label size */}
          <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
            Label size
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
            {sizes.map((s) => {
              const active = labelSize === s.value;
              return (
                <TouchableOpacity
                  key={s.value}
                  style={[
                    ms.sizeCard,
                    {
                      backgroundColor: active ? T.primary + "10" : T.surface,
                      borderColor: active ? T.primary : T.border,
                    },
                  ]}
                  onPress={() => {
                    haptic.selection();
                    setLabelSize(s.value);
                  }}
                >
                  <Text
                    style={[
                      ms.sizeLabel,
                      { color: active ? T.primary : T.textPrimary },
                    ]}
                  >
                    {s.label}
                  </Text>
                  <Text
                    style={[
                      ms.sizeDesc,
                      { color: active ? T.primary : T.textSecondary },
                    ]}
                  >
                    {s.desc}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Label content */}
          <Text style={[ms.fieldLabel, { color: T.textSecondary }]}>
            Label content
          </Text>
          <View
            style={[
              ms.optionCard,
              { backgroundColor: T.surface, borderColor: T.border },
            ]}
          >
            <View style={ms.optionRow}>
              <FontAwesome
                name="barcode"
                size={14}
                color={T.primary}
                style={{ width: 28 }}
              />
              <Text style={[ms.optionLabel, { color: T.textPrimary }]}>
                Barcode
              </Text>
              <Text style={[ms.optionNote, { color: T.textSecondary }]}>
                Always
              </Text>
            </View>
            <View style={[ms.optionDivider, { backgroundColor: T.border }]} />
            <View style={ms.optionRow}>
              <FontAwesome
                name="font"
                size={14}
                color={T.primary}
                style={{ width: 28 }}
              />
              <Text style={[ms.optionLabel, { color: T.textPrimary }]}>
                Product name
              </Text>
              <Text style={[ms.optionNote, { color: T.textSecondary }]}>
                Always
              </Text>
            </View>
            <View style={[ms.optionDivider, { backgroundColor: T.border }]} />
            <View style={ms.optionRow}>
              <FontAwesome
                name="map-marker"
                size={14}
                color={T.primary}
                style={{ width: 28 }}
              />
              <Text style={[ms.optionLabel, { color: T.textPrimary, flex: 1 }]}>
                Location
              </Text>
              <Switch
                value={includeLocation}
                onValueChange={(v) => {
                  setIncludeLocation(v);
                  haptic.selection();
                }}
                trackColor={{
                  true: T.primary,
                  false: T.mode === "dark" ? "#333" : "#DDD",
                }}
              />
            </View>
            <View style={[ms.optionDivider, { backgroundColor: T.border }]} />
            <View style={ms.optionRow}>
              <FontAwesome
                name="tag"
                size={14}
                color={T.primary}
                style={{ width: 28 }}
              />
              <Text style={[ms.optionLabel, { color: T.textPrimary, flex: 1 }]}>
                Price
              </Text>
              <Switch
                value={includePrice}
                onValueChange={(v) => {
                  setIncludePrice(v);
                  haptic.selection();
                }}
                trackColor={{
                  true: T.primary,
                  false: T.mode === "dark" ? "#333" : "#DDD",
                }}
              />
            </View>
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ============================================================
// SETTINGS ROW (shared component)
// ============================================================
function SettingsRow({
  T,
  icon,
  label,
  value,
  onPress,
  trailing,
  isLast,
}: {
  T: any;
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  isLast?: boolean;
}) {
  const content = (
    <View
      style={[
        styles.row,
        !isLast && {
          borderBottomWidth: 1,
          borderBottomColor:
            T.mode === "dark" ? "rgba(255,255,255,0.05)" : "#F2F2F2",
        },
      ]}
    >
      <View style={[styles.rowIconWrap, { backgroundColor: T.primary + "10" }]}>
        <FontAwesome name={icon as any} size={14} color={T.primary} />
      </View>
      <Text style={[styles.rowLabel, { color: T.textPrimary }]}>{label}</Text>
      <View style={styles.rowRight}>
        {trailing ? (
          trailing
        ) : value ? (
          <Text style={[styles.rowValue, { color: T.textSecondary }]}>
            {value}
          </Text>
        ) : onPress ? (
          <FontAwesome name="chevron-right" size={12} color={T.textSecondary} />
        ) : null}
      </View>
    </View>
  );
  if (onPress)
    return (
      <TouchableOpacity activeOpacity={0.6} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  return content;
}

// ============================================================
// STYLES
// ============================================================
const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#FFF", fontSize: 20, fontWeight: "bold" },
  profileInfo: { flex: 1, marginLeft: 14 },
  profileName: { fontSize: 17, fontWeight: "bold" },
  profileEmail: { fontSize: 13, marginTop: 2 },
  rolePill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  legalDate: { fontSize: 12, marginBottom: 20, fontStyle: "italic" },
  legalHeading: {
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 8,
  },
  legalBody: { fontSize: 14, lineHeight: 22 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  rowLabel: { flex: 1, fontSize: 15 },
  rowRight: { flexDirection: "row", alignItems: "center" },
  rowValue: { fontSize: 14 },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 16,
    marginBottom: 24,
  },
  signOutText: { fontSize: 15, fontWeight: "600", marginLeft: 10 },
  footer: { alignItems: "center", paddingBottom: 20 },
  footerText: { fontSize: 12, marginTop: 6 },
});

// Modal shared styles
const ms = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 16,
  },
  headerRow: { flexDirection: "row", alignItems: "center" },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  headerSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.5)",
    fontWeight: "600",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#FFF",
    marginTop: 2,
  },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  editInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    marginBottom: 8,
  },
  editLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
    marginLeft: 4,
  },
  editCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1.5,
  },
  editCancelBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginRight: 8,
    borderWidth: 1,
  },
  editCancelTxt: { fontSize: 14, fontWeight: "600" },
  editSaveBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  editSaveTxt: { fontSize: 14, fontWeight: "bold", color: "#FFF" },
  whCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  whName: { fontSize: 15, fontWeight: "bold" },
  whDetail: { fontSize: 12, marginTop: 2 },
  activePill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  activePillTxt: { fontSize: 10, fontWeight: "bold" },
  staffCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
  },
  staffAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  staffName: { fontSize: 14, fontWeight: "bold" },
  staffEmail: { fontSize: 12, marginTop: 1 },
  roleBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  roleBadgeTxt: {
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  inviteBtn: {
    width: 48,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  comingSoonCard: {
    borderRadius: 14,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    marginBottom: 24,
  },
  comingSoonIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  comingSoonTitle: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  comingSoonSub: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  sizeCard: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  sizeLabel: { fontSize: 14, fontWeight: "bold" },
  sizeDesc: { fontSize: 11, marginTop: 2 },
  optionCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  optionLabel: { fontSize: 14, marginLeft: 4 },
  optionNote: { fontSize: 12 },
  optionDivider: { height: 1, marginHorizontal: 16 },
});
