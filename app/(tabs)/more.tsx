/**
 * More — secondary navigation.
 *
 * Tab #4 in the bottom bar (Home · Inventory · Orders · More). Routes
 * to surfaces that aren't worth a tab slot of their own. Per Option A
 * IA decision.
 *
 * Order is by daily-relevance to a floor operator:
 *   1. Map           → /map                (inside (tabs)/, hidden via href:null)
 *   2. Purchase orders → /purchase-orders  (queue + create + detail/receive)
 *   3. Returns       → /returns            (list + log form sheet)
 *   4. Notifications → /notifications      (activity feed)
 *   5. Analytics     → /analytics
 *   6. Settings      → /settings           (inside (tabs)/, hidden via href:null)
 *   ──────
 *   Sign out         → confirmation alert + supabase.auth.signOut
 */

import { useRouter } from "expo-router";
import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon, IconName } from "../../lib/nimbus/Icon";
import { layout, space, type } from "../../lib/nimbus/tokens";
import { Permissions, usePermissions } from "../../lib/permissions";
import { signOutDevice } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────

interface MoreItem {
  icon: IconName;
  label: string;
  hint?: string;
  route?: string;
  comingSoon?: boolean;
  // If set, the item is only shown when the current role has this permission.
  requires?: keyof Permissions;
}

const ITEMS: MoreItem[] = [
  {
    icon: "map",
    label: "Map",
    hint: "Facility floor layout",
    route: "/map",
  },
  {
    icon: "package",
    label: "Pick waves",
    hint: "Run released waves — batch picking",
    route: "/waves",
  },
  {
    icon: "clipboard-list",
    label: "Purchase orders",
    hint: "Inbound shipments and receive runs",
    route: "/purchase-orders",
  },
  {
    icon: "truck",
    label: "Inbound (ASN)",
    hint: "Receive shipments by line or pallet LPN",
    route: "/inbound",
  },
  {
    icon: "check",
    label: "Cycle counts",
    hint: "Scheduled blind counts for this facility",
    route: "/cycle-counts",
  },
  {
    icon: "layout-grid",
    label: "Work orders",
    hint: "Assemble kits and complete builds",
    route: "/work-orders",
  },
  {
    icon: "rotate-ccw",
    label: "Returns",
    hint: "Log, restock and review returns",
    route: "/returns",
  },
  {
    icon: "bell",
    label: "Notifications",
    hint: "Alerts and recent activity",
    route: "/notifications",
  },
  {
    icon: "bar-chart-3",
    label: "Analytics",
    hint: "Reports and workspace metrics",
    route: "/analytics",
    requires: "canViewReports",
  },
  {
    icon: "settings",
    label: "Settings",
    hint: "Account, facility, preferences",
    route: "/settings",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const T = useTheme();
  const router = useRouter();
  const { warehouseName } = useWarehouse();
  const perms = usePermissions();
  const items = ITEMS.filter((it) => !it.requires || perms[it.requires]);

  function handleNav(item: MoreItem) {
    haptic.light();
    if (item.comingSoon) {
      Alert.alert(
        "Coming soon",
        `${item.label} is queued for a focused migration round. Use the desktop dashboard for now.`
      );
      return;
    }
    if (item.route) router.push(item.route as any);
  }

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
            // Scrubs the offline queue + caches too — shared-scanner safety.
            await signOutDevice();
          },
        },
      ]
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={warehouseName ? `Facility · ${warehouseName}` : undefined}
        title="More"
      />

      <ScrollView contentContainerStyle={{ paddingBottom: space.s64 }}>
        <View style={[styles.list, { borderColor: T.borderSubtle }]}>
          {items.map((item, idx) => {
            const isLast = idx === items.length - 1;
            return (
              <Pressable
                key={item.label}
                onPress={() => handleNav(item)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? T.surface2 : "transparent",
                    borderBottomColor: T.borderFaint,
                    borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
                  },
                ]}
                accessibilityLabel={item.label}
              >
                <View style={styles.iconWrap}>
                  <Icon
                    name={item.icon}
                    size={18}
                    color={item.comingSoon ? T.textDim : T.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      type.bodyLg,
                      {
                        color: item.comingSoon ? T.textDim : T.text,
                        fontSize: 15,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text
                      style={[
                        type.bodySm,
                        { color: T.textMuted, marginTop: 2, fontSize: 12 },
                      ]}
                    >
                      {item.hint}
                    </Text>
                  ) : null}
                </View>
                {item.comingSoon ? (
                  <Text
                    style={[
                      type.labelSm,
                      { color: T.textDim, letterSpacing: 1.5 },
                    ]}
                  >
                    SOON
                  </Text>
                ) : (
                  <Icon name="chevron-right" size={14} color={T.textDim} />
                )}
              </Pressable>
            );
          })}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  list: {
    marginHorizontal: layout.contentPaddingH,
    marginTop: space.s16,
    borderWidth: layout.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingHorizontal: space.s12,
    paddingVertical: space.s16,
    minHeight: 64,
  },
  iconWrap: {
    width: 24,
    alignItems: "center",
  },

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
