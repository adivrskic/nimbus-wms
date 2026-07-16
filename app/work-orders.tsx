/**
 * Work orders — the assembly side of the desk app's kit builds.
 *
 * The desk creates/manages work orders (app.work_orders: build `quantity`
 * units of a kit, status draft → released → in_progress → complete /
 * cancelled) and snapshots the kit's direct BOM into app.work_order_lines
 * at creation (quantity_required = per-unit × qty). The physical assembly
 * happens here:
 *
 *   1. **Queue** — released / in-progress WOs for this facility, oldest
 *      first, plus a read-only COMPLETE segment.
 *   2. **Build sheet** (full-screen) — component lines with per-unit /
 *      total required and live on-hand, a MARK IN PROGRESS step for
 *      released WOs (desk parity: plain status update), and a prominent
 *      Complete action through the atomic `app.complete_work_order` RPC
 *      (claims the WO's status race, consumes components via assemble_kit,
 *      records quantity_consumed — all one transaction; short stock rolls
 *      the whole thing back).
 *
 * Routed from the More menu. No tab.
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "../lib/nimbus/Header";
import { Icon } from "../lib/nimbus/Icon";
import { layout, space, type } from "../lib/nimbus/tokens";
import { useOffline } from "../lib/offline";
import { usePermissions } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { haptic, Skeleton, showToast } from "../lib/ui";
import { useWarehouse } from "../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type WorkOrderStatus =
  | "draft"
  | "released"
  | "in_progress"
  | "complete"
  | "cancelled";

interface WorkOrder {
  id: string;
  code: string;
  status: WorkOrderStatus;
  quantity: number;
  created_at: string | null;
  completed_at: string | null;
  product: {
    name: string | null;
    internal_sku: string | null;
  } | null;
}

interface WoLine {
  id: string;
  component_product_id: string;
  quantity_required: number;
  quantity_consumed: number | null;
  product: {
    name: string | null;
    internal_sku: string | null;
  } | null;
}

/** A line enriched with live availability (desk-parity pooled netting). */
interface WoLineView extends WoLine {
  onHand: number;
  short: number;
}

type Segment = "open" | "complete";

const OPEN_STATUSES: WorkOrderStatus[] = ["released", "in_progress"];

function statusColor(status: WorkOrderStatus, T: ReturnType<typeof useTheme>) {
  switch (status) {
    case "released":
      return T.accent;
    case "in_progress":
      return T.warning;
    case "complete":
      return T.success;
    case "cancelled":
      return T.danger;
    default:
      return T.textMuted;
  }
}

function createdLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

/** Map complete_work_order / assemble_kit exceptions to floor-friendly copy. */
function friendlyRpcError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already closed")) {
    return "This work order was already completed or cancelled — pull to refresh.";
  }
  if (m.includes("not enough stock")) {
    return "Not enough component stock at this facility to finish the build. Restock the short components and try again.";
  }
  if (m.includes("bill of materials")) {
    return "This kit has no bill of materials. Define its components on the desk app first.";
  }
  if (m.includes("no facility")) {
    return "This work order isn't assigned to a facility. Fix it on the desk app.";
  }
  if (m.includes("nesting too deep")) {
    return "The kit's bill of materials nests too deep (possible cycle). Review it on the desk app.";
  }
  if (m.includes("quantity must be a positive number")) {
    return "This work order has an invalid quantity. Fix it on the desk app.";
  }
  return message;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN — work order queue
// ─────────────────────────────────────────────────────────────────────────────

