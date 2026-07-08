/**
 * Settings — Nimbus rebuild.
 *
 * Drop-in replacement for app/(tabs)/settings.tsx. Old screen had a
 * gradient avatar profile card, rounded section blocks, FontAwesome
 * icons, and three substantial sub-modals (Manage Warehouses, Staff,
 * Label Printing) inlined here. New shell uses hairline-divided list
 * rows + sheet sub-pages per §8.4.
 *
 * Working in this version:
 *   - Profile (read + edit via sheet)
 *   - Switch facility (sheet listing warehouses)
 *   - Push notifications / biometric / theme toggles
 *   - Sign out (destructive confirmation)
 *
 * Stubbed pending a focused migration round:
 *   - Manage Warehouses (CRUD over warehouses table — was a big modal)
 *   - Staff Management (warehouse_access invites + role changes)
 *   - Label Printing (Zebra / Brother integration screen)
 *   - Terms of Service / Privacy Policy (legal copy modals)
 *
 * These render a placeholder sheet that explains the gap rather than
 * silently 404'ing.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LINKS } from "../../lib/links";
import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon, IconName } from "../../lib/nimbus/Icon";
import { layout, space, type } from "../../lib/nimbus/tokens";
import { usePermissions } from "../../lib/permissions";
import { clearCredentials, supabase } from "../../lib/supabase";
import { useTheme, useThemeToggle } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// TODO: if your project has lib/config.ts with APP_CONFIG, import that
// and remove this fallback. Keeping the hardcoded value avoids a build
// break if the import path differs across environments.
const APP_INFO = {
  productName: "Nautilus Inventory",
  clientName: "Nautilus Inventory",
  version: "1.0.0",
};

// Preference keys. `nimbus_pref_biometric` is also read by lib/auth.tsx to
// decide whether to offer the biometric fast-path on launch.
const PREF_BIOMETRIC = "nimbus_pref_biometric";
const PREF_NOTIFICATIONS = "nimbus_pref_notifications";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface WarehouseRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const T = useTheme();
  const toggleTheme = useThemeToggle();
  const wh = useWarehouse();
  const perms = usePermissions();

  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [role, setRole] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Sheet open state
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [facilitySheetOpen, setFacilitySheetOpen] = useState(false);
  const [placeholderSheet, setPlaceholderSheet] = useState<string | null>(null);

  // Hydrate persisted preferences. Biometric defaults to on (matches
  // lib/auth.tsx, which treats a missing value as enabled).
  useEffect(() => {
    (async () => {
      const [bio, notif] = await Promise.all([
        AsyncStorage.getItem(PREF_BIOMETRIC),
        AsyncStorage.getItem(PREF_NOTIFICATIONS),
      ]);
      setBiometricEnabled(bio !== "false");
      setNotificationsEnabled(notif !== "false");
    })();
  }, []);

  const loadProfile = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    setEmail(u.user.email ?? "");

    // profiles has no role column — role comes from org_members via the
    // warehouse context.
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", u.user.id)
      .maybeSingle();
    if (profile) {
      setFullName(profile.full_name ?? "");
      setPhone(profile.phone ?? "");
    }
    setRole(wh.userRole || null);
  }, [wh.userRole]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  function handleSignOut() {
    Alert.alert(
      "Sign out?",
      "You'll need to sign in again to access this facility.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            haptic.medium();
            // Clear the stored credentials + biometric fast-path first, so a
            // signed-out device can't be biometric-unlocked back into this
            // account (lib/auth.tsx reads these on launch).
            try {
              await clearCredentials();
              await AsyncStorage.setItem(PREF_BIOMETRIC, "false");
            } catch {}
            await supabase.auth.signOut();
          },
        },
      ]
    );
  }

  const initials = useMemo(() => {
    if (fullName) {
      return fullName
        .split(" ")
        .filter(Boolean)
        .map((p) => p[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return email ? email[0].toUpperCase() : "?";
  }, [fullName, email]);

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader eyebrow="Account" title="Settings" />

      <ScrollView contentContainerStyle={{ paddingBottom: space.s64 }}>
        {/* Profile — tap to edit */}
        <Pressable
          onPress={() => {
            haptic.light();
            setProfileEditOpen(true);
          }}
          style={({ pressed }) => [
            styles.profileRow,
            {
              backgroundColor: pressed ? T.surface2 : "transparent",
              borderBottomColor: T.borderSubtle,
            },
          ]}
          accessibilityLabel="Edit profile"
        >
          {/* Avatar — flat square (sharp corners per §1.1), accent border */}
          <View style={[styles.avatar, { borderColor: T.accent }]}>
            <Text
              style={[
                type.displayMd,
                {
                  color: T.accent,
                  fontFamily: type.monoBody.fontFamily,
                  fontSize: 18,
                },
              ]}
            >
              {initials}
            </Text>
          </View>

          <View style={styles.profileInfo}>
            <View style={styles.profileNameRow}>
              <Text
                style={[type.displayXs, { color: T.text }]}
                numberOfLines={1}
              >
                {fullName || "Unnamed user"}
              </Text>
              {role ? (
                <Text
                  style={[
                    type.labelSm,
                    {
                      color: T.accent,
                      letterSpacing: 1.5,
                      marginLeft: space.s8,
                    },
                  ]}
                >
                  {role.toUpperCase()}
                </Text>
              ) : null}
            </View>
            <Text
              style={[type.monoSm, { color: T.textMuted, marginTop: 2 }]}
              numberOfLines={1}
            >
              {email}
            </Text>
          </View>

          <Icon name="chevron-right" size={14} color={T.textDim} />
        </Pressable>

        {/* Facility */}
        <SectionTitle theme={T} label="FACILITY" />
        <View style={[styles.list, { borderColor: T.borderSubtle }]}>
          <SettingsRow
            theme={T}
            icon="map"
            label="Current facility"
            value={wh.warehouseName ?? "—"}
            onPress={() => {
              haptic.light();
              setFacilitySheetOpen(true);
            }}
            isLast
          />
        </View>

        {/* Preferences */}
        <SectionTitle theme={T} label="PREFERENCES" />
        <View style={[styles.list, { borderColor: T.borderSubtle }]}>
          <SettingsRow
            theme={T}
            icon="bell"
            label="Push notifications"
            trailing={
              <Switch
                value={notificationsEnabled}
                onValueChange={(v) => {
                  haptic.selection();
                  setNotificationsEnabled(v);
                  AsyncStorage.setItem(
                    PREF_NOTIFICATIONS,
                    v ? "true" : "false"
                  ).catch(() => {});
                }}
                trackColor={{ true: T.accent, false: T.borderSubtle }}
                thumbColor={T.text}
              />
            }
          />
          <SettingsRow
            theme={T}
            icon="fingerprint"
            label="Biometric unlock"
            trailing={
              <Switch
                value={biometricEnabled}
                onValueChange={(v) => {
                  haptic.selection();
                  setBiometricEnabled(v);
                  // Read by lib/auth.tsx on launch to gate the biometric path.
                  AsyncStorage.setItem(
                    PREF_BIOMETRIC,
                    v ? "true" : "false"
                  ).catch(() => {});
                }}
                trackColor={{ true: T.accent, false: T.borderSubtle }}
                thumbColor={T.text}
              />
            }
          />
          <SettingsRow
            theme={T}
            icon="settings"
            label={`Theme · ${T.mode === "dark" ? "Dark" : "Light"}`}
            onPress={() => {
              haptic.selection();
              toggleTheme();
            }}
            isLast
          />
        </View>

        {/* Workspace — manager and above only */}
        {perms?.canEditSettings ? (
          <>
            <SectionTitle theme={T} label="WORKSPACE" />
            <View style={[styles.list, { borderColor: T.borderSubtle }]}>
              <SettingsRow
                theme={T}
                icon="map"
                label="Manage facilities"
                onPress={() => {
                  haptic.light();
                  setPlaceholderSheet("facilities");
                }}
              />
              <SettingsRow
                theme={T}
                icon="package"
                label="Staff & permissions"
                onPress={() => {
                  haptic.light();
                  setPlaceholderSheet("staff");
                }}
              />
              <SettingsRow
                theme={T}
                icon="barcode"
                label="Label printing"
                onPress={() => {
                  haptic.light();
                  setPlaceholderSheet("labels");
                }}
                isLast
              />
            </View>
          </>
        ) : null}

        {/* About */}
        <SectionTitle theme={T} label="ABOUT" />
        <View style={[styles.list, { borderColor: T.borderSubtle }]}>
          <SpecRow theme={T} label="Platform" value={APP_INFO.productName} />
          <SpecRow theme={T} label="Workspace" value={APP_INFO.clientName} />
          <SpecRow
            theme={T}
            label="Version"
            value={APP_INFO.version}
            mono
            isLast
          />
        </View>

        {/* Support & legal */}
        <View
          style={[
            styles.list,
            { borderColor: T.borderSubtle, marginTop: space.s16 },
          ]}
        >
          <SettingsRow
            theme={T}
            icon="help-circle"
            label="Help & support"
            onPress={() => {
              haptic.light();
              Linking.openURL(LINKS.help).catch(() => {});
            }}
          />
          <SettingsRow
            theme={T}
            icon="clipboard-list"
            label="Terms of service"
            onPress={() => {
              haptic.light();
              setPlaceholderSheet("terms");
            }}
          />
          <SettingsRow
            theme={T}
            icon="clipboard-list"
            label="Privacy policy"
            onPress={() => {
              haptic.light();
              setPlaceholderSheet("privacy");
            }}
            isLast
          />
        </View>

        {/* Sign out */}
        <Pressable
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.signOut,
            {
              borderColor: T.danger,
              backgroundColor: pressed ? T.dangerDim : "transparent",
            },
          ]}
          accessibilityLabel="Sign out"
        >
          <Icon name="log-out" size={16} color={T.danger} />
          <Text
            style={[
              type.label,
              { color: T.danger, letterSpacing: 2, marginLeft: space.s8 },
            ]}
          >
            SIGN OUT
          </Text>
        </Pressable>
      </ScrollView>

      {/* Sub-sheets */}
      <ProfileEditSheet
        open={profileEditOpen}
        initialName={fullName}
        initialPhone={phone}
        onSaved={() => {
          setProfileEditOpen(false);
          loadProfile();
        }}
        onClose={() => setProfileEditOpen(false)}
        theme={T}
      />

      <FacilitySheet
        open={facilitySheetOpen}
        currentId={wh.warehouseId}
        onSelect={async (id) => {
          if (wh.switchWarehouse) {
            await wh.switchWarehouse(id);
          }
          setFacilitySheetOpen(false);
        }}
        onClose={() => setFacilitySheetOpen(false)}
        theme={T}
      />

      <PlaceholderSheet
        open={!!placeholderSheet}
        kind={placeholderSheet}
        onClose={() => setPlaceholderSheet(null)}
        theme={T}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({
  theme: T,
  label,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
}) {
  return (
    <Text
      style={[
        type.label,
        {
          color: T.textMuted,
          letterSpacing: 2,
          paddingHorizontal: layout.contentPaddingH,
          paddingTop: space.s32,
          paddingBottom: space.s12,
        },
      ]}
    >
      {label}
    </Text>
  );
}

