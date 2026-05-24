/**
 * Tab bar layout — Option A IA (locked in after feature-gap audit).
 *
 *   Visible tabs:  Home · Inventory · Orders · More
 *   Hidden routes: Scanner (reached via FAB)
 *                  Map (reached from More — to be moved out of (tabs)
 *                       eventually for proper stack behavior)
 *                  Settings (same — eventual move target)
 *
 * Differs from phase 1 only in the tab set. The bar chrome (56px height,
 * hairline top, flat fill, 64×64 gold scan FAB bottom-right) is identical.
 *
 * Followup migration: map.tsx, settings.tsx, and analytics.tsx should move
 * from app/(tabs)/ to app/ root so they get proper stack push/pop and a
 * back button. Hidden-tab routing works for now but the back gesture is
 * awkward — tapping back from a hidden tab jumps to the parent group, not
 * to More. Defer to phase 2.2.
 */

import { Tabs } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, IconName } from "../../lib/nimbus/Icon";
import { layout, type } from "../../lib/nimbus/tokens";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";

// ─────────────────────────────────────────────────────────────────────────────
// TAB BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function TabButton({
  label,
  iconName,
  isFocused,
  onPress,
  accent,
  muted,
}: {
  label: string;
  iconName: IconName;
  isFocused: boolean;
  onPress: () => void;
  accent: string;
  muted: string;
}) {
  const fg = isFocused ? accent : muted;
  return (
    <Pressable
      onPress={onPress}
      style={styles.tabBtn}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={label}
    >
      {isFocused ? (
        <View
          style={[styles.activeRule, { backgroundColor: accent }]}
          pointerEvents="none"
        />
      ) : null}
      <Icon name={iconName} size={20} color={fg} />
      <Text
        style={[type.labelSm, { color: fg, marginTop: 4, letterSpacing: 1.2 }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN FAB — 64×64 sharp square, gold fill, white barcode glyph
// ─────────────────────────────────────────────────────────────────────────────

function ScanFab({
  bottomInset,
  accent,
  onPress,
  onLongPress,
}: {
  bottomInset: number;
  accent: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        haptic.medium();
        onPress();
      }}
      onLongPress={() => {
        haptic.heavy();
        onLongPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel="Open scanner"
      style={({ pressed }) => [
        styles.fab,
        {
          right: layout.scanFabOffsetRight,
          bottom: bottomInset + layout.scanFabOffsetBottom,
          backgroundColor: accent,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Icon name="barcode" size={28} color="#ffffff" strokeWidth={1.75} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM TAB BAR
// ─────────────────────────────────────────────────────────────────────────────

type TabKey = "index" | "inventory" | "orders" | "more";

const TAB_META: Record<TabKey, { label: string; iconName: IconName }> = {
  index: { label: "Home", iconName: "home" },
  inventory: { label: "Inventory", iconName: "package" },
  orders: { label: "Orders", iconName: "clipboard-list" },
  more: { label: "More", iconName: "more-horizontal" },
};

// Order matters — drives left-to-right tab arrangement.
const TAB_ORDER: TabKey[] = ["index", "inventory", "orders", "more"];

function CustomTabBar({ state, navigation }: any) {
  const T = useTheme();
  const insets = useSafeAreaInsets();

  // Filter + order: only TAB_ORDER routes render as buttons, in that order.
  const visibleRoutes = TAB_ORDER.map((name) =>
    state.routes.find((r: any) => r.name === name)
  ).filter(Boolean);

  function navigateToScanner() {
    const scanRoute = state.routes.find((r: any) => r.name === "scanner");
    if (!scanRoute) return;
    const event = navigation.emit({
      type: "tabPress",
      target: scanRoute.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) navigation.navigate("scanner");
  }

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: T.bg,
            borderTopColor: T.borderSubtle,
            paddingBottom: insets.bottom,
            height: layout.tabBarHeight + insets.bottom,
          },
        ]}
      >
        <View style={styles.row}>
          {visibleRoutes.map((route: any) => {
            const meta = TAB_META[route.name as TabKey];
            const focusedRoute = state.routes[state.index];
            const isFocused = focusedRoute?.name === route.name;

            const onPress = () => {
              haptic.light();
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <TabButton
                key={route.key}
                label={meta.label}
                iconName={meta.iconName}
                isFocused={isFocused}
                onPress={onPress}
                accent={T.accent}
                muted={T.textMuted}
              />
            );
          })}
        </View>
      </View>

      <ScanFab
        bottomInset={insets.bottom}
        accent={T.accent}
        onPress={navigateToScanner}
        onLongPress={() => {
          // TODO(redesign-phase-2): wire to the AI modal once extracted.
        }}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT
// ─────────────────────────────────────────────────────────────────────────────

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="inventory" options={{ title: "Inventory" }} />
      <Tabs.Screen name="orders" options={{ title: "Orders" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />

      {/* Hidden routes — still routable, just not surfaced in the bar. */}
      <Tabs.Screen name="scanner" options={{ href: null, title: "Scanner" }} />
      <Tabs.Screen name="map" options={{ href: null, title: "Map" }} />
      <Tabs.Screen
        name="settings"
        options={{ href: null, title: "Settings" }}
      />
    </Tabs>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: layout.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    height: layout.tabBarHeight,
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  activeRule: {
    position: "absolute",
    top: 0,
    left: "25%",
    right: "25%",
    height: 1,
  },
  fab: {
    position: "absolute",
    width: layout.scanFabSize,
    height: layout.scanFabSize,
    alignItems: "center",
    justifyContent: "center",
    // SHARP corners — no borderRadius, per §1.1.
  },
});
