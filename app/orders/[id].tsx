/**
 * Order detail — Nimbus phase 2.
 *
 * Two surfaces in one file:
 *
 *   1. **Detail view** (default) — customer info, delivery, line items,
 *      action button to start (or resume) a pick run.
 *
 *   2. **Pick run mode** (full-screen sheet) — §8.4 task-flow chrome.
 *      Tab bar hidden (the Modal covers it), "END RUN" ghost button
 *      top-left, live pick counter per §9.3, tappable line items that
 *      mark themselves as fully picked and write a scan_history row.
 *
 * Status transitions handled here:
 *   - "Start pick run" from `created` or `pick_list_assigned` →
 *     status = `in_progress`, assigned_to = current user
 *   - "Complete run" when all items picked → status = `staged`
 *   - Status `complete` and `cancelled` render read-only
 *
 * What this file deliberately doesn't do yet:
 *   - Partial pick quantity entry. Tap = full pick. Long-press or scan
 *     would let an operator enter a partial; punt until barcode scan
 *     integration lands.
 *   - Walk-path optimization (§9.4). Items render in section/bay/level
 *     order, which is a reasonable proxy for proximity inside one
 *     section but not across sections.
 *   - Live counter walk-distance + savings metrics — those need a
 *     known section adjacency graph.
 */

import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fefoSuggestions, type FefoSuggestion } from "../../lib/fefo";
import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon } from "../../lib/nimbus/Icon";
import { color, layout, space, type } from "../../lib/nimbus/tokens";
import { useOffline } from "../../lib/offline";
import { usePermissions } from "../../lib/permissions";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
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

interface ProductRef {
  id: string;
  name: string;
  barcode: string;
  internal_sku: string | null;
  track_lots: boolean | null;
}

interface SectionRef {
  code: string;
  name: string;
  color: string | null;
}

interface LocationRef {
  id: string;
  bay: number;
  level: number;
  sections: SectionRef | null;
}

interface OrderItem {
  id: string;
  quantity_requested: number;
  quantity_picked: number | null;
  notes: string | null;
  products: ProductRef | null;
  locations: LocationRef | null;
}