function SettingsRow({
  theme: T,
  icon,
  label,
  value,
  onPress,
  trailing,
  isLast,
}: {
  theme: ReturnType<typeof useTheme>;
  icon: IconName;
  label: string;
  value?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  isLast?: boolean;
}) {
  const content = (
    <>
      <Icon name={icon} size={16} color={T.textMuted} />
      <Text
        style={[type.body, { color: T.text, flex: 1, fontSize: 14 }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {trailing ?? (
        <>
          {value ? (
            <Text
              style={[type.monoSm, { color: T.textMuted }]}
              numberOfLines={1}
            >
              {value}
            </Text>
          ) : null}
          {onPress ? (
            <Icon name="chevron-right" size={14} color={T.textDim} />
          ) : null}
        </>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.settingsRow,
          {
            backgroundColor: pressed ? T.surface2 : "transparent",
            borderBottomColor: T.borderFaint,
            borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
          },
        ]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View
      style={[
        styles.settingsRow,
        {
          borderBottomColor: T.borderFaint,
          borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
        },
      ]}
    >
      {content}
    </View>
  );
}

function SpecRow({
  theme: T,
  label,
  value,
  mono,
  isLast,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  value: string | null;
  mono?: boolean;
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        styles.specRow,
        {
          borderBottomColor: T.borderFaint,
          borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
        },
      ]}
    >
      <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}>
        {label.toUpperCase()}
      </Text>
      <Text
        style={[
          mono ? type.monoBody : type.body,
          {
            color: value ? T.text : T.textDim,
            maxWidth: "60%",
            textAlign: "right",
          },
        ]}
        numberOfLines={2}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE EDIT SHEET
// ─────────────────────────────────────────────────────────────────────────────

function ProfileEditSheet({
  open,
  initialName,
  initialPhone,
  onSaved,
  onClose,
  theme: T,
}: {
  open: boolean;
  initialName: string;
  initialPhone: string;
  onSaved: () => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setPhone(initialPhone);
    }
  }, [open, initialName, initialPhone]);

  async function commit() {
    if (!name.trim()) {
      Alert.alert("Name required");
      return;
    }
    setSaving(true);
    haptic.medium();
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) throw new Error("Not signed in");

      const { error: a } = await supabase.auth.updateUser({
        data: { full_name: name.trim() },
      });
      if (a) throw a;

      const { error: p } = await supabase
        .from("profiles")
        .update({
          full_name: name.trim(),
          phone: phone.trim() || null,
        })
        .eq("id", u.user.id);
      if (p) throw p;

      onSaved();
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[sheetStyles.wrap, { backgroundColor: T.bg }]}>
        <View
          style={[
            sheetStyles.topBar,
            {
              borderBottomColor: T.borderSubtle,
              paddingTop: insets.top || space.s16,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={[type.label, { color: T.textMuted }]}>CANCEL</Text>
          </Pressable>
          <Text style={[type.displayXs, { color: T.text }]}>Profile</Text>
          <Pressable onPress={commit} disabled={saving} hitSlop={10}>
            <Text
              style={[type.label, { color: saving ? T.textDim : T.accent }]}
            >
              {saving ? "SAVING…" : "SAVE"}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: layout.contentPaddingH,
            gap: space.s20,
          }}
        >
          <Field theme={T} label="Name">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Full name"
              placeholderTextColor={T.textDim}
              autoCapitalize="words"
              style={[type.body, { color: T.text, padding: 0 }]}
            />
          </Field>
          <Field theme={T} label="Phone">
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Optional"
              placeholderTextColor={T.textDim}
              keyboardType="phone-pad"
              style={[type.monoBody, { color: T.text, padding: 0 }]}
            />
          </Field>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FACILITY SHEET — list of accessible warehouses, tap to switch
// ─────────────────────────────────────────────────────────────────────────────

function FacilitySheet({
  open,
  currentId,
  onSelect,
  onClose,
  theme: T,
}: {
  open: boolean;
  currentId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from("warehouses")
      .select("id, name, city, state")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setWarehouses(data as unknown as WarehouseRow[]);
        setLoading(false);
      });
  }, [open]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={[sheetStyles.backdrop, { backgroundColor: T.modalBackdrop }]}
      >
        <Pressable
          onPress={() => {}}
          style={[
            sheetStyles.bottomSheet,
            {
              backgroundColor: T.bgElevated,
              borderTopColor: T.borderSubtle,
              paddingBottom: insets.bottom + space.s16,
            },
          ]}
        >
          <View style={sheetStyles.bottomHeader}>
            <Text
              style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}
            >
              SWITCH FACILITY
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="x" size={16} color={T.textMuted} />
            </Pressable>
          </View>

          {warehouses.map((w, i) => {
            const isCurrent = w.id === currentId;
            const isLast = i === warehouses.length - 1;
            return (
              <Pressable
                key={w.id}
                onPress={() => {
                  haptic.selection();
                  onSelect(w.id);
                }}
                style={({ pressed }) => [
                  sheetStyles.facilityRow,
                  {
                    backgroundColor: pressed ? T.surface2 : "transparent",
                    borderBottomColor: T.borderFaint,
                    borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      type.bodyLg,
                      { color: isCurrent ? T.accent : T.text, fontSize: 15 },
                    ]}
                  >
                    {w.name}
                  </Text>
                  {w.city || w.state ? (
                    <Text
                      style={[
                        type.monoSm,
                        { color: T.textMuted, marginTop: 2 },
                      ]}
                    >
                      {[w.city, w.state].filter(Boolean).join(", ")}
                    </Text>
                  ) : null}
                </View>
                {isCurrent ? (
                  <Icon name="check" size={16} color={T.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER SHEET — for sub-modals not yet migrated
// ─────────────────────────────────────────────────────────────────────────────

const PLACEHOLDER_COPY: Record<string, { title: string; description: string }> =
  {
    facilities: {
      title: "Manage facilities",
      description:
        "The full warehouse CRUD flow (rename, address, contact, deactivate) lives on the desktop dashboard. Mobile facility management is queued for a focused migration round.",
    },
    staff: {
      title: "Staff & permissions",
      description:
        "Invite staff, change roles, and manage warehouse_access from the desktop dashboard at /settings/staff. Mobile staff management is queued for a focused migration round.",
    },
    labels: {
      title: "Label printing",
      description:
        "Zebra and Brother printer setup, label templates, and bulk print runs are queued for a focused migration round.",
    },
    terms: {
      title: "Terms of service",
      description:
        "View the latest terms on the web at nautilusinventory.com/legal/terms.",
    },
    privacy: {
      title: "Privacy policy",
      description:
        "View the latest policy on the web at nautilusinventory.com/legal/privacy.",
    },
  };

function PlaceholderSheet({
  open,
  kind,
  onClose,
  theme: T,
}: {
  open: boolean;
  kind: string | null;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();
  const copy = kind ? PLACEHOLDER_COPY[kind] : null;

  return (
    <Modal
      visible={open && !!copy}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[sheetStyles.wrap, { backgroundColor: T.bg }]}>
        <View
          style={[
            sheetStyles.topBar,
            {
              borderBottomColor: T.borderSubtle,
              paddingTop: insets.top || space.s16,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={[type.label, { color: T.textMuted }]}>CLOSE</Text>
          </Pressable>
          <Text style={[type.displayXs, { color: T.text }]} numberOfLines={1}>
            {copy?.title ?? ""}
          </Text>
          <View style={{ width: 60 }} />
        </View>

        <View
          style={{ padding: layout.contentPaddingH, paddingTop: space.s32 }}
        >
          <Text
            style={[
              type.label,
              { color: T.textMuted, letterSpacing: 2, marginBottom: space.s12 },
            ]}
          >
            NOT YET ON MOBILE
          </Text>
          <Text
            style={[type.body, { color: T.text, fontSize: 15, lineHeight: 22 }]}
          >
            {copy?.description ?? ""}
          </Text>

          {(kind === "terms" || kind === "privacy") && (
            <Pressable
              onPress={() => {
                const url = kind === "terms" ? LINKS.terms : LINKS.privacy;
                Linking.openURL(url).catch(() => {});
              }}
              style={({ pressed }) => [
                sheetStyles.linkBtn,
                {
                  borderColor: T.borderSubtle,
                  backgroundColor: pressed ? T.surface2 : "transparent",
                  marginTop: space.s24,
                },
              ]}
            >
              <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
                OPEN ON WEB
              </Text>
              <Icon name="chevron-right" size={14} color={T.accent} />
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD WRAPPER (shared with ProfileEditSheet)
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  theme: T,
  label,
  children,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text
        style={[
          type.labelSm,
          { color: T.textMuted, letterSpacing: 2, marginBottom: space.s8 },
        ]}
      >
        {label.toUpperCase()}
      </Text>
      <View
        style={[
          {
            borderWidth: layout.hairlineWidth,
            borderColor: T.borderSubtle,
            backgroundColor: T.bgElevated,
            paddingHorizontal: space.s12,
            paddingVertical: space.s12,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // Profile row
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s16,
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s20,
    borderBottomWidth: layout.hairlineWidth,
  },
  avatar: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    // SHARP corners per §1.1
  },
  profileInfo: {
    flex: 1,
  },
  profileNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  // List + rows
  list: {
    marginHorizontal: layout.contentPaddingH,
    borderWidth: layout.hairlineWidth,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingHorizontal: space.s12,
    paddingVertical: space.s16,
    minHeight: 52,
  },
  specRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
    minHeight: 44,
  },

  // Sign out
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: layout.contentPaddingH,
    marginTop: space.s32,
    paddingVertical: space.s16,
    borderWidth: 1,
  },
});

const sheetStyles = StyleSheet.create({
  wrap: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s12,
    borderBottomWidth: layout.hairlineWidth,
  },

  // Bottom-sheet (facility picker)
  backdrop: { flex: 1, justifyContent: "flex-end" },
  bottomSheet: {
    borderTopWidth: layout.hairlineWidth,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s16,
  },
  bottomHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: space.s12,
  },
  facilityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.s16,
  },

  // Placeholder linkout
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s16,
    paddingVertical: space.s16,
    borderWidth: layout.hairlineWidth,
  },
});
