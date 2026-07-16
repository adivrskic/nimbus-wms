/**
 * Home — Nimbus rebuild.
 *
 * Replaces app/(tabs)/index.tsx. The old screen had a 240px → 98px
 * collapsing animated header with greeting copy ("Hi, Name") and a
 * warehouse picker. Per §8.4 mobile chrome (and §11.6 voice — no warm
 * greetings, the data is the message), it's now:
 *
 *   - Static 56px ScreenHeader with the facility name as eyebrow
 *   - KPI strip pulling from the get_warehouse_stats(wh_id) RPC we
 *     migrated to nimbus-wms
 *   - Active orders summary row (tap → Orders tab)
 *   - Recent activity — last 10 scan_history rows with action badge
 *     and relative time
 *
 * No quick-jump tiles — those overlap the tab bar's job. The home
 * screen earns its slot by being the first read for shift state, not
 * by being a launcher.
 *
 * Stats refresh on focus (e.g. coming back from Inventory).
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon } from "../../lib/nimbus/Icon";
import { layout, space, type } from "../../lib/nimbus/tokens";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type ScanAction =
  | "register"
  | "locate"
  | "relocate"
  | "pick"
  | "receive"
  | "return"
  | "cycle_count"
  | "adjust";

interface Stats {
  total_products: number;
  total_stock: number;
  total_sections: number;
  low_stock_count: number;
  items_received_today: number;
  active_orders: number;
}

interface RecentScan {
  id: string;
  action: ScanAction;
  scanned_at: string | null;
  notes: string | null;
  quantity: number | null;
  products: { id: string; name: string; barcode: string } | null;
}

const SCAN_LABEL: Record<ScanAction, string> = {
  register: "REGISTERED",
  locate: "LOCATED",
  relocate: "RELOCATED",
  pick: "PICKED",
  receive: "RECEIVED",
  return: "RETURNED",
  cycle_count: "COUNTED",
  adjust: "ADJUSTED",
};

function scanTone(action: ScanAction, T: ReturnType<typeof useTheme>): string {
  switch (action) {
    case "register":
    case "receive":
      return T.success;
    case "pick":
      return T.warning;
    case "return":
      return T.danger;
    case "adjust":
    case "cycle_count":
      return T.info;
    case "relocate":
    case "locate":
    default:
      return T.accent;
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const T = useTheme();
  const router = useRouter();
  const { warehouseId, warehouseName } = useWarehouse();

  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Ref, not a dep — a `refreshing` dependency recreated `load` per
  // pull-to-refresh and re-fired the focus effect (2-3 fetches per refresh).
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  const load = useCallback(async () => {
    if (!warehouseId) return;
    if (!refreshingRef.current) setLoading(true);

    const [statsRes, scansRes] = await Promise.all([
      // Legacy helper — lives in the `public` schema, not `app`, so the
      // default-schema client would 404 it without the explicit override.
      supabase.schema("public").rpc("get_warehouse_stats", { wh_id: warehouseId }),
      supabase
        .from("scan_history")
        .select(
          "id, action, scanned_at, notes, quantity, products(id, name, barcode)"
        )
        .eq("warehouse_id", warehouseId)
        .order("scanned_at", { ascending: false })
        .limit(10),
    ]);

    if (statsRes.data && statsRes.data[0]) {
      setStats(statsRes.data[0] as unknown as Stats);
    }
    if (scansRes.data) {
      setRecent(scansRes.data as unknown as RecentScan[]);
    }

    setLoading(false);
    setRefreshing(false);
  }, [warehouseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const lowStock = stats?.low_stock_count ?? 0;
  const lowStockTone =
    lowStock > 10 ? "danger" : lowStock > 0 ? "warning" : "neutral";

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={warehouseName ? `Facility · ${warehouseName}` : undefined}
        title="Home"
      />

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={T.accent}
            onRefresh={() => {
              setRefreshing(true);
              haptic.light();
              load();
            }}
          />
        }
      >
        {loading && !stats ? (
          <View style={styles.center}>
            <ActivityIndicator color={T.accent} size="small" />
          </View>
        ) : (
          <>
            {/* KPI strip — 4 cards across, hairline grid */}
            <View
              style={[
                styles.kpiGrid,
                {
                  borderTopColor: T.borderSubtle,
                  borderBottomColor: T.borderSubtle,
                },
              ]}
            >
              <Kpi
                theme={T}
                label="PRODUCTS"
                value={(stats?.total_products ?? 0).toLocaleString()}
              />
              <View
                style={[styles.kpiDivider, { backgroundColor: T.borderSubtle }]}
              />
              <Kpi
                theme={T}
                label="ON HAND"
                value={(stats?.total_stock ?? 0).toLocaleString()}
                unit="units"
              />
              <View
                style={[styles.kpiDivider, { backgroundColor: T.borderSubtle }]}
              />
              <Kpi
                theme={T}
                label="LOW STOCK"
                value={String(lowStock)}
                tone={lowStockTone}
              />
              <View
                style={[styles.kpiDivider, { backgroundColor: T.borderSubtle }]}
              />
              <Kpi
                theme={T}
                label="SCANS"
                value={String(stats?.items_received_today ?? 0)}
                unit="today"
              />
            </View>

            {/* Active orders row */}
            <Pressable
              onPress={() => {
                haptic.light();
                router.push("/orders" as any);
              }}
              style={({ pressed }) => [
                styles.activeOrdersRow,
                {
                  backgroundColor: pressed ? T.surface2 : "transparent",
                  borderBottomColor: T.borderSubtle,
                },
              ]}
              accessibilityLabel="Open orders queue"
            >
              <View style={styles.activeOrdersLeft}>
                <Icon name="clipboard-list" size={18} color={T.textMuted} />
                <View>
                  <Text
                    style={[
                      type.labelSm,
                      { color: T.textMuted, letterSpacing: 1.5 },
                    ]}
                  >
                    ACTIVE ORDERS
                  </Text>
                  <Text
                    style={[
                      type.displayMd,
                      {
                        color: T.text,
                        fontFamily: type.monoBody.fontFamily,
                        fontSize: 22,
                        marginTop: 2,
                      },
                    ]}
                  >
                    {String(stats?.active_orders ?? 0).padStart(2, "0")}
                  </Text>
                </View>
              </View>
              <Icon name="chevron-right" size={14} color={T.textDim} />
            </Pressable>

            {/* Recent activity */}
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
              RECENT ACTIVITY
            </Text>
            {recent.length === 0 ? (
              <Text
                style={[
                  type.bodySm,
                  {
                    color: T.textDim,
                    paddingHorizontal: layout.contentPaddingH,
                    paddingVertical: space.s24,
                    textAlign: "center",
                  },
                ]}
              >
                Nothing scanned yet today.
              </Text>
            ) : (
              <View style={[styles.list, { borderColor: T.borderSubtle }]}>
                {recent.map((scan, idx) => {
                  const isLast = idx === recent.length - 1;
                  const tone = scanTone(scan.action, T);
                  return (
                    <Pressable
                      key={scan.id}
                      onPress={() => {
                        if (scan.products?.id) {
                          haptic.light();
                          router.push(`/product/${scan.products.id}` as any);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.scanRow,
                        {
                          backgroundColor: pressed ? T.surface2 : "transparent",
                          borderBottomColor: T.borderFaint,
                          borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          type.labelSm,
                          {
                            color: tone,
                            width: 80,
                            letterSpacing: 1.5,
                          },
                        ]}
                      >
                        {SCAN_LABEL[scan.action]}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[type.body, { color: T.text, fontSize: 14 }]}
                          numberOfLines={1}
                        >
                          {scan.products?.name ?? "Unknown product"}
                        </Text>
                        {scan.notes ? (
                          <Text
                            style={[
                              type.monoSm,
                              { color: T.textDim, marginTop: 2 },
                            ]}
                            numberOfLines={1}
                          >
                            {scan.notes}
                          </Text>
                        ) : scan.quantity != null ? (
                          <Text
                            style={[
                              type.monoSm,
                              { color: T.textDim, marginTop: 2 },
                            ]}
                          >
                            qty {scan.quantity}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          type.monoSm,
                          { color: T.textDim, letterSpacing: 0.5 },
                        ]}
                      >
                        {formatRelative(scan.scanned_at)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Bottom spacer so FAB doesn't sit on last row */}
            <View style={{ height: space.s120 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI CARD
// ─────────────────────────────────────────────────────────────────────────────

function Kpi({
  theme: T,
  label,
  value,
  unit,
  tone = "neutral",
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  value: string;
  unit?: string;
  tone?: "neutral" | "warning" | "danger";
}) {
  const valueColor =
    tone === "danger" ? T.danger : tone === "warning" ? T.warning : T.text;
  return (
    <View style={styles.kpi}>
      <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}>
        {label}
      </Text>
      <Text
        style={[
          type.displayLg,
          {
            color: valueColor,
            fontFamily: type.monoBody.fontFamily,
            fontSize: 22,
            marginTop: 4,
          },
        ]}
      >
        {value}
      </Text>
      {unit ? (
        <Text
          style={[
            type.labelSm,
            { color: T.textDim, marginTop: 2, letterSpacing: 1.5 },
          ]}
        >
          {unit.toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingBottom: space.s32 },
  center: {
    paddingVertical: space.s64,
    alignItems: "center",
  },

  kpiGrid: {
    flexDirection: "row",
    borderTopWidth: layout.hairlineWidth,
    borderBottomWidth: layout.hairlineWidth,
  },
  kpi: {
    flex: 1,
    paddingVertical: space.s16,
    paddingHorizontal: space.s8,
    alignItems: "flex-start",
  },
  kpiDivider: {
    width: layout.hairlineWidth,
  },

  activeOrdersRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s16,
    borderBottomWidth: layout.hairlineWidth,
  },
  activeOrdersLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s16,
  },

  list: {
    marginHorizontal: layout.contentPaddingH,
    borderWidth: layout.hairlineWidth,
  },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
    minHeight: 52,
  },
});
