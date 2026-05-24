/**
 * Notifications — activity feed.
 *
 * Read-only aggregation surface. No `notifications` table backing it
 * (option B from the scope decision) — events come from existing data:
 *
 *   - **Low stock**     → products where on-hand ≤ reorder_point
 *   - **Pending orders** → orders in created/assigned/picking status,
 *     ordered by delivery date (late ones surfaced first)
 *   - **Recent returns** → returns table, last 7 days
 *   - **Recent scans**   → scan_history, last 24 hours
 *
 * Merged into a single timeline with a kind filter strip
 * (ALL · ALERTS · ORDERS · ACTIVITY). Tap a row to route to its source.
 *
 * Routed from the More menu. No tab.
 *
 * When push infrastructure lands, this surface becomes the in-app
 * mirror of the push payloads. The aggregation logic here moves to a
 * server function or trigger that writes into a real notifications
 * table — and this screen reads from that table with a real read/unread
 * state machine instead of computing on the fly.
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

import { ScreenHeader } from "../lib/nimbus/Header";
import { Icon, IconName } from "../lib/nimbus/Icon";
import { layout, space, type } from "../lib/nimbus/tokens";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { haptic } from "../lib/ui";
import { useWarehouse } from "../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type EventKind =
  | "low_stock"
  | "order_late"
  | "order_pending"
  | "return_logged"
  | "scan";

interface FeedEvent {
  id: string;
  kind: EventKind;
  title: string;
  body: string;
  meta: string; // short trailing label (e.g. "TODAY", "2H AGO")
  timestamp: number; // for sorting
  route?: string;
  iconName: IconName;
}

interface FilterDef {
  key: string;
  label: string;
  kinds: EventKind[] | null;
}

const FILTERS: FilterDef[] = [
  { key: "all", label: "ALL", kinds: null },
  { key: "alerts", label: "ALERTS", kinds: ["low_stock", "order_late"] },
  { key: "orders", label: "ORDERS", kinds: ["order_late", "order_pending"] },
  { key: "activity", label: "ACTIVITY", kinds: ["return_logged", "scan"] },
];

const KIND_LABEL: Record<EventKind, string> = {
  low_stock: "LOW STOCK",
  order_late: "LATE ORDER",
  order_pending: "ORDER",
  return_logged: "RETURN",
  scan: "ACTIVITY",
};

function kindTone(kind: EventKind, T: ReturnType<typeof useTheme>): string {
  switch (kind) {
    case "low_stock":
      return T.warning;
    case "order_late":
      return T.danger;
    case "order_pending":
      return T.info;
    case "return_logged":
      return T.accent;
    case "scan":
      return T.textMuted;
  }
}

function kindIcon(kind: EventKind): IconName {
  switch (kind) {
    case "low_stock":
      return "alert-circle";
    case "order_late":
      return "alert-circle";
    case "order_pending":
      return "clipboard-list";
    case "return_logged":
      return "rotate-ccw";
    case "scan":
      return "barcode";
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "NOW";
  if (m < 60) return `${m}M AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}H AGO`;
  const d = Math.floor(h / 24);
  return `${d}D AGO`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  const load = useCallback(async () => {
    if (!wh.warehouseId) return;
    if (!refreshing) setLoading(true);

    const now = Date.now();
    const dayAgo = new Date(now - 86_400_000).toISOString();
    const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [lowStockRes, ordersRes, returnsRes, scansRes] = await Promise.all([
      // Low stock — products with sum(qty) <= reorder_point AND reorder_point > 0
      supabase
        .from("products")
        .select(
          "id, name, reorder_point, locations!inner(quantity, warehouse_id, is_active)"
        )
        .eq("locations.warehouse_id", wh.warehouseId)
        .eq("locations.is_active", true)
        .gt("reorder_point", 0)
        .limit(30),
      // Active orders
      supabase
        .from("orders")
        .select(
          "id, order_number, customer_name, delivery_date, status, updated_at"
        )
        .eq("warehouse_id", wh.warehouseId)
        .in("status", [
          "created",
          "pick_list_assigned",
          "in_progress",
          "staged",
        ])
        .order("delivery_date", { ascending: true, nullsFirst: false })
        .limit(20),
      // Recent returns
      supabase
        .from("returns")
        .select("id, quantity, disposition, created_at, products(id, name)")
        .eq("warehouse_id", wh.warehouseId)
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: false })
        .limit(10),
      // Recent scans (last 24h)
      supabase
        .from("scan_history")
        .select("id, action, scanned_at, notes, products(id, name)")
        .eq("warehouse_id", wh.warehouseId)
        .gte("scanned_at", dayAgo)
        .order("scanned_at", { ascending: false })
        .limit(20),
    ]);

    const out: FeedEvent[] = [];

    // Low stock — aggregate quantities client side and compare to reorder_point
    if (lowStockRes.data) {
      for (const p of lowStockRes.data as any[]) {
        const qty = (p.locations ?? []).reduce(
          (s: number, l: any) => s + (l.quantity ?? 0),
          0
        );
        const reorder = p.reorder_point ?? 0;
        if (qty <= reorder) {
          out.push({
            id: `lowstock-${p.id}`,
            kind: "low_stock",
            title: p.name,
            body: `${qty} on hand · reorder at ${reorder}`,
            meta: qty === 0 ? "OUT" : "LOW",
            timestamp: now,
            route: `/product/${p.id}`,
            iconName: kindIcon("low_stock"),
          });
        }
      }
    }

    // Orders — split into "late" and "pending" by delivery_date
    if (ordersRes.data) {
      for (const o of ordersRes.data as any[]) {
        const isLate = o.delivery_date && new Date(o.delivery_date) < today;
        out.push({
          id: `order-${o.id}`,
          kind: isLate ? "order_late" : "order_pending",
          title: o.order_number ?? o.id.slice(0, 8).toUpperCase(),
          body: `${o.customer_name ?? "—"} · ${o.status
            .toUpperCase()
            .replace("_", " ")}`,
          meta: o.delivery_date
            ? isLate
              ? "LATE"
              : new Date(o.delivery_date)
                  .toLocaleDateString("en-US", {
                    weekday: "short",
                  })
                  .toUpperCase()
            : "NO DATE",
          timestamp: o.delivery_date
            ? new Date(o.delivery_date).getTime()
            : new Date(o.updated_at).getTime(),
          route: `/order/${o.id}`,
          iconName: kindIcon(isLate ? "order_late" : "order_pending"),
        });
      }
    }

    // Returns
    if (returnsRes.data) {
      for (const r of returnsRes.data as any[]) {
        const productName = r.products?.name ?? "Unknown product";
        out.push({
          id: `return-${r.id}`,
          kind: "return_logged",
          title: productName,
          body: `${r.quantity} unit${
            r.quantity === 1 ? "" : "s"
          } · ${r.disposition.replace("_", " ").toUpperCase()}`,
          meta: formatRelative(r.created_at),
          timestamp: r.created_at ? new Date(r.created_at).getTime() : 0,
          route: "/returns",
          iconName: kindIcon("return_logged"),
        });
      }
    }

    // Scans (informational — filtered down to interesting actions)
    if (scansRes.data) {
      for (const s of scansRes.data as any[]) {
        // Pick/receive/return scans are noisy on busy days; cap to most
        // recent and include them under "activity"
        const productName = s.products?.name ?? "Unknown";
        out.push({
          id: `scan-${s.id}`,
          kind: "scan",
          title: productName,
          body: `${s.action.toUpperCase()}${s.notes ? ` · ${s.notes}` : ""}`,
          meta: formatRelative(s.scanned_at),
          timestamp: s.scanned_at ? new Date(s.scanned_at).getTime() : 0,
          route: s.products?.id ? `/product/${s.products.id}` : undefined,
          iconName: kindIcon("scan"),
        });
      }
    }

    // Sort by timestamp desc (most recent first); alerts naturally float
    // to the top because we set timestamp=now for low_stock
    out.sort((a, b) => b.timestamp - a.timestamp);
    setEvents(out);
    setLoading(false);
    setRefreshing(false);
  }, [wh.warehouseId, refreshing]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === activeFilter) ?? FILTERS[0];
    return f.kinds ? events.filter((e) => f.kinds!.includes(e.kind)) : events;
  }, [events, activeFilter]);

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={
          wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Activity"
        }
        title="Notifications"
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={18} color={T.text} />
          </Pressable>
        }
      />

      {/* Filter strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
        style={{ borderBottomWidth: 1, borderBottomColor: T.borderSubtle }}
      >
        {FILTERS.map((f) => {
          const isActive = activeFilter === f.key;
          const count = f.kinds
            ? events.filter((e) => f.kinds!.includes(e.kind)).length
            : events.length;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                haptic.selection();
                setActiveFilter(f.key);
              }}
              style={styles.tab}
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

      {/* Content */}
      {loading && events.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}
          >
            ALL CLEAR · 00
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
            Nothing to surface
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
            No low stock, no pending orders, no recent activity. Pull to
            refresh.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <EventRow
              event={item}
              theme={T}
              onPress={() => {
                if (item.route) {
                  haptic.light();
                  router.push(item.route as any);
                }
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
                load();
              }}
            />
          }
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT ROW
// ─────────────────────────────────────────────────────────────────────────────