export default function WorkOrdersScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();
  const { isOnline } = useOffline();
  const { role } = usePermissions();

  // perm: maps to the desk's `work_orders.manage`. Owner/admin always hold
  // it and the member default grants include it, so every org role may
  // complete builds here (legacy mobile role names kept for safety). RLS +
  // the complete_work_order RPC enforce this server-side regardless.
  const canCompleteWorkOrders = [
    "owner",
    "admin",
    "member",
    "super_admin",
    "manager",
    "staff",
  ].includes(role);

  const [segment, setSegment] = useState<Segment>("open");
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [buildWo, setBuildWo] = useState<WorkOrder | null>(null);

  const load = useCallback(async () => {
    if (!wh.warehouseId || !wh.orgId) return;
    if (!refreshing) setLoading(true);
    let q = supabase
      .from("work_orders")
      .select(
        "id, code, status, quantity, created_at, completed_at, " +
          "product:products!work_orders_product_id_fkey(name, internal_sku)"
      )
      .eq("org_id", wh.orgId)
      .eq("warehouse_id", wh.warehouseId);
    if (segment === "open") {
      // Floor queue: oldest first so the longest-waiting build is on top.
      q = q.in("status", OPEN_STATUSES).order("created_at", { ascending: true });
    } else {
      // Read-only history: most recent completions first.
      q = q
        .eq("status", "complete")
        .order("completed_at", { ascending: false, nullsFirst: false });
    }
    const { data, error } = await q.limit(50);
    if (error) {
      showToast(`Couldn't load work orders: ${error.message}`, "error");
    } else if (data) {
      setOrders(data as unknown as WorkOrder[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, [wh.warehouseId, wh.orgId, segment, refreshing]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={
          wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Builds"
        }
        title="Work orders"
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

      {/* Segmented filter — open queue vs read-only completed history. */}
      <View
        style={[styles.segmentRow, { borderBottomColor: T.borderSubtle }]}
      >
        {(
          [
            ["open", "OPEN"],
            ["complete", "COMPLETE"],
          ] as Array<[Segment, string]>
        ).map(([key, label]) => {
          const active = segment === key;
          return (
            <Pressable
              key={key}
              onPress={() => {
                if (segment === key) return;
                haptic.light();
                setOrders([]);
                setSegment(key);
              }}
              style={[
                styles.segmentBtn,
                {
                  borderColor: active ? T.accent : T.borderSubtle,
                  backgroundColor: active ? T.surface3 : "transparent",
                },
              ]}
              accessibilityLabel={`Show ${label.toLowerCase()} work orders`}
            >
              <Text
                style={[
                  type.labelSm,
                  {
                    color: active ? T.accent : T.textMuted,
                    letterSpacing: 1.5,
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!isOnline ? (
        <View style={[styles.offlineNote, { backgroundColor: T.surface3 }]}>
          <Text style={[type.labelSm, { color: T.warning, letterSpacing: 1.5 }]}>
            OFFLINE — BUILDS CAN'T BE COMPLETED UNTIL YOU RECONNECT
          </Text>
        </View>
      ) : null}

      {loading && orders.length === 0 ? (
        <View style={{ paddingHorizontal: layout.contentPaddingH }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ paddingVertical: space.s12 }}>
              <Skeleton width={120} height={16} />
              <Skeleton width={220} height={14} style={{ marginTop: 8 }} />
              <Skeleton width={160} height={12} style={{ marginTop: 6 }} />
            </View>
          ))}
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}
          >
            {segment === "open" ? "QUEUE CLEAR · 00" : "NO HISTORY · 00"}
          </Text>
          <Text
            style={[
              type.bodyLg,
              { color: T.text, marginTop: space.s8, textAlign: "center" },
            ]}
          >
            {segment === "open"
              ? "No work orders waiting"
              : "Nothing completed yet"}
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
            {segment === "open"
              ? "Work orders are created and released from the desk app. Released builds show up here ready to assemble."
              : "Completed builds for this facility will appear here."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(w) => w.id}
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
          renderItem={({ item }) => {
            const chip = statusColor(item.status, T);
            const created = createdLabel(item.created_at);
            return (
              <Pressable
                onPress={() => {
                  haptic.light();
                  setBuildWo(item);
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? T.surface2 : "transparent",
                    borderBottomColor: T.borderFaint,
                    borderLeftColor:
                      item.status === "released" ? T.accent : "transparent",
                    borderLeftWidth: 4,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text
                      style={[type.monoBody, { color: T.text, fontSize: 15 }]}
                    >
                      {item.code}
                    </Text>
                    <View style={[styles.chip, { borderColor: chip }]}>
                      <Text
                        style={[
                          type.labelSm,
                          { color: chip, letterSpacing: 1.5 },
                        ]}
                      >
                        {item.status.replace("_", " ").toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      type.body,
                      { color: T.text, marginTop: 4, fontSize: 14 },
                    ]}
                    numberOfLines={1}
                  >
                    {item.product?.name ?? "Unknown kit"}
                  </Text>
                  <Text
                    style={[type.monoSm, { color: T.textMuted, marginTop: 2 }]}
                  >
                    BUILD {item.quantity} unit{item.quantity === 1 ? "" : "s"}
                    {created ? ` · ${created}` : ""}
                  </Text>
                </View>
                <Icon name="chevron-right" size={14} color={T.textDim} />
              </Pressable>
            );
          }}
        />
      )}

      {buildWo ? (
        <BuildSheet
          wo={buildWo}
          theme={T}
          isOnline={isOnline}
          canComplete={canCompleteWorkOrders}
          onDone={() => {
            setBuildWo(null);
            load();
          }}
          onClose={() => {
            setBuildWo(null);
            load();
          }}
        />
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD SHEET — component lines + complete
// ─────────────────────────────────────────────────────────────────────────────

function BuildSheet({
  wo,
  theme: T,
  isOnline,
  canComplete,
  onDone,
  onClose,
}: {
  wo: WorkOrder;
  theme: ReturnType<typeof useTheme>;
  isOnline: boolean;
  canComplete: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { orgId, warehouseId } = useWarehouse();

  const [status, setStatus] = useState<WorkOrderStatus>(wo.status);
  const [lines, setLines] = useState<WoLine[]>([]);
  const [onHand, setOnHand] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);

  const readOnly = !OPEN_STATUSES.includes(status);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("work_order_lines")
      .select(
        "id, component_product_id, quantity_required, quantity_consumed, " +
          "product:products!work_order_lines_component_product_id_fkey(name, internal_sku)"
      )
      .eq("work_order_id", wo.id)
      .eq("org_id", orgId);
    if (error) {
      showToast(`Couldn't load components: ${error.message}`, "error");
      setLoading(false);
      return;
    }
    const rows = (data as unknown as WoLine[]) ?? [];
    setLines(rows);

    // Live on-hand per component at this facility — active, non-quarantined
    // slots only (QC-held stock can't be consumed by a build; desk parity).
    const ids = Array.from(new Set(rows.map((r) => r.component_product_id)));
    if (warehouseId && ids.length > 0) {
      const { data: locs, error: locErr } = await supabase
        .from("locations")
        .select("product_id, quantity")
        .eq("org_id", orgId)
        .eq("warehouse_id", warehouseId)
        .eq("is_active", true)
        .eq("quarantined", false)
        .in("product_id", ids);
      if (!locErr) {
        const sums = new Map<string, number>();
        for (const l of (locs ?? []) as Array<{
          product_id: string | null;
          quantity: number | null;
        }>) {
          if (!l.product_id) continue;
          sums.set(l.product_id, (sums.get(l.product_id) ?? 0) + (l.quantity ?? 0));
        }
        setOnHand(sums);
      }
    } else {
      setOnHand(new Map());
    }
    setLoading(false);
  }, [orgId, warehouseId, wo.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Desk-parity pooled netting: a component appearing on multiple lines
  // draws from one running pool so shortage isn't hidden by double counting.
  const viewLines = useMemo<WoLineView[]>(() => {
    const pool = new Map(onHand);
    return lines.map((l) => {
      const have = onHand.get(l.component_product_id) ?? 0;
      const avail = pool.get(l.component_product_id) ?? 0;
      pool.set(l.component_product_id, Math.max(0, avail - l.quantity_required));
      return {
        ...l,
        onHand: have,
        short: Math.max(0, l.quantity_required - avail),
      };
    });
  }, [lines, onHand]);

  const shortCount = viewLines.filter((l) => l.short > 0).length;

  /** Desk parity: releasing → in-progress is a plain status update. */
  async function markInProgress() {
    if (starting || completing || !orgId) return;
    setStarting(true);
    haptic.medium();
    const { error } = await supabase
      .from("work_orders")
      .update({ status: "in_progress" })
      .eq("id", wo.id)
      .eq("org_id", orgId)
      .eq("status", "released");
    setStarting(false);
    if (error) {
      Alert.alert("Couldn't start", error.message);
      return;
    }
    setStatus("in_progress");
    showToast(`${wo.code} in progress`, "success");
  }

  function confirmComplete() {
    if (completing || !orgId) return;
    haptic.medium();
    Alert.alert(
      `Complete ${wo.code}?`,
      `This consumes the component stock below and adds ${wo.quantity} unit${
        wo.quantity === 1 ? "" : "s"
      } of ${wo.product?.name ?? "the kit"} to on-hand. This can't be undone.` +
        (shortCount > 0
          ? `\n\n${shortCount} component${
              shortCount === 1 ? " looks" : "s look"
            } short — the build will fail unless stock arrived since this loaded.`
          : ""),
      [
        { text: "Cancel", style: "cancel" },
        { text: "Complete build", style: "default", onPress: complete },
      ]
    );
  }

  async function complete() {
    if (completing || !orgId) return;
    setCompleting(true);
    // Atomic on the server: claims the open status (one completer wins),
    // assembles via assemble_kit, records consumed — or rolls back entirely.
    const { data, error } = await supabase.rpc("complete_work_order", {
      p_org_id: orgId,
      p_work_order_id: wo.id,
    });
    setCompleting(false);
    if (error) {
      haptic.error();
      Alert.alert("Couldn't complete", friendlyRpcError(error.message));
      return;
    }
    const built = (data as { quantity?: number } | null)?.quantity ?? wo.quantity;
    haptic.success();
    showToast(
      `Built ${built} unit${built === 1 ? "" : "s"} — ${wo.code} complete`,
      "success"
    );
    onDone();
  }

  const chip = statusColor(status, T);
  const completeDisabled = completing || starting || !isOnline;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.sheetWrap, { backgroundColor: T.bg }]}>
        <View
          style={[
            styles.sheetTopBar,
            {
              borderBottomColor: T.borderSubtle,
              paddingTop: insets.top || space.s16,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Text style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}>
              CLOSE
            </Text>
          </Pressable>
          <Text style={[type.monoBody, { color: T.text, fontSize: 14 }]}>
            {wo.code}
          </Text>
          <View style={[styles.chip, { borderColor: chip }]}>
            <Text style={[type.labelSm, { color: chip, letterSpacing: 1.5 }]}>
              {status.replace("_", " ").toUpperCase()}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: layout.contentPaddingH,
            paddingBottom: 200,
            gap: space.s12,
          }}
        >
          <View>
            <Text style={[type.bodyLg, { color: T.text }]} numberOfLines={2}>
              {wo.product?.name ?? "Unknown kit"}
            </Text>
            <Text style={[type.monoSm, { color: T.textMuted, marginTop: 4 }]}>
              {wo.product?.internal_sku ? `${wo.product.internal_sku} · ` : ""}
              BUILD {wo.quantity} unit{wo.quantity === 1 ? "" : "s"}
              {wo.created_at ? ` · CREATED ${createdLabel(wo.created_at)}` : ""}
            </Text>
          </View>

          <Text
            style={[
              type.label,
              {
                color: T.textMuted,
                letterSpacing: 2,
                marginTop: space.s8,
              },
            ]}
          >
            COMPONENTS · {String(lines.length).padStart(2, "0")}
          </Text>

          {loading ? (
            <View style={{ gap: space.s12 }}>
              {[0, 1, 2].map((i) => (
                <View key={i}>
                  <Skeleton width={220} height={14} />
                  <Skeleton width={150} height={12} style={{ marginTop: 6 }} />
                </View>
              ))}
            </View>
          ) : viewLines.length === 0 ? (
            <Text style={[type.bodySm, { color: T.textMuted }]}>
              No component lines on this work order. Define the kit's bill of
              materials on the desk app.
            </Text>
          ) : (
            viewLines.map((line) => {
              // Lines snapshot TOTAL required at creation (per-unit × qty).
              const perUnit =
                wo.quantity > 0 ? line.quantity_required / wo.quantity : null;
              const perUnitLabel =
                perUnit != null && Number.isInteger(perUnit)
                  ? String(perUnit)
                  : perUnit != null
                  ? perUnit.toFixed(2)
                  : "?";
              const isShort = !readOnly && line.short > 0;
              return (
                <View
                  key={line.id}
                  style={[
                    styles.lineRow,
                    {
                      borderColor: T.borderSubtle,
                      backgroundColor: T.bgElevated,
                      borderLeftColor: isShort ? T.danger : T.borderSubtle,
                      borderLeftWidth: isShort ? 4 : 1,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[type.body, { color: T.text, fontSize: 14 }]}
                      numberOfLines={1}
                    >
                      {line.product?.name ?? "Unknown product"}
                    </Text>
                    <Text
                      style={[type.monoSm, { color: T.textMuted, marginTop: 2 }]}
                    >
                      {line.product?.internal_sku
                        ? `${line.product.internal_sku} · `
                        : ""}
                      {perUnitLabel}/unit × {wo.quantity}
                    </Text>
                    {readOnly ? (
                      <Text
                        style={[
                          type.labelSm,
                          {
                            color: T.success,
                            letterSpacing: 1.5,
                            marginTop: 4,
                          },
                        ]}
                      >
                        CONSUMED {line.quantity_consumed ?? line.quantity_required}
                      </Text>
                    ) : (
                      <Text
                        style={[
                          type.labelSm,
                          {
                            color: isShort ? T.danger : T.textDim,
                            letterSpacing: 1.5,
                            marginTop: 4,
                          },
                        ]}
                      >
                        ON HAND {line.onHand}
                        {isShort ? ` · SHORT ${line.short}` : ""}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[type.monoBody, { color: T.text, fontSize: 20 }]}>
                      {line.quantity_required}
                    </Text>
                    <Text
                      style={[
                        type.labelSm,
                        { color: T.textDim, letterSpacing: 1.5 },
                      ]}
                    >
                      REQUIRED
                    </Text>
                  </View>
                </View>
              );
            })
          )}

          {!readOnly && !loading && shortCount > 0 ? (
            <Text
              style={[
                type.labelSm,
                { color: T.danger, letterSpacing: 1.5, marginTop: space.s8 },
              ]}
            >
              {shortCount} COMPONENT{shortCount === 1 ? "" : "S"} SHORT — THE
              BUILD WILL FAIL UNTIL STOCK ARRIVES
            </Text>
          ) : null}
        </ScrollView>

        {!readOnly ? (
          <View
            style={[
              styles.sheetCtaBar,
              {
                borderTopColor: T.borderSubtle,
                backgroundColor: T.bg,
                paddingBottom: insets.bottom + space.s12,
              },
            ]}
          >
            {!isOnline ? (
              <Text
                style={[
                  type.labelSm,
                  {
                    color: T.warning,
                    letterSpacing: 1.5,
                    textAlign: "center",
                    marginBottom: space.s8,
                  },
                ]}
              >
                OFFLINE — COMPLETING A BUILD CAN'T BE QUEUED. RECONNECT FIRST.
              </Text>
            ) : null}
            {!canComplete ? (
              <Text
                style={[
                  type.bodySm,
                  { color: T.textMuted, textAlign: "center" },
                ]}
              >
                Your role can't complete work orders. Ask an admin.
              </Text>
            ) : (
              <>
                {status === "released" ? (
                  <Pressable
                    onPress={markInProgress}
                    disabled={starting || completing || !isOnline}
                    style={[
                      styles.ctaSecondary,
                      {
                        borderColor: !isOnline ? T.borderSubtle : T.accent,
                        marginBottom: space.s8,
                      },
                    ]}
                    accessibilityLabel="Mark in progress"
                  >
                    <Text
                      style={[
                        type.label,
                        {
                          color: !isOnline ? T.textDim : T.accent,
                          letterSpacing: 2,
                        },
                      ]}
                    >
                      {starting ? "STARTING…" : "MARK IN PROGRESS"}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={confirmComplete}
                  disabled={completeDisabled}
                  style={({ pressed }) => [
                    styles.ctaPrimary,
                    {
                      backgroundColor: completeDisabled
                        ? T.surface3
                        : pressed
                        ? T.accentBright
                        : T.success,
                    },
                  ]}
                  accessibilityLabel="Complete work order"
                >
                  <Icon
                    name="check"
                    size={16}
                    color={completeDisabled ? T.textDim : "#000"}
                    strokeWidth={2}
                  />
                  <Text
                    style={[
                      type.label,
                      {
                        color: completeDisabled ? T.textDim : "#000",
                        letterSpacing: 2,
                        marginLeft: space.s8,
                      },
                    ]}
                  >
                    {completing ? "COMPLETING…" : "COMPLETE WORK ORDER"}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: layout.contentPaddingH,
    paddingBottom: space.s64,
  },

  segmentRow: {
    flexDirection: "row",
    gap: space.s8,
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s12,
    borderBottomWidth: layout.hairlineWidth,
  },
  segmentBtn: {
    borderWidth: 1,
    paddingHorizontal: space.s16,
    paddingVertical: space.s6,
  },
  offlineNote: {
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s8,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingVertical: space.s12,
    paddingRight: layout.contentPaddingH,
    paddingLeft: layout.contentPaddingH - 4,
    borderBottomWidth: layout.hairlineWidth,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: space.s8,
    paddingVertical: 2,
  },

  sheetWrap: { flex: 1 },
  sheetTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.contentPaddingH,
    paddingBottom: space.s12,
    borderBottomWidth: layout.hairlineWidth,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    borderWidth: 1,
    padding: space.s12,
  },
  sheetCtaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s12,
    borderTopWidth: layout.hairlineWidth,
  },
  ctaSecondary: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s12,
  },
  ctaPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s16,
  },
});