interface Order {
  id: string;
  order_number: string | null;
  order_type: OrderType;
  status: OrderStatus;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  delivery_date: string | null;
  delivery_window: string | null;
  assigned_to: string | null;
  notes: string | null;
  warehouse_id: string;
  org_id: string;
  created_at: string | null;
  updated_at: string | null;
  order_items: OrderItem[];
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

function statusTone(s: OrderStatus, T: ReturnType<typeof useTheme>): string {
  switch (s) {
    case "created":
      return T.textMuted;
    case "pick_list_assigned":
      return T.info;
    case "in_progress":
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

function locationLabel(loc: LocationRef | null): string {
  if (!loc) return "Unassigned";
  const code = loc.sections?.code?.trim() || "?";
  return `${code} · Bay ${loc.bay} · L${loc.level}`;
}

function pickedQty(item: OrderItem): number {
  return item.quantity_picked ?? 0;
}

function isFullyPicked(item: OrderItem): boolean {
  return pickedQty(item) >= item.quantity_requested;
}

function isPickable(status: OrderStatus): boolean {
  return (
    status === "created" ||
    status === "pick_list_assigned" ||
    status === "in_progress"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const router = useRouter();
  const { warehouseId } = useWarehouse();
  const perms = usePermissions();
  const { isOnline } = useOffline();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickRunOpen, setPickRunOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadOrder = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_number, order_type, status, customer_name, customer_phone, customer_address, delivery_date, delivery_window, assigned_to, notes, warehouse_id, org_id, created_at, updated_at, " +
          "order_items(id, quantity_requested, quantity_picked, notes, products(id, name, barcode, internal_sku, track_lots), locations(id, bay, level, sections(code, name, color)))"
      )
      .eq("id", id)
      .single();
    if (data) setOrder(data as unknown as Order);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const sortedItems = useMemo(() => {
    if (!order) return [];
    return [...order.order_items].sort((a, b) => {
      const ax = a.locations?.sections?.code ?? "ZZ";
      const bx = b.locations?.sections?.code ?? "ZZ";
      if (ax !== bx) return ax.localeCompare(bx);
      const ay = a.locations?.bay ?? 999;
      const by = b.locations?.bay ?? 999;
      if (ay !== by) return ay - by;
      return (a.locations?.level ?? 0) - (b.locations?.level ?? 0);
    });
  }, [order]);

  const totals = useMemo(() => {
    if (!order) return { items: 0, requested: 0, picked: 0, percent: 0 };
    const requested = order.order_items.reduce(
      (s, i) => s + i.quantity_requested,
      0
    );
    const picked = order.order_items.reduce((s, i) => s + pickedQty(i), 0);
    return {
      items: order.order_items.length,
      requested,
      picked,
      percent: requested > 0 ? Math.round((picked / requested) * 100) : 0,
    };
  }, [order]);

  async function startPickRun() {
    if (!order) return;
    setBusy(true);
    haptic.medium();
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u?.user?.id ?? null;

      // Only flip to in_progress if not already
      if (order.status !== "in_progress") {
        const { error } = await supabase
          .from("orders")
          .update({
            status: "in_progress",
            assigned_to: order.assigned_to ?? userId,
          })
          .eq("id", order.id);
        if (error) throw error;
      }
      await loadOrder();
      setPickRunOpen(true);
    } catch (e: any) {
      Alert.alert("Couldn't start", e?.message ?? "Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !order) {
    return (
      <View style={[styles.screen, { backgroundColor: T.bg }]}>
        <ScreenHeader
          title="Loading…"
          leading={
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Icon name="arrow-left" size={18} color={T.text} />
            </Pressable>
          }
        />
      </View>
    );
  }

  // canAdjustQuantity: picking decrements on-hand; `canEdit` never existed on
  // Permissions, so this gate silently hid picking for every role.
  const canPick =
    perms?.canAdjustQuantity && isPickable(order.status) && totals.items > 0;
  const isReadOnly =
    order.status === "complete" || order.status === "cancelled";

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow="Orders"
        title={order.order_number ?? order.id.slice(0, 8).toUpperCase()}
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

      <ScrollView contentContainerStyle={{ paddingBottom: space.s160 }}>
        {/* Status + type row */}
        <View style={styles.statusRow}>
          <View>
            <Text
              style={[type.labelSm, { color: T.textMuted, letterSpacing: 2 }]}
            >
              {TYPE_LABEL[order.order_type]} · STATUS
            </Text>
            <Text
              style={[
                type.displayMd,
                {
                  color: statusTone(order.status, T),
                  fontSize: 22,
                  marginTop: 4,
                },
              ]}
            >
              {STATUS_LABEL[order.status]}
            </Text>
          </View>
        </View>

        {/* KPI strip */}
        <View
          style={[
            styles.kpiStrip,
            {
              borderTopColor: T.borderSubtle,
              borderBottomColor: T.borderSubtle,
            },
          ]}
        >
          <Kpi theme={T} label="ITEMS" value={String(totals.items)} />
          <View style={[styles.divider, { backgroundColor: T.borderSubtle }]} />
          <Kpi
            theme={T}
            label="UNITS"
            value={totals.requested.toLocaleString()}
          />
          <View style={[styles.divider, { backgroundColor: T.borderSubtle }]} />
          <Kpi
            theme={T}
            label="PICKED"
            value={`${totals.percent}%`}
            tone={totals.percent === 100 ? "success" : "accent"}
          />
        </View>

        {/* Customer */}
        <SectionTitle theme={T} eyebrow="Customer" title="" />
        <View style={[styles.card, { borderColor: T.borderSubtle }]}>
          <SpecRow theme={T} label="Name" value={order.customer_name} />
          <SpecRow theme={T} label="Phone" value={order.customer_phone} mono />
          <SpecRow
            theme={T}
            label="Address"
            value={order.customer_address}
            isLast
          />
        </View>

        {/* Delivery */}
        <SectionTitle theme={T} eyebrow="Delivery" title="" />
        <View style={[styles.card, { borderColor: T.borderSubtle }]}>
          <SpecRow
            theme={T}
            label="Date"
            value={
              order.delivery_date
                ? new Date(order.delivery_date).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                : null
            }
            mono
          />
          <SpecRow
            theme={T}
            label="Window"
            value={order.delivery_window}
            mono
            isLast
          />
        </View>

        {/* Items */}
        <SectionTitle
          theme={T}
          eyebrow="Pick list"
          title={`${totals.items} ${totals.items === 1 ? "item" : "items"}`}
        />
        {sortedItems.length > 0 ? (
          <View style={[styles.card, { borderColor: T.borderSubtle }]}>
            {sortedItems.map((it, idx) => {
              const picked = isFullyPicked(it);
              const isLast = idx === sortedItems.length - 1;
              return (
                <ItemRow
                  key={it.id}
                  item={it}
                  picked={picked}
                  isLast={isLast}
                  theme={T}
                />
              );
            })}
          </View>
        ) : (
          <Text
            style={[
              type.bodySm,
              {
                color: T.textDim,
                paddingHorizontal: layout.contentPaddingH,
                paddingVertical: space.s12,
              },
            ]}
          >
            No items on this order.
          </Text>
        )}

        {/* Notes */}
        {order.notes ? (
          <>
            <SectionTitle theme={T} eyebrow="Notes" title="" />
            <Text
              style={[
                type.body,
                {
                  color: T.text,
                  paddingHorizontal: layout.contentPaddingH,
                  lineHeight: 22,
                },
              ]}
            >
              {order.notes}
            </Text>
          </>
        ) : null}
      </ScrollView>

      {/* CTA — start/resume pick run, pinned bottom */}
      {canPick ? (
        <View
          style={[
            styles.ctaBar,
            { borderTopColor: T.borderSubtle, backgroundColor: T.bg },
          ]}
        >
          <Pressable
            onPress={startPickRun}
            disabled={busy}
            style={({ pressed }) => [
              styles.ctaPrimary,
              {
                backgroundColor: pressed ? T.accentBright : T.accent,
                opacity: busy ? 0.6 : 1,
              },
            ]}
            accessibilityLabel="Start pick run"
          >
            <Icon name="barcode" size={16} color={color.black} strokeWidth={1.75} />
            <Text
              style={[
                type.label,
                { color: color.black, letterSpacing: 2, marginLeft: space.s8 },
              ]}
            >
              {order.status === "in_progress"
                ? "RESUME PICK RUN"
                : "START PICK RUN"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Pick run sheet */}
      <PickRunSheet
        open={pickRunOpen}
        order={order}
        items={sortedItems}
        warehouseId={warehouseId}
        onItemPicked={() => loadOrder()}
        onComplete={async () => {
          // Status → staged. supabase-js returns errors in the result — it
          // never throws, so the old try/catch silently "succeeded".
          const { error } = await supabase
            .from("orders")
            .update({ status: "staged" })
            .eq("id", order.id);
          if (error) {
            Alert.alert("Couldn't complete", error.message);
            return;
          }
          haptic.heavy();
          setPickRunOpen(false);
          await loadOrder();
        }}
        onClose={() => setPickRunOpen(false)}
        theme={T}
        isOnline={isOnline}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMPONENTS — detail view
// ─────────────────────────────────────────────────────────────────────────────

function Kpi({
  theme: T,
  label,
  value,
  tone = "neutral",
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  value: string;
  tone?: "neutral" | "accent" | "success";
}) {
  const c =
    tone === "accent" ? T.accent : tone === "success" ? T.success : T.text;
  return (
    <View style={styles.kpi}>
      <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}>
        {label}
      </Text>
      <Text
        style={[
          type.displayLg,
          {
            color: c,
            fontFamily: type.monoBody.fontFamily,
            fontSize: 24,
            marginTop: 4,
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionTitle({
  theme: T,
  eyebrow,
  title,
}: {
  theme: ReturnType<typeof useTheme>;
  eyebrow: string;
  title: string;
}) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 2 }]}>
        {eyebrow.toUpperCase()}
      </Text>
      {title ? (
        <Text style={[type.displayXs, { color: T.text, marginTop: 4 }]}>
          {title}
        </Text>
      ) : null}
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
  value: string | null | undefined;
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

function ItemRow({
  item,
  picked,
  isLast,
  theme: T,
}: {
  item: OrderItem;
  picked: boolean;
  isLast: boolean;
  theme: ReturnType<typeof useTheme>;
}) {
  const sectionColor = item.locations?.sections?.color ?? T.accent;
  return (
    <View
      style={[
        styles.itemRow,
        {
          borderBottomColor: T.borderFaint,
          borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
          opacity: picked ? 0.55 : 1,
        },
      ]}
    >
      <View style={[styles.itemAccent, { backgroundColor: sectionColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={[type.monoBody, { color: T.text, fontSize: 14 }]}>
          {locationLabel(item.locations)}
        </Text>
        <Text
          style={[type.bodyLg, { color: T.text, fontSize: 15, marginTop: 2 }]}
          numberOfLines={1}
        >
          {item.products?.name ?? "Unknown product"}
        </Text>
      </View>
      <View style={styles.itemQty}>
        <Text
          style={[
            type.monoBody,
            {
              color: picked ? T.success : T.text,
              fontSize: 16,
            },
          ]}
        >
          {pickedQty(item)}/{item.quantity_requested}
        </Text>
        {picked ? <Icon name="check" size={14} color={T.success} /> : null}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PICK RUN SHEET — full-screen, hides tab bar via Modal
// ─────────────────────────────────────────────────────────────────────────────

function PickRunSheet({
  open,
  order,
  items,
  warehouseId,
  onItemPicked,
  onComplete,
  onClose,
  theme: T,
  isOnline,
}: {
  open: boolean;
  order: Order;
  items: OrderItem[];
  warehouseId: string | null;
  onItemPicked: () => void;
  onComplete: () => void | Promise<void>;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
  isOnline: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [pickingId, setPickingId] = useState<string | null>(null);
  // Scan-to-verify: tapping a line opens this overlay; the pick RPC only
  // fires after the product barcode/SKU is scanned or typed (or the picker
  // explicitly skips verification).
  const [verifyItem, setVerifyItem] = useState<OrderItem | null>(null);
  // FEFO guidance for lot-tracked lines: productId → earliest-expiring lot.
  const [fefoHints, setFefoHints] = useState<Map<string, FefoSuggestion>>(
    new Map()
  );

  useEffect(() => {
    if (!open) return;
    const lotTracked = items
      .filter((i) => i.products?.track_lots && i.products?.id)
      .map((i) => i.products!.id);
    if (lotTracked.length === 0) return;
    fefoSuggestions(Array.from(new Set(lotTracked))).then(setFefoHints);
  }, [open, items]);

  const totalRequested = items.reduce((s, i) => s + i.quantity_requested, 0);
  const totalPicked = items.reduce((s, i) => s + pickedQty(i), 0);
  const allPicked = totalRequested > 0 && totalPicked >= totalRequested;
  const remaining = items.filter((i) => !isFullyPicked(i));
  const completed = items.filter(isFullyPicked);

  function pickItem(item: OrderItem) {
    if (isFullyPicked(item) || pickingId) return;
    // Picks are an atomic RPC — they are NOT queued by the offline layer.
    if (!isOnline) {
      Alert.alert(
        "You're offline",
        "Picking needs a connection — the pick RPC can't be queued. Reconnect and try again."
      );
      return;
    }
    haptic.light();
    // No barcode on record → nothing to verify against; pick directly.
    if (!item.products?.barcode && !item.products?.internal_sku) {
      void commitPick(item);
      return;
    }
    setVerifyItem(item);
  }

  async function commitPick(item: OrderItem) {
    setVerifyItem(null);
    setPickingId(item.id);
    haptic.medium();
    try {
      // Atomic pick: marks the line picked, decrements the picked-from on-hand,
      // and logs the scan in one transaction (app.pick_order_item). Replaces the
      // old update-then-insert that never touched locations.quantity.
      const { error } = await supabase.rpc("pick_order_item", {
        p_org_id: order.org_id,
        p_order_item_id: item.id,
      });
      if (error) throw error;

      onItemPicked();
    } catch (e: any) {
      Alert.alert("Couldn't pick", e?.message ?? "Try again.");
    } finally {
      setPickingId(null);
    }
  }

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.runWrap, { backgroundColor: T.bg }]}>
        {/* Task-flow top bar — §8.4: "End run" ghost button replaces tab bar */}
        <View
          style={[
            styles.runTopBar,
            {
              borderBottomColor: T.borderSubtle,
              paddingTop: insets.top || space.s16,
            },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityLabel="End run"
          >
            <Text
              style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}
            >
              END RUN
            </Text>
          </Pressable>

          <Text style={[type.monoBody, { color: T.text, fontSize: 14 }]}>
            {order.order_number ?? order.id.slice(0, 8).toUpperCase()}
          </Text>

          {/* §9.3 live pick counter — numerator/denominator */}
          <View style={styles.counter}>
            <Text
              style={[
                type.displayMd,
                {
                  color: T.accent,
                  fontFamily: type.monoBody.fontFamily,
                  fontSize: 22,
                },
              ]}
            >
              {String(totalPicked).padStart(2, "0")}
            </Text>
            <Text
              style={[type.monoSm, { color: T.textDim, marginHorizontal: 2 }]}
            >
              /
            </Text>
            <Text style={[type.monoBody, { color: T.textMuted, fontSize: 14 }]}>
              {String(totalRequested).padStart(2, "0")}
            </Text>
          </View>
        </View>

        {/* Offline banner if applicable */}
        {!isOnline ? (
          <View
            style={[
              styles.offlineBanner,
              { borderColor: T.warning, backgroundColor: T.warningDim },
            ]}
          >
            <Icon name="alert-circle" size={14} color={T.warning} />
            <Text
              style={[type.labelSm, { color: T.warning, letterSpacing: 1.5 }]}
            >
              OFFLINE · PICKING PAUSED UNTIL RECONNECT
            </Text>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
          {/* Remaining */}
          {remaining.length > 0 ? (
            <>
              <Text
                style={[
                  type.label,
                  {
                    color: T.textMuted,
                    letterSpacing: 2,
                    paddingHorizontal: layout.contentPaddingH,
                    paddingTop: space.s20,
                    paddingBottom: space.s8,
                  },
                ]}
              >
                REMAINING · {String(remaining.length).padStart(2, "0")}
              </Text>
              <View style={[styles.runList, { borderColor: T.borderSubtle }]}>
                {remaining.map((item, idx) => (
                  <RunRow
                    key={item.id}
                    item={item}
                    isPicking={pickingId === item.id}
                    isLast={idx === remaining.length - 1}
                    onPress={() => pickItem(item)}
                    fefo={
                      item.products?.id
                        ? fefoHints.get(item.products.id)
                        : undefined
                    }
                    theme={T}
                  />
                ))}
              </View>
            </>
          ) : null}

          {/* Completed */}
          {completed.length > 0 ? (
            <>
              <Text
                style={[
                  type.label,
                  {
                    color: T.textMuted,
                    letterSpacing: 2,
                    paddingHorizontal: layout.contentPaddingH,
                    paddingTop: space.s32,
                    paddingBottom: space.s8,
                  },
                ]}
              >
                PICKED · {String(completed.length).padStart(2, "0")}
              </Text>
              <View style={[styles.runList, { borderColor: T.borderSubtle }]}>
                {completed.map((item, idx) => (
                  <RunRow
                    key={item.id}
                    item={item}
                    isPicking={false}
                    isLast={idx === completed.length - 1}
                    onPress={() => {}}
                    completed
                    theme={T}
                  />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>

        {/* Complete CTA — appears when all picked */}
        {allPicked ? (
          <View
            style={[
              styles.runCtaBar,
              {
                borderTopColor: T.borderSubtle,
                backgroundColor: T.bg,
                paddingBottom: insets.bottom + space.s12,
              },
            ]}
          >
            <Pressable
              onPress={onComplete}
              style={({ pressed }) => [
                styles.ctaPrimary,
                { backgroundColor: pressed ? T.success : T.success },
              ]}
              accessibilityLabel="Complete run"
            >
              <Icon name="check" size={16} color={color.black} strokeWidth={2} />
              <Text
                style={[
                  type.label,
                  { color: color.black, letterSpacing: 2, marginLeft: space.s8 },
                ]}
              >
                COMPLETE RUN
              </Text>
            </Pressable>
          </View>
        ) : null}

        {verifyItem ? (
          <ScanVerifyOverlay
            item={verifyItem}
            theme={T}
            onVerified={() => void commitPick(verifyItem)}
            onCancel={() => setVerifyItem(null)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN-TO-VERIFY OVERLAY — confirm the physical product before the pick RPC.
// Camera scan when permitted, manual entry always, explicit skip fallback.
// ─────────────────────────────────────────────────────────────────────────────

function ScanVerifyOverlay({
  item,
  theme: T,
  onVerified,
  onCancel,
}: {
  item: OrderItem;
  theme: ReturnType<typeof useTheme>;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [permission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [mismatch, setMismatch] = useState<string | null>(null);
  const handled = useRef(false);

  function matches(code: string): boolean {
    const c = code.trim().toLowerCase();
    if (!c) return false;
    return (
      c === (item.products?.barcode ?? "").trim().toLowerCase() ||
      c === (item.products?.internal_sku ?? "").trim().toLowerCase()
    );
  }

  function handleCode(code: string) {
    if (handled.current) return;
    if (matches(code)) {
      handled.current = true;
      haptic.success();
      onVerified();
    } else {
      haptic.warning();
      setMismatch(code.trim());
    }
  }

  return (
    <View style={[styles.verifyWrap, { backgroundColor: T.bg }]}>
      <View
        style={[
          styles.runTopBar,
          {
            borderBottomColor: T.borderSubtle,
            paddingTop: insets.top || space.s16,
          },
        ]}
      >
        <Pressable onPress={onCancel} hitSlop={10} accessibilityLabel="Cancel">
          <Text style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}>
            CANCEL
          </Text>
        </Pressable>
        <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
          VERIFY PICK
        </Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={{ padding: layout.contentPaddingH, gap: space.s12 }}>
        <Text style={[type.bodyLg, { color: T.text }]} numberOfLines={2}>
          {item.products?.name ?? "Unknown product"}
        </Text>
        <Text style={[type.monoSm, { color: T.textMuted }]}>
          Scan or enter{" "}
          {item.products?.barcode
            ? `barcode ${item.products.barcode}`
            : `SKU ${item.products?.internal_sku}`}
        </Text>
      </View>

      {permission?.granted ? (
        <View style={[styles.verifyCamera, { borderColor: T.borderSubtle }]}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{
              barcodeTypes: [
                "ean13",
                "ean8",
                "upc_a",
                "upc_e",
                "code128",
                "code39",
                "code93",
                "itf14",
                "qr",
              ],
            }}
            onBarcodeScanned={({ data }) => handleCode(data)}
          />
        </View>
      ) : null}

      <View style={{ padding: layout.contentPaddingH, gap: space.s12 }}>
        <View
          style={[
            styles.verifyField,
            { borderColor: T.borderSubtle, backgroundColor: T.surface2 },
          ]}
        >
          <TextInput
            value={manual}
            onChangeText={(v) => {
              setManual(v);
              setMismatch(null);
            }}
            placeholder="Enter barcode / SKU"
            placeholderTextColor={T.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => handleCode(manual)}
            style={[type.monoBody, { color: T.text, flex: 1, padding: 0 }]}
          />
          <Pressable onPress={() => handleCode(manual)} hitSlop={10}>
            <Text style={[type.labelSm, { color: T.accent, letterSpacing: 1.5 }]}>
              CHECK
            </Text>
          </Pressable>
        </View>

        {mismatch ? (
          <View
            style={[
              styles.verifyMismatch,
              { borderLeftColor: T.danger, backgroundColor: T.dangerDim },
            ]}
          >
            <Text style={[type.monoSm, { color: T.danger }]}>
              "{mismatch}" doesn't match this line — check you're holding the
              right product.
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => {
            haptic.light();
            onVerified();
          }}
          style={[styles.verifySkip, { borderColor: T.borderSubtle }]}
        >
          <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}>
            PICK WITHOUT SCAN
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function RunRow({
  item,
  isPicking,
  isLast,
  onPress,
  completed,
  fefo,
  theme: T,
}: {
  item: OrderItem;
  isPicking: boolean;
  isLast: boolean;
  onPress: () => void;
  completed?: boolean;
  fefo?: FefoSuggestion;
  theme: ReturnType<typeof useTheme>;
}) {
  const sectionColor = item.locations?.sections?.color ?? T.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={completed || isPicking}
      style={({ pressed }) => [
        styles.runRow,
        {
          backgroundColor: pressed && !completed ? T.surface2 : "transparent",
          borderBottomColor: T.borderFaint,
          borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
          opacity: completed ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.itemAccent, { backgroundColor: sectionColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={[type.monoBody, { color: T.accent, fontSize: 16 }]}>
          {locationLabel(item.locations)}
        </Text>
        <Text
          style={[type.bodyLg, { color: T.text, fontSize: 14, marginTop: 2 }]}
          numberOfLines={1}
        >
          {item.products?.name ?? "Unknown product"}
        </Text>
        <Text style={[type.monoSm, { color: T.textDim, marginTop: 2 }]}>
          {item.products?.internal_sku ?? item.products?.barcode}
        </Text>
        {fefo ? (
          <Text style={[type.labelSm, { color: T.warning, letterSpacing: 1.5, marginTop: 4 }]}>
            FEFO · LOT {fefo.lotNumber}
            {fefo.expiresAt ? ` · EXP ${fefo.expiresAt}` : ""}
          </Text>
        ) : null}
      </View>
      <View style={styles.runRowRight}>
        {completed ? (
          <Icon name="check" size={20} color={T.success} />
        ) : isPicking ? (
          <Text style={[type.labelSm, { color: T.accent, letterSpacing: 1.5 }]}>
            …
          </Text>
        ) : (
          <Text
            style={[
              type.displayMd,
              {
                color: T.text,
                fontFamily: type.monoBody.fontFamily,
                fontSize: 24,
              },
            ]}
          >
            {item.quantity_requested}
          </Text>
        )}
        {!completed && !isPicking ? (
          <Text
            style={[type.labelSm, { color: T.textDim, letterSpacing: 1.5 }]}
          >
            TAP TO PICK
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },

  statusRow: {
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s20,
  },

  kpiStrip: {
    flexDirection: "row",
    borderTopWidth: layout.hairlineWidth,
    borderBottomWidth: layout.hairlineWidth,
  },
  kpi: {
    flex: 1,
    paddingVertical: space.s16,
    paddingHorizontal: space.s12,
    alignItems: "flex-start",
  },
  divider: { width: layout.hairlineWidth },

  sectionTitle: {
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s32,
    paddingBottom: space.s12,
  },
  card: {
    marginHorizontal: layout.contentPaddingH,
    borderWidth: layout.hairlineWidth,
  },
  specRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
    minHeight: 44,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingRight: space.s16,
    paddingVertical: space.s12,
    minHeight: 56,
  },
  itemAccent: {
    width: 4,
    alignSelf: "stretch",
  },
  itemQty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  // CTA bar at bottom of detail view
  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s12,
    paddingBottom: space.s24,
    borderTopWidth: layout.hairlineWidth,
  },
  ctaPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s16,
    // SHARP corners — no borderRadius per §1.1
  },

  // Pick run mode
  runWrap: { flex: 1 },
  runTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.contentPaddingH,
    paddingBottom: space.s12,
    borderBottomWidth: layout.hairlineWidth,
  },
  counter: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
    marginHorizontal: layout.contentPaddingH,
    marginTop: space.s12,
    paddingHorizontal: space.s12,
    paddingVertical: space.s8,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  runList: {
    marginHorizontal: layout.contentPaddingH,
    borderWidth: layout.hairlineWidth,
  },
  runRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingRight: space.s16,
    paddingVertical: space.s12,
    minHeight: 72, // taller — operator reads this while walking
  },
  runRowRight: {
    alignItems: "flex-end",
    minWidth: 60,
  },
  runCtaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s12,
    borderTopWidth: layout.hairlineWidth,
  },

  // Scan-to-verify overlay
  verifyWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  verifyCamera: {
    marginHorizontal: layout.contentPaddingH,
    height: 220,
    borderWidth: 1,
    overflow: "hidden",
  },
  verifyField: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    borderWidth: 1,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
  },
  verifyMismatch: {
    borderLeftWidth: 4,
    padding: space.s12,
  },
  verifySkip: {
    alignItems: "center",
    paddingVertical: space.s12,
    borderWidth: 1,
  },
});
