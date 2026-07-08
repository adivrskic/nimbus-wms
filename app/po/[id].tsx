/**
 * PO detail + receive run.
 *
 * Mirror of app/order/[id].tsx for purchase orders. Two surfaces in
 * one file:
 *
 *   1. **Detail view** — supplier info, expected date, line items list,
 *      action button to start (or resume) a receive run.
 *
 *   2. **Receive run mode** — §8.4 full-screen task flow. END RUN ghost
 *      button + live counter + tap-to-receive list. Each receive does:
 *        - UPDATE po_line_items SET quantity_received = quantity_expected,
 *          received_by, received_at
 *        - INSERT scan_history with action='receive', quantity, notes
 *
 * Status transitions:
 *   - "Start receive run" from draft/sent/partial → status sticks at
 *     current state; transitions happen on item-by-item completion
 *   - When all items >= expected → status = `fully_received`
 *   - When some items > 0 but not all → status = `partially_received`
 *   - "Cancel PO" sets status = `cancelled`
 *
 * What this file deliberately doesn't do (flagged for follow-up):
 *   - **Auto-place to locations.** Receiving updates the PO and logs
 *     the scan but does NOT touch the locations table. Inventory
 *     placement is a separate step handled via the scanner screen.
 *     A common production flow does both at once with a location
 *     picker in the receive sheet — punted to keep this round small.
 *   - **Partial-quantity receive.** Tap = mark full expected qty
 *     received. Long-press or a "+/-" stepper to enter partial qty is
 *     a later enhancement.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon } from "../../lib/nimbus/Icon";
import { layout, space, type } from "../../lib/nimbus/tokens";
import { useOffline } from "../../lib/offline";
import { usePermissions } from "../../lib/permissions";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type PoStatus =
  | "draft"
  | "sent"
  | "partially_received"
  | "fully_received"
  | "cancelled";

interface ProductRef {
  id: string;
  name: string;
  barcode: string;
  internal_sku: string | null;
  track_lots: boolean | null;
}

type QcStatus = "hold" | "passed" | "failed" | null;

interface PoLineItem {
  id: string;
  product_id: string | null;
  product_name: string | null;
  barcode: string | null;
  quantity_expected: number;
  quantity_received: number | null;
  received_at: string | null;
  lot_number: string | null;
  qc_status: QcStatus;
  qc_notes: string | null;
  products: ProductRef | null;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: PoStatus;
  supplier_name: string;
  supplier_contact: string | null;
  expected_date: string | null;
  notes: string | null;
  warehouse_id: string;
  org_id: string;
  created_at: string | null;
  updated_at: string | null;
  po_line_items: PoLineItem[];
}

const STATUS_LABEL: Record<PoStatus, string> = {
  draft: "DRAFT",
  sent: "SENT",
  partially_received: "PARTIAL",
  fully_received: "RECEIVED",
  cancelled: "CANCELLED",
};

function statusTone(s: PoStatus, T: ReturnType<typeof useTheme>): string {
  switch (s) {
    case "draft":
      return T.textMuted;
    case "sent":
      return T.info;
    case "partially_received":
      return T.warning;
    case "fully_received":
      return T.success;
    case "cancelled":
      return T.textDim;
  }
}

function receivedQty(item: PoLineItem): number {
  return item.quantity_received ?? 0;
}

function isFullyReceived(item: PoLineItem): boolean {
  return receivedQty(item) >= item.quantity_expected;
}

function isReceivable(status: PoStatus): boolean {
  return (
    status === "draft" || status === "sent" || status === "partially_received"
  );
}

function displayName(item: PoLineItem): string {
  return item.products?.name ?? item.product_name ?? "Unknown product";
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function PoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const router = useRouter();
  const perms = usePermissions();
  const { isOnline } = useOffline();

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [qcReviewingId, setQcReviewingId] = useState<string | null>(null);

  const loadPo = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, supplier_name, supplier_contact, expected_date, notes, warehouse_id, org_id, created_at, updated_at, " +
          "po_line_items(id, product_id, product_name, barcode, quantity_expected, quantity_received, received_at, lot_number, qc_status, qc_notes, products(id, name, barcode, internal_sku, track_lots))"
      )
      .eq("id", id)
      .single();
    if (data) setPo(data as unknown as PurchaseOrder);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadPo();
  }, [loadPo]);

  const totals = useMemo(() => {
    if (!po) return { lines: 0, expected: 0, received: 0, percent: 0 };
    const expected = po.po_line_items.reduce(
      (s, i) => s + i.quantity_expected,
      0
    );
    const received = po.po_line_items.reduce((s, i) => s + receivedQty(i), 0);
    return {
      lines: po.po_line_items.length,
      expected,
      received,
      percent: expected > 0 ? Math.round((received / expected) * 100) : 0,
    };
  }, [po]);

  async function cancelPo() {
    if (!po) return;
    Alert.alert(
      "Cancel this PO?",
      "This marks the PO as cancelled. You can't undo this from mobile.",
      [
        { text: "Keep open", style: "cancel" },
        {
          text: "Cancel PO",
          style: "destructive",
          onPress: async () => {
            haptic.medium();
            await supabase
              .from("purchase_orders")
              .update({ status: "cancelled" })
              .eq("id", po.id);
            loadPo();
          },
        },
      ]
    );
  }

  /**
   * QC disposition — mirrors desktop reviewQcLine ordering: release/kill the
   * quarantined stock FIRST (while the line still reads 'hold'), then stamp
   * the line. PASS un-quarantines the held location rows; FAIL deactivates
   * them (soft-delete pending vendor return).
   */
  async function reviewQc(item: PoLineItem, decision: "passed" | "failed") {
    if (!po || item.qc_status !== "hold" || qcReviewingId) return;
    setQcReviewingId(item.id);
    haptic.medium();
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u?.user?.id ?? null;

      const locPatch =
        decision === "passed" ? { quarantined: false } : { is_active: false };
      const { error: locErr } = await supabase
        .from("locations")
        .update(locPatch)
        .eq("po_line_id", item.id)
        .eq("org_id", po.org_id)
        .eq("quarantined", true);
      if (locErr) throw locErr;

      const { error: lineErr } = await supabase
        .from("po_line_items")
        .update({
          qc_status: decision,
          qc_at: new Date().toISOString(),
          qc_by: userId,
        })
        .eq("id", item.id);
      if (lineErr) throw lineErr;

      haptic.success();
      loadPo();
    } catch (e: any) {
      Alert.alert("QC review failed", e?.message ?? "Try again.");
    } finally {
      setQcReviewingId(null);
    }
  }

  function confirmQc(item: PoLineItem, decision: "passed" | "failed") {
    haptic.light();
    Alert.alert(
      decision === "passed" ? "Pass QC?" : "Fail QC?",
      decision === "passed"
        ? `Release held stock for "${displayName(item)}" into available inventory.`
        : `Reject "${displayName(item)}" — held stock is deactivated for vendor return.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: decision === "passed" ? "Pass" : "Fail",
          style: decision === "failed" ? "destructive" : "default",
          onPress: () => reviewQc(item, decision),
        },
      ]
    );
  }

  if (loading || !po) {
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

  // canAdjustQuantity: receiving increments on-hand; `canEdit` never existed
  // on Permissions, so these gates silently hid receiving for every role.
  const canReceive =
    perms?.canAdjustQuantity && isReceivable(po.status) && totals.lines > 0;
  const canCancel =
    perms?.canEditProducts &&
    po.status !== "fully_received" &&
    po.status !== "cancelled";

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow="Purchase orders"
        title={po.po_number}
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
        {/* Status */}
        <View style={styles.statusRow}>
          <Text
            style={[type.labelSm, { color: T.textMuted, letterSpacing: 2 }]}
          >
            STATUS
          </Text>
          <Text
            style={[
              type.displayMd,
              { color: statusTone(po.status, T), fontSize: 22, marginTop: 4 },
            ]}
          >
            {STATUS_LABEL[po.status]}
          </Text>
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
          <Kpi theme={T} label="LINES" value={String(totals.lines)} />
          <View style={[styles.divider, { backgroundColor: T.borderSubtle }]} />
          <Kpi
            theme={T}
            label="EXPECTED"
            value={totals.expected.toLocaleString()}
          />
          <View style={[styles.divider, { backgroundColor: T.borderSubtle }]} />
          <Kpi
            theme={T}
            label="RECEIVED"
            value={`${totals.percent}%`}
            tone={totals.percent === 100 ? "success" : "accent"}
          />
        </View>

        {/* Supplier */}
        <SectionTitle theme={T} eyebrow="Supplier" title="" />
        <View style={[styles.card, { borderColor: T.borderSubtle }]}>
          <SpecRow theme={T} label="Name" value={po.supplier_name} />
          <SpecRow theme={T} label="Contact" value={po.supplier_contact} mono />
          <SpecRow
            theme={T}
            label="Expected"
            value={
              po.expected_date
                ? new Date(po.expected_date).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                : null
            }
            mono
            isLast
          />
        </View>

        {/* Line items */}
        <SectionTitle
          theme={T}
          eyebrow="Line items"
          title={`${totals.lines} ${totals.lines === 1 ? "line" : "lines"}`}
        />
        {po.po_line_items.length > 0 ? (
          <View style={[styles.card, { borderColor: T.borderSubtle }]}>
            {po.po_line_items.map((item, idx) => {
              const isLast = idx === po.po_line_items.length - 1;
              const recv = receivedQty(item);
              const done = isFullyReceived(item);
              return (
                <View
                  key={item.id}
                  style={[
                    styles.lineRow,
                    {
                      borderBottomColor: T.borderFaint,
                      borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
                      opacity: done ? 0.55 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.lineAccent,
                      { backgroundColor: done ? T.success : T.accent },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[type.bodyLg, { color: T.text, fontSize: 14 }]}
                      numberOfLines={1}
                    >
                      {displayName(item)}
                    </Text>
                    <Text
                      style={[
                        type.monoSm,
                        { color: T.textMuted, marginTop: 2 },
                      ]}
                    >
                      {item.products?.internal_sku ??
                        item.barcode ??
                        "no barcode"}
                      {item.lot_number ? ` · LOT ${item.lot_number}` : ""}
                    </Text>
                    {item.qc_status ? (
                      <View style={styles.qcRow}>
                        <Text
                          style={[
                            type.labelSm,
                            {
                              letterSpacing: 1.5,
                              color:
                                item.qc_status === "hold"
                                  ? T.warning
                                  : item.qc_status === "passed"
                                  ? T.success
                                  : T.danger,
                            },
                          ]}
                        >
                          QC ·{" "}
                          {item.qc_status === "hold"
                            ? "ON HOLD"
                            : item.qc_status.toUpperCase()}
                        </Text>
                        {item.qc_status === "hold" &&
                        perms?.canEditProducts ? (
                          <View style={styles.qcActions}>
                            <Pressable
                              disabled={qcReviewingId === item.id}
                              onPress={() => confirmQc(item, "passed")}
                              style={[
                                styles.qcBtn,
                                { borderColor: T.success },
                              ]}
                            >
                              <Text
                                style={[
                                  type.labelSm,
                                  { color: T.success, letterSpacing: 1.5 },
                                ]}
                              >
                                PASS
                              </Text>
                            </Pressable>
                            <Pressable
                              disabled={qcReviewingId === item.id}
                              onPress={() => confirmQc(item, "failed")}
                              style={[styles.qcBtn, { borderColor: T.danger }]}
                            >
                              <Text
                                style={[
                                  type.labelSm,
                                  { color: T.danger, letterSpacing: 1.5 },
                                ]}
                              >
                                FAIL
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.lineQty}>
                    <Text
                      style={[
                        type.monoBody,
                        { color: done ? T.success : T.text, fontSize: 16 },
                      ]}
                    >
                      {recv}/{item.quantity_expected}
                    </Text>
                    {done ? (
                      <Icon name="check" size={14} color={T.success} />
                    ) : null}
                  </View>
                </View>
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
            No line items on this PO.
          </Text>
        )}

        {/* Notes */}
        {po.notes ? (
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
              {po.notes}
            </Text>
          </>
        ) : null}

        {/* Cancel */}
        {canCancel ? (
          <Pressable
            onPress={cancelPo}
            style={({ pressed }) => [
              styles.cancelBtn,
              {
                borderColor: T.danger,
                backgroundColor: pressed ? T.dangerDim : "transparent",
              },
            ]}
          >
            <Text style={[type.label, { color: T.danger, letterSpacing: 2 }]}>
              CANCEL PO
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Receive CTA pinned at the bottom */}
      {canReceive ? (
        <View
          style={[
            styles.ctaBar,
            { borderTopColor: T.borderSubtle, backgroundColor: T.bg },
          ]}
        >
          <Pressable
            onPress={() => {
              haptic.medium();
              setReceiveOpen(true);
            }}
            style={({ pressed }) => [
              styles.ctaPrimary,
              { backgroundColor: pressed ? T.accentBright : T.accent },
            ]}
            accessibilityLabel="Start receive run"
          >
            <Icon name="barcode" size={16} color="#000" strokeWidth={1.75} />
            <Text
              style={[
                type.label,
                { color: "#000", letterSpacing: 2, marginLeft: space.s8 },
              ]}
            >
              {po.status === "partially_received"
                ? "RESUME RECEIVING"
                : "START RECEIVING"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ReceiveRunSheet
        open={receiveOpen}
        po={po}
        items={po.po_line_items}
        onItemReceived={() => loadPo()}
        onComplete={async () => {
          // Determine final status based on item state
          const allDone = po.po_line_items.every((it) => isFullyReceived(it));
          const next: PoStatus = allDone
            ? "fully_received"
            : "partially_received";
          try {
            await supabase
              .from("purchase_orders")
              .update({ status: next })
              .eq("id", po.id);
            haptic.heavy();
            setReceiveOpen(false);
            await loadPo();
          } catch (e: any) {
            Alert.alert("Couldn't complete", e?.message ?? "Try again.");
          }
        }}
        onClose={() => setReceiveOpen(false)}
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

// ─────────────────────────────────────────────────────────────────────────────
// RECEIVE RUN SHEET — full-screen modal, hides tab bar
// ─────────────────────────────────────────────────────────────────────────────

function ReceiveRunSheet({
  open,
  po,
  items,
  onItemReceived,
  onComplete,
  onClose,
  theme: T,
  isOnline,
}: {
  open: boolean;
  po: PurchaseOrder;
  items: PoLineItem[];
  onItemReceived: () => void;
  onComplete: () => void | Promise<void>;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
  isOnline: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [receivingId, setReceivingId] = useState<string | null>(null);
  // Lot-tracked lines detour through this overlay to capture lot + expiry
  // before the receive writes (mirrors desktop receiveLineItem lot capture).
  const [lotTarget, setLotTarget] = useState<PoLineItem | null>(null);

  const totalExpected = items.reduce((s, i) => s + i.quantity_expected, 0);
  const totalReceived = items.reduce((s, i) => s + receivedQty(i), 0);
  const allReceived = totalExpected > 0 && totalReceived >= totalExpected;
  const remaining = items.filter((i) => !isFullyReceived(i));
  const completed = items.filter(isFullyReceived);

  function receiveItem(item: PoLineItem) {
    if (isFullyReceived(item) || receivingId) return;
    if (item.products?.track_lots && item.product_id) {
      haptic.light();
      setLotTarget(item);
      return;
    }
    void commitReceive(item, null);
  }

  /** Find-or-create the lot for this org+product, mirroring desktop. */
  async function resolveLot(
    item: PoLineItem,
    lot: { number: string; expiry: string | null },
    userId: string | null
  ): Promise<string | null> {
    const { data: existing } = await supabase
      .from("lots")
      .select("id")
      .eq("org_id", po.org_id)
      .eq("product_id", item.product_id!)
      .eq("lot_number", lot.number)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: created, error } = await supabase
      .from("lots")
      .insert({
        org_id: po.org_id,
        product_id: item.product_id,
        lot_number: lot.number,
        expires_at: lot.expiry,
        received_at: new Date().toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return created?.id ?? null;
  }

  async function commitReceive(
    item: PoLineItem,
    lot: { number: string; expiry: string | null } | null
  ) {
    setLotTarget(null);
    setReceivingId(item.id);
    haptic.medium();
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u?.user?.id ?? null;
      const now = new Date().toISOString();

      let lotId: string | null = null;
      if (lot?.number) {
        lotId = await resolveLot(item, lot, userId);
      }

      const { error: itemErr } = await supabase
        .from("po_line_items")
        .update({
          quantity_received: item.quantity_expected,
          received_by: userId,
          received_at: now,
          ...(lotId
            ? { lot_id: lotId, lot_number: lot!.number }
            : {}),
        })
        .eq("id", item.id);
      if (itemErr) throw itemErr;

      // Scan history — write only if a product_id exists; freeform line
      // items without a catalog product can't link to scan_history.product_id
      // (it's a FK to products). Skip those rows; the PO itself still
      // reflects the receive.
      if (item.product_id) {
        await supabase.from("scan_history").insert({
          product_id: item.product_id,
          warehouse_id: po.warehouse_id,
          scanned_by: userId,
          action: "receive",
          quantity: item.quantity_expected,
          notes: `PO ${po.po_number} · ${po.supplier_name}`,
          org_id: po.org_id,
        });
      }

      onItemReceived();
    } catch (e: any) {
      Alert.alert("Couldn't receive", e?.message ?? "Try again.");
    } finally {
      setReceivingId(null);
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
        {/* Task-flow top bar */}
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
            {po.po_number}
          </Text>

          {/* Live counter */}
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
              {String(totalReceived).padStart(2, "0")}
            </Text>
            <Text
              style={[type.monoSm, { color: T.textDim, marginHorizontal: 2 }]}
            >
              /
            </Text>
            <Text style={[type.monoBody, { color: T.textMuted, fontSize: 14 }]}>
              {String(totalExpected).padStart(2, "0")}
            </Text>
          </View>
        </View>

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
              OFFLINE · RECEIVES WILL SYNC ON RECONNECT
            </Text>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
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
                    isReceiving={receivingId === item.id}
                    isLast={idx === remaining.length - 1}
                    onPress={() => receiveItem(item)}
                    theme={T}
                  />
                ))}
              </View>
            </>
          ) : null}

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
                RECEIVED · {String(completed.length).padStart(2, "0")}
              </Text>
              <View style={[styles.runList, { borderColor: T.borderSubtle }]}>
                {completed.map((item, idx) => (
                  <RunRow
                    key={item.id}
                    item={item}
                    isReceiving={false}
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

        {/* Complete CTA */}
        {totalReceived > 0 ? (
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
                {
                  backgroundColor: allReceived
                    ? pressed
                      ? T.success
                      : T.success
                    : pressed
                    ? T.accentBright
                    : T.accent,
                },
              ]}
              accessibilityLabel={
                allReceived ? "Complete receipt" : "Save partial receipt"
              }
            >
              <Icon name="check" size={16} color="#000" strokeWidth={2} />
              <Text
                style={[
                  type.label,
                  { color: "#000", letterSpacing: 2, marginLeft: space.s8 },
                ]}
              >
                {allReceived ? "COMPLETE RECEIPT" : "SAVE PARTIAL"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {lotTarget ? (
          <LotCaptureOverlay
            item={lotTarget}
            theme={T}
            onSubmit={(lot) => void commitReceive(lotTarget, lot)}
            onSkip={() => void commitReceive(lotTarget, null)}
            onCancel={() => setLotTarget(null)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOT CAPTURE OVERLAY — lot number + optional expiry for lot-tracked products.
// ─────────────────────────────────────────────────────────────────────────────

function LotCaptureOverlay({
  item,
  theme: T,
  onSubmit,
  onSkip,
  onCancel,
}: {
  item: PoLineItem;
  theme: ReturnType<typeof useTheme>;
  onSubmit: (lot: { number: string; expiry: string | null }) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [lotNumber, setLotNumber] = useState(item.lot_number ?? "");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const num = lotNumber.trim();
    if (!num) {
      setError("Lot number is required (or skip lot capture).");
      return;
    }
    const exp = expiry.trim();
    if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
      setError("Expiry must be YYYY-MM-DD (or left blank).");
      return;
    }
    haptic.medium();
    onSubmit({ number: num, expiry: exp || null });
  }

  return (
    <View style={[styles.lotWrap, { backgroundColor: T.bg }]}>
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
          LOT CAPTURE
        </Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={{ padding: layout.contentPaddingH, gap: space.s12 }}>
        <Text style={[type.bodyLg, { color: T.text }]} numberOfLines={2}>
          {displayName(item)}
        </Text>
        <Text style={[type.monoSm, { color: T.textMuted }]}>
          This product is lot-tracked — record the supplier lot before
          receiving {item.quantity_expected} unit
          {item.quantity_expected === 1 ? "" : "s"}.
        </Text>

        <View
          style={[
            styles.lotField,
            { borderColor: T.borderSubtle, backgroundColor: T.surface2 },
          ]}
        >
          <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}>
            LOT NUMBER
          </Text>
          <TextInput
            value={lotNumber}
            onChangeText={(v) => {
              setLotNumber(v);
              setError(null);
            }}
            placeholder="e.g. L-240701-A"
            placeholderTextColor={T.textDim}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[type.monoBody, { color: T.text, padding: 0, marginTop: 6 }]}
          />
        </View>

        <View
          style={[
            styles.lotField,
            { borderColor: T.borderSubtle, backgroundColor: T.surface2 },
          ]}
        >
          <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}>
            EXPIRY · OPTIONAL
          </Text>
          <TextInput
            value={expiry}
            onChangeText={(v) => {
              setExpiry(v);
              setError(null);
            }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={T.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={[type.monoBody, { color: T.text, padding: 0, marginTop: 6 }]}
          />
        </View>

        {error ? (
          <View
            style={[
              styles.lotError,
              { borderLeftColor: T.danger, backgroundColor: T.dangerDim },
            ]}
          >
            <Text style={[type.monoSm, { color: T.danger }]}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={submit}
          style={({ pressed }) => [
            styles.lotSubmit,
            { backgroundColor: pressed ? T.accentBright : T.accent },
          ]}
        >
          <Text style={[type.label, { color: "#000", letterSpacing: 2 }]}>
            RECEIVE WITH LOT
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptic.light();
            onSkip();
          }}
          style={[styles.lotSkip, { borderColor: T.borderSubtle }]}
        >
          <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}>
            RECEIVE WITHOUT LOT
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function RunRow({
  item,
  isReceiving,
  isLast,
  onPress,
  completed,
  theme: T,
}: {
  item: PoLineItem;
  isReceiving: boolean;
  isLast: boolean;
  onPress: () => void;
  completed?: boolean;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={completed || isReceiving}
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
      <View
        style={[
          styles.lineAccent,
          { backgroundColor: completed ? T.success : T.accent },
        ]}
      />
      <View style={{ flex: 1 }}>
        <Text
          style={[type.bodyLg, { color: T.text, fontSize: 15 }]}
          numberOfLines={1}
        >
          {displayName(item)}
        </Text>
        <Text style={[type.monoSm, { color: T.textDim, marginTop: 2 }]}>
          {item.products?.internal_sku ?? item.barcode ?? "no barcode"}
        </Text>
      </View>
      <View style={styles.runRowRight}>
        {completed ? (
          <Icon name="check" size={20} color={T.success} />
        ) : isReceiving ? (
          <Text style={[type.labelSm, { color: T.accent, letterSpacing: 1.5 }]}>
            …
          </Text>
        ) : (
          <>
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
              {item.quantity_expected}
            </Text>
            <Text
              style={[type.labelSm, { color: T.textDim, letterSpacing: 1.5 }]}
            >
              TAP TO RECEIVE
            </Text>
          </>
        )}
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

  // Line row
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingRight: space.s16,
    paddingVertical: space.s12,
    minHeight: 56,
  },
  lineAccent: { width: 4, alignSelf: "stretch" },
  lineQty: { flexDirection: "row", alignItems: "center", gap: 6 },

  // Cancel button
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: layout.contentPaddingH,
    marginTop: space.s32,
    paddingVertical: space.s14,
    borderWidth: 1,
  },

  // Bottom CTA
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
  },

  // Receive run mode
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
    minHeight: 72,
  },
  runRowRight: {
    alignItems: "flex-end",
    minWidth: 60,
  },
  // QC disposition
  qcRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.s6,
  },
  qcActions: { flexDirection: "row", gap: space.s8 },
  qcBtn: {
    borderWidth: 1,
    paddingHorizontal: space.s12,
    paddingVertical: space.s4,
  },

  // Lot capture overlay
  lotWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  lotField: {
    borderWidth: 1,
    paddingHorizontal: space.s12,
    paddingVertical: space.s8,
  },
  lotError: {
    borderLeftWidth: 4,
    padding: space.s12,
  },
  lotSubmit: {
    alignItems: "center",
    paddingVertical: space.s14,
    marginTop: space.s8,
  },
  lotSkip: {
    alignItems: "center",
    paddingVertical: space.s12,
    borderWidth: 1,
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
});
