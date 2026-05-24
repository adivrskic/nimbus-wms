/**
 * Orders — queue view.
 *
 * Replaces the phase-1 stub. Shows orders for the current warehouse,
 * filterable by status, sorted by delivery date (most urgent first).
 *
 * Per the feature-gap audit: this is the surface that closes the "orders
 * flow in from the mobile pick app" loop — operators see their queue
 * here, tap an order to open detail, then start a pick run from there.
 *
 * Schema (nimbus-wms verified):
 *   - orders: id, order_number, order_type, status, customer_name,
 *     delivery_date, delivery_window, assigned_to, warehouse_id, …
 *   - order_items: order_id, quantity_requested, quantity_picked, …
 *
 * Status filter strip uses the same §7.13 tab pattern as Inventory's
 * category strip — mono caps with 2px gold underline on active.
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
// TYPES + CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

type OrderStatus =
  | "created"
  | "pick_list_assigned"
  | "in_progress"
  | "staged"
  | "ready"
  | "out_for_delivery"
  | "complete"
  | "cancelled";

type OrderType =
  | "installer_job"
  | "customer_pickup"
  | "internal_transfer"
  | "restock";

interface OrderRow {
  id: string;
  order_number: string | null;
  order_type: OrderType;
  status: OrderStatus;
  customer_name: string | null;
  delivery_date: string | null;
  delivery_window: string | null;
  assigned_to: string | null;
  created_at: string | null;
  order_items: { count: number } | { count: number }[] | null;
}

const TYPE_LABEL: Record<OrderType, string> = {
  installer_job: "INSTALL",
  customer_pickup: "PICKUP",
  internal_transfer: "TRANSFER",
  restock: "RESTOCK",
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  created: "CREATED",
  pick_list_assigned: "ASSIGNED",
  in_progress: "PICKING",
  staged: "STAGED",
  ready: "READY",
  out_for_delivery: "IN TRANSIT",
  complete: "COMPLETE",
  cancelled: "CANCELLED",
};

const ACTIVE_STATUSES: OrderStatus[] = [
  "created",
  "pick_list_assigned",
  "in_progress",
  "staged",
  "ready",
  "out_for_delivery",
];

const FILTERS: {
  key: string;
  label: string;
  statuses: OrderStatus[] | null;
}[] = [
  { key: "active", label: "ACTIVE", statuses: ACTIVE_STATUSES },
  { key: "all", label: "ALL", statuses: null },
  {
    key: "picking",
    label: "PICKING",
    statuses: ["pick_list_assigned", "in_progress"],
  },
  { key: "ready", label: "READY", statuses: ["staged", "ready"] },
  { key: "transit", label: "TRANSIT", statuses: ["out_for_delivery"] },
  { key: "complete", label: "COMPLETE", statuses: ["complete"] },
];

function statusTone(
  status: OrderStatus,
  T: ReturnType<typeof useTheme>
): string {
  switch (status) {
    case "created":
      return T.textMuted;
    case "pick_list_assigned":
      return T.info;
    case "in_progress":
      return T.warning;
    case "staged":
      return T.warning;
    case "ready":
      return T.accent;
    case "out_for_delivery":
      return T.info;
    case "complete":
      return T.success;
    case "cancelled":
      return T.textDim;
  }
}

function deliveryDateLabel(iso: string | null): string {
  if (!iso) return "NO DATE";
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "TODAY";
  if (days === 1) return "TOMORROW";
  if (days < 0) return `${Math.abs(days)}D LATE`;
  if (days < 7)
    return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

function deliveryUrgency(
  iso: string | null,
  T: ReturnType<typeof useTheme>
): string {
  if (!iso) return T.textDim;
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return T.danger;
  if (days === 0) return T.warning;
  if (days === 1) return T.accent;
  return T.textMuted;
}

function itemCount(o: OrderRow): number {
  if (!o.order_items) return 0;
  const arr = Array.isArray(o.order_items) ? o.order_items : [o.order_items];
  return arr.reduce((sum, x) => sum + (x?.count ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function OrdersScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState("active");
  const [mineOnly, setMineOnly] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    if (!wh.warehouseId) return;
    if (!refreshing) setLoading(true);

    if (!currentUserId) {
      const { data: u } = await supabase.auth.getUser();
      if (u?.user?.id) setCurrentUserId(u.user.id);
    }

    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_number, order_type, status, customer_name, delivery_date, delivery_window, assigned_to, created_at, order_items(count)"
      )
      .eq("warehouse_id", wh.warehouseId)
      .order("delivery_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (data) setOrders(data as unknown as OrderRow[]);
    setLoading(false);
    setRefreshing(false);
  }, [wh.warehouseId, refreshing, currentUserId]);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === activeFilter) ?? FILTERS[0];
    return orders.filter((o) => {
      if (f.statuses && !f.statuses.includes(o.status)) return false;
      if (mineOnly && o.assigned_to !== currentUserId) return false;
      return true;
    });
  }, [orders, activeFilter, mineOnly, currentUserId]);

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Flow"}
        title="Orders"
      />

      {/* Status filter strip — §7.13 tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
        style={{ borderBottomWidth: 1, borderBottomColor: T.borderSubtle }}
      >
        {FILTERS.map((f) => {
          const isActive = activeFilter === f.key;
          const count = !f.statuses
            ? orders.length
            : orders.filter((o) => f.statuses!.includes(o.status)).length;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                haptic.selection();
                setActiveFilter(f.key);
              }}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <View style={styles.tabInner}>
                <Text
                  style={[
                    type.label,
                    {
                      color: isActive ? T.accent : T.textMuted,
                      letterSpacing: 2,
                    },
                  ]}
                >
                  {f.label}
                </Text>
                <Text
                  style={[
                    type.labelSm,
                    { color: isActive ? T.accent : T.textDim, marginLeft: 6 },
                  ]}
                >
                  {count}
                </Text>
              </View>
              {isActive ? (
                <View
                  style={[styles.tabRule, { backgroundColor: T.accent }]}
                  pointerEvents="none"
                />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Meta row — count + Mine toggle */}
      <View style={[styles.metaRow, { borderBottomColor: T.borderSubtle }]}>
        <Text style={[type.labelSm, { color: T.textMuted }]}>
          Showing <Text style={{ color: T.text }}>{filtered.length}</Text>
          {filtered.length !== orders.length ? <> of {orders.length}</> : null}
        </Text>
        <Pressable
          onPress={() => {
            haptic.selection();
            setMineOnly((m) => !m);
          }}
          style={styles.mineBtn}
        >
          <Text
            style={[
              type.labelSm,
              { color: mineOnly ? T.accent : T.textMuted, letterSpacing: 1.5 },
            ]}
          >
            {mineOnly ? "MINE · ON" : "MINE · OFF"}
          </Text>
        </Pressable>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}
          >
            NO ORDERS · 00
          </Text>
          <Text
            style={[
              type.bodyLg,
              {
                color: T.text,
                marginTop: space.s8,
                textAlign: "center",
                fontSize: 16,
              },
            ]}
          >
            Nothing in this view
          </Text>
          <Text
            style={[
              type.bodySm,
              {
                color: T.textMuted,
                marginTop: space.s8,
                textAlign: "center",
                maxWidth: 280,
                lineHeight: 20,
              },
            ]}
          >
            Orders flow in from the dashboard, Shopify imports, and CSV uploads.
            They'll appear here ranked by delivery date.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <OrderRowCard
              order={item}
              theme={T}
              onPress={() => {
                haptic.light();
                router.push(`/order/${item.id}` as any);
              }}
            />
          )}
          contentContainerStyle={{ paddingBottom: 140 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={T.accent}
              onRefresh={() => {
                setRefreshing(true);
                haptic.light();
                loadOrders();
              }}
            />
          }
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER ROW
// ─────────────────────────────────────────────────────────────────────────────

function OrderRowCard({
  order,
  theme: T,
  onPress,
}: {
  order: OrderRow;
  theme: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  const items = itemCount(order);
  const tone = statusTone(order.status, T);
  const urgency = deliveryUrgency(order.delivery_date, T);

  // 4px left border for late orders — §9.5 alert escalation
  const leftBorderColor =
    order.delivery_date &&
    new Date(order.delivery_date) < new Date(new Date().setHours(0, 0, 0, 0)) &&
    order.status !== "complete" &&
    order.status !== "cancelled"
      ? T.danger
      : "transparent";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? T.surface2 : "transparent",
          borderBottomColor: T.borderFaint,
          borderLeftColor: leftBorderColor,
          borderLeftWidth: 4,
        },
      ]}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text
            style={[
              type.monoBody,
              { color: T.accent, fontSize: 15, letterSpacing: -0.3 },
            ]}
          >
            {order.order_number ?? order.id.slice(0, 8).toUpperCase()}
          </Text>
          <Text style={[type.labelSm, { color: tone, letterSpacing: 1.5 }]}>
            {STATUS_LABEL[order.status]}
          </Text>
        </View>

        <Text
          style={[type.bodyLg, { color: T.text, marginTop: 4, fontSize: 15 }]}
          numberOfLines={1}
        >
          {order.customer_name ?? "—"}
        </Text>

        <View style={styles.rowBottom}>
          <Text
            style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}
          >
            {TYPE_LABEL[order.order_type]}
          </Text>
          <Text style={[type.labelSm, { color: T.textDim }]}> · </Text>
          <Text style={[type.labelSm, { color: urgency, letterSpacing: 1.5 }]}>
            {deliveryDateLabel(order.delivery_date)}
          </Text>
          {order.delivery_window ? (
            <>
              <Text style={[type.labelSm, { color: T.textDim }]}> · </Text>
              <Text style={[type.labelSm, { color: T.textMuted }]}>
                {order.delivery_window.toUpperCase()}
              </Text>
            </>
          ) : null}
          <Text style={[type.labelSm, { color: T.textDim }]}> · </Text>
          <Text style={[type.labelSm, { color: T.textMuted }]}>
            {items} {items === 1 ? "ITEM" : "ITEMS"}
          </Text>
        </View>
      </View>

      <Icon name="chevron-right" size={14} color={T.textDim} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },

  tabsRow: {
    paddingHorizontal: layout.contentPaddingH,
    height: 44,
    alignItems: "stretch",
  },
  tab: { paddingHorizontal: space.s12, justifyContent: "center" },
  tabInner: { flexDirection: "row", alignItems: "center" },
  tabRule: {
    position: "absolute",
    bottom: 0,
    left: space.s12,
    right: space.s12,
    height: 2,
  },

  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s12,
    borderBottomWidth: 1,
  },
  mineBtn: {
    paddingHorizontal: space.s8,
    paddingVertical: 4,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.s12,
    paddingRight: layout.contentPaddingH,
    paddingLeft: layout.contentPaddingH - 4,
    borderBottomWidth: layout.hairlineWidth,
    gap: space.s12,
  },
  rowMain: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    flexWrap: "wrap",
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: layout.contentPaddingH,
    paddingBottom: space.s64,
  },
});