function EventRow({
  event,
  theme: T,
  onPress,
}: {
  event: FeedEvent;
  theme: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  const tone = kindTone(event.kind, T);
  const isAlert = event.kind === "low_stock" || event.kind === "order_late";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? T.surface2 : "transparent",
          borderBottomColor: T.borderFaint,
          // §9.5 alert escalation: 4px left border for alerts
          borderLeftColor: isAlert ? tone : "transparent",
          borderLeftWidth: 4,
        },
      ]}
    >
      <View style={styles.rowIcon}>
        <Icon name={event.iconName} size={16} color={tone} />
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[type.labelSm, { color: tone, letterSpacing: 1.5 }]}>
            {KIND_LABEL[event.kind]}
          </Text>
          <Text
            style={[
              type.labelSm,
              { color: isAlert ? tone : T.textDim, letterSpacing: 1.5 },
            ]}
          >
            {event.meta}
          </Text>
        </View>
        <Text
          style={[type.body, { color: T.text, marginTop: 4, fontSize: 14 }]}
          numberOfLines={1}
        >
          {event.title}
        </Text>
        <Text
          style={[type.monoSm, { color: T.textMuted, marginTop: 2 }]}
          numberOfLines={1}
        >
          {event.body}
        </Text>
      </View>
      {event.route ? (
        <Icon name="chevron-right" size={14} color={T.textDim} />
      ) : null}
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

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: space.s12,
    paddingRight: layout.contentPaddingH,
    paddingLeft: layout.contentPaddingH - 4,
    borderBottomWidth: layout.hairlineWidth,
    gap: space.s12,
  },
  rowIcon: {
    width: 28,
    paddingTop: 2,
  },
  rowMain: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
