/**
 * Purchase orders — queue + create flow.
 *
 * Drop-in new screen at app/purchase-orders.tsx, routed from More menu.
 * Sibling to app/po/[id].tsx (detail + receive run).
 *
 * Surfaces:
 *
 *   1. **Queue** — POs for the current warehouse, status-filtered, sorted
 *      by expected_date asc. Each row: po_number, supplier, expected date
 *      with urgency tone, line item count, status badge. Tap → /po/[id].
 *
 *   2. **Create sheet** (full-screen) — supplier name + contact +
 *      expected date + notes, then add line items via a sub-sheet that
 *      either looks up an existing product by barcode/SKU OR records a
 *      freeform entry (product_name + barcode + qty). Save as draft, or
 *      "Save & send" to advance status straight to `sent`.
 *
 * Schema reminders:
 *   - purchase_orders.po_number is NOT NULL UNIQUE varchar(30) with no
 *     auto-generation trigger. Generated client-side here as
 *     `PO-<timestamp>`. Flagged for production-grade replacement with a
 *     SECURITY DEFINER trigger like orders has.
 *   - po_line_items.product_id is nullable — freeform line items
 *     reference only product_name + barcode.
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "../lib/nimbus/Header";
import { Icon } from "../lib/nimbus/Icon";
import { color, layout, space, type } from "../lib/nimbus/tokens";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { haptic } from "../lib/ui";
import { usePermissions } from "../lib/permissions";
import { useWarehouse } from "../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type PoStatus =
  | "draft"
  | "sent"
  | "partially_received"
  | "fully_received"
  | "cancelled";

interface PoRow {
  id: string;
  po_number: string;
  supplier_name: string;
  status: PoStatus;
  expected_date: string | null;
  created_at: string | null;
  po_line_items: { count: number } | { count: number }[] | null;
}

interface ProductLite {
  id: string;
  name: string;
  barcode: string;
  internal_sku: string | null;
}

interface DraftLineItem {
  // Local-only draft id (replaced by row id on save)
  localId: string;
  product_id: string | null;
  product_name: string;
  barcode: string;
  quantity_expected: number;
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

const FILTERS: { key: string; label: string; statuses: PoStatus[] | null }[] = [
  {
    key: "open",
    label: "OPEN",
    statuses: ["draft", "sent", "partially_received"],
  },
  { key: "all", label: "ALL", statuses: null },
  { key: "draft", label: "DRAFT", statuses: ["draft"] },
  { key: "sent", label: "SENT", statuses: ["sent"] },
  { key: "received", label: "RECEIVED", statuses: ["fully_received"] },
];

function expectedDateLabel(iso: string | null): string {
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

function expectedUrgency(
  iso: string | null,
  T: ReturnType<typeof useTheme>
): string {
  if (!iso) return T.textDim;
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return T.danger;
  if (days === 0) return T.warning;
  if (days <= 2) return T.accent;
  return T.textMuted;
}

function lineCount(po: PoRow): number {
  if (!po.po_line_items) return 0;
  const arr = Array.isArray(po.po_line_items)
    ? po.po_line_items
    : [po.po_line_items];
  return arr.reduce((s, x) => s + (x?.count ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function PurchaseOrdersScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();
  const perms = usePermissions();

  const [pos, setPos] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState("open");
  const [createOpen, setCreateOpen] = useState(false);

  // Ref, not a dep — a `refreshing` dependency re-fired the focus effect on
  // every pull-to-refresh.
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  const load = useCallback(async () => {
    if (!wh.warehouseId) return;
    if (!refreshingRef.current) setLoading(true);
    const { data } = await supabase
      .from("purchase_orders")
      .select(
        "id, po_number, supplier_name, status, expected_date, created_at, po_line_items(count)"
      )
      .eq("warehouse_id", wh.warehouseId)
      .order("expected_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) setPos(data as unknown as PoRow[]);
    setLoading(false);
    setRefreshing(false);
  }, [wh.warehouseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === activeFilter) ?? FILTERS[0];
    return f.statuses ? pos.filter((p) => f.statuses!.includes(p.status)) : pos;
  }, [pos, activeFilter]);

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={
          wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Inbound"
        }
        title="Purchase orders"
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={18} color={T.text} />
          </Pressable>
        }
        trailing={
          perms.canCreatePurchaseOrders ? (
            <Pressable
              onPress={() => {
                haptic.light();
                setCreateOpen(true);
              }}
              hitSlop={10}
              accessibilityLabel="New purchase order"
            >
              <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
                + NEW
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      {/* Status filter strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
        style={{ borderBottomWidth: 1, borderBottomColor: T.borderSubtle }}
      >
        {FILTERS.map((f) => {
          const isActive = activeFilter === f.key;
          const count = f.statuses
            ? pos.filter((p) => f.statuses!.includes(p.status)).length
            : pos.length;
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

      {loading && pos.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}
          >
            NO PURCHASE ORDERS · 00
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
            Tap "+ NEW" to create a draft PO, or switch the filter to see
            different statuses.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PoRowCard
              po={item}
              theme={T}
              onPress={() => {
                haptic.light();
                router.push(`/po/${item.id}` as any);
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

      <CreatePoSheet
        open={createOpen}
        warehouseId={wh.warehouseId}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
        onClose={() => setCreateOpen(false)}
        theme={T}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST ROW
// ─────────────────────────────────────────────────────────────────────────────

function PoRowCard({
  po,
  theme: T,
  onPress,
}: {
  po: PoRow;
  theme: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  const tone = statusTone(po.status, T);
  const urgency = expectedUrgency(po.expected_date, T);
  const items = lineCount(po);

  // 4px left border when late and not fully received / cancelled
  const isLate =
    po.expected_date &&
    new Date(po.expected_date) < new Date(new Date().setHours(0, 0, 0, 0)) &&
    po.status !== "fully_received" &&
    po.status !== "cancelled";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? T.surface2 : "transparent",
          borderBottomColor: T.borderFaint,
          borderLeftColor: isLate ? T.danger : "transparent",
          borderLeftWidth: 4,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text
            style={[
              type.monoBody,
              { color: T.accent, fontSize: 14, letterSpacing: -0.3 },
            ]}
          >
            {po.po_number}
          </Text>
          <Text style={[type.labelSm, { color: tone, letterSpacing: 1.5 }]}>
            {STATUS_LABEL[po.status]}
          </Text>
        </View>
        <Text
          style={[type.bodyLg, { color: T.text, fontSize: 15, marginTop: 4 }]}
          numberOfLines={1}
        >
          {po.supplier_name}
        </Text>
        <View style={styles.rowBottom}>
          <Text style={[type.labelSm, { color: urgency, letterSpacing: 1.5 }]}>
            {expectedDateLabel(po.expected_date)}
          </Text>
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
// CREATE PO SHEET
// ─────────────────────────────────────────────────────────────────────────────

function CreatePoSheet({
  open,
  warehouseId,
  onSaved,
  onClose,
  theme: T,
}: {
  open: boolean;
  warehouseId: string | null;
  onSaved: () => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();

  // Org of the active warehouse (users can belong to several orgs).
  const { orgId: activeOrgId } = useWarehouse();
  const orgId = activeOrgId || null;
  const [supplierName, setSupplierName] = useState("");
  const [supplierContact, setSupplierContact] = useState("");
  const [expectedDate, setExpectedDate] = useState(""); // YYYY-MM-DD
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftLineItem[]>([]);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierName("");
    setSupplierContact("");
    setExpectedDate("");
    setNotes("");
    setItems([]);
  }, [open]);

  async function commit(sendAfter: boolean) {
    if (!warehouseId || !orgId) {
      Alert.alert("Not ready", "Workspace or facility not loaded yet.");
      return;
    }
    if (!supplierName.trim()) {
      Alert.alert("Supplier required");
      return;
    }
    if (items.length === 0) {
      Alert.alert("Add at least one line item");
      return;
    }
    setSaving(true);
    haptic.medium();

    try {
      // Atomic create: header + line items in one transaction, with
      // po_number generated server-side (race-free). Replaces the old
      // client-side two-step insert that could orphan a PO header if the
      // line-item insert failed, and the race-prone Date.now() stamp.
      const { data: po, error } = await supabase.rpc("create_purchase_order", {
        p_warehouse_id: warehouseId,
        p_org_id: orgId,
        p_supplier_name: supplierName.trim(),
        p_supplier_contact: supplierContact.trim() || null,
        p_status: sendAfter ? "sent" : "draft",
        p_expected_date: expectedDate.trim() || null,
        p_notes: notes.trim() || null,
        p_items: items.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          barcode: it.barcode || null,
          quantity_expected: it.quantity_expected,
        })),
      });
      if (error || !po) throw error ?? new Error("PO insert failed");

      haptic.success();
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
            <Text
              style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}
            >
              CANCEL
            </Text>
          </Pressable>
          <Text style={[type.displayXs, { color: T.text }]}>New PO</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: layout.contentPaddingH,
            gap: space.s20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Supplier */}
          <Field theme={T} label="Supplier">
            <TextInput
              value={supplierName}
              onChangeText={setSupplierName}
              placeholder="Vendor / supplier name"
              placeholderTextColor={T.textDim}
              autoCapitalize="words"
              style={[type.body, { color: T.text, padding: 0 }]}
            />
          </Field>
          <Field theme={T} label="Contact · optional">
            <TextInput
              value={supplierContact}
              onChangeText={setSupplierContact}
              placeholder="Email or phone"
              placeholderTextColor={T.textDim}
              autoCapitalize="none"
              style={[type.body, { color: T.text, padding: 0 }]}
            />
          </Field>
          <Field theme={T} label="Expected · YYYY-MM-DD">
            <TextInput
              value={expectedDate}
              onChangeText={setExpectedDate}
              placeholder="2026-06-01"
              placeholderTextColor={T.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                type.monoBody,
                { color: T.text, padding: 0, fontSize: 14 },
              ]}
            />
          </Field>

          {/* Line items */}
          <View>
            <View style={sheetStyles.itemsHeader}>
              <Text
                style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}
              >
                LINE ITEMS · {String(items.length).padStart(2, "0")}
              </Text>
              <Pressable
                onPress={() => {
                  haptic.light();
                  setAddItemOpen(true);
                }}
                hitSlop={10}
              >
                <Text
                  style={[type.label, { color: T.accent, letterSpacing: 2 }]}
                >
                  + ADD
                </Text>
              </Pressable>
            </View>

            {items.length === 0 ? (
              <Text
                style={[
                  type.bodySm,
                  {
                    color: T.textDim,
                    textAlign: "center",
                    paddingVertical: space.s24,
                  },
                ]}
              >
                No items yet. Tap "+ ADD" to scan or enter a product.
              </Text>
            ) : (
              <View
                style={[sheetStyles.itemsList, { borderColor: T.borderSubtle }]}
              >
                {items.map((it, idx) => (
                  <View
                    key={it.localId}
                    style={[
                      sheetStyles.itemRow,
                      {
                        borderBottomColor: T.borderFaint,
                        borderBottomWidth:
                          idx === items.length - 1 ? 0 : layout.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[type.body, { color: T.text, fontSize: 14 }]}
                        numberOfLines={1}
                      >
                        {it.product_name}
                      </Text>
                      <Text
                        style={[
                          type.monoSm,
                          { color: T.textMuted, marginTop: 2 },
                        ]}
                      >
                        {it.barcode || "no barcode"}
                      </Text>
                    </View>
                    <Text
                      style={[type.monoBody, { color: T.text, fontSize: 16 }]}
                    >
                      × {it.quantity_expected}
                    </Text>
                    <Pressable
                      onPress={() => {
                        haptic.selection();
                        setItems((cur) =>
                          cur.filter((x) => x.localId !== it.localId)
                        );
                      }}
                      hitSlop={10}
                      style={{ marginLeft: space.s12 }}
                    >
                      <Icon name="x" size={14} color={T.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>

          <Field theme={T} label="Notes · optional">
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Special instructions, delivery notes, etc."
              placeholderTextColor={T.textDim}
              multiline
              style={[
                type.body,
                {
                  color: T.text,
                  padding: 0,
                  minHeight: 60,
                  textAlignVertical: "top",
                },
              ]}
            />
          </Field>

          {/* Actions */}
          <View style={{ gap: space.s12, marginTop: space.s12 }}>
            <Pressable
              onPress={() => commit(true)}
              disabled={saving || !supplierName.trim() || items.length === 0}
              style={({ pressed }) => [
                sheetStyles.primary,
                {
                  backgroundColor: pressed ? T.accentBright : T.accent,
                  opacity:
                    saving || !supplierName.trim() || items.length === 0
                      ? 0.6
                      : 1,
                },
              ]}
            >
              <Text
                style={[type.label, { color: color.black, letterSpacing: 2 }]}
              >
                {saving ? "SAVING…" : "SAVE & SEND"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => commit(false)}
              disabled={saving || !supplierName.trim() || items.length === 0}
              style={({ pressed }) => [
                sheetStyles.ghost,
                {
                  borderColor: T.borderSubtle,
                  backgroundColor: pressed ? T.surface2 : "transparent",
                },
              ]}
            >
              <Text style={[type.label, { color: T.text, letterSpacing: 2 }]}>
                SAVE AS DRAFT
              </Text>
            </Pressable>
          </View>

          <View style={{ height: insets.bottom + space.s24 }} />
        </ScrollView>

        <AddLineItemSheet
          open={addItemOpen}
          onAdd={(line) => {
            setItems((cur) => [...cur, line]);
            setAddItemOpen(false);
          }}
          onClose={() => setAddItemOpen(false)}
          theme={T}
        />
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD LINE ITEM SHEET — barcode lookup OR freeform entry
// ─────────────────────────────────────────────────────────────────────────────

function AddLineItemSheet({
  open,
  onAdd,
  onClose,
  theme: T,
}: {
  open: boolean;
  onAdd: (line: DraftLineItem) => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();
  const { orgId } = useWarehouse();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<ProductLite | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookupTried, setLookupTried] = useState(false);
  const [manualName, setManualName] = useState("");
  const [quantity, setQuantity] = useState("1");

  useEffect(() => {
    if (open) {
      setCode("");
      setFound(null);
      setLookupTried(false);
      setManualName("");
      setQuantity("1");
    }
  }, [open]);

  async function lookup() {
    // Sanitize before interpolating into the PostgREST .or() filter — a
    // scanned value containing , ( ) . injects extra filter clauses.
    const term = code.trim().replace(/[^A-Za-z0-9_-]/g, "");
    if (!term) return;
    setSearching(true);
    try {
      const { data } = await supabase
        .from("products")
        .select("id, name, barcode, internal_sku")
        .eq("org_id", orgId)
        .or(`barcode.eq.${term},internal_sku.eq.${term}`)
        .limit(1)
        .maybeSingle();
      setFound((data as unknown as ProductLite) ?? null);
      setLookupTried(true);
      haptic.light();
    } finally {
      setSearching(false);
    }
  }

  function commit() {
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) {
      Alert.alert("Quantity required");
      return;
    }

    if (found) {
      onAdd({
        localId: `${Date.now()}-${Math.random()}`,
        product_id: found.id,
        product_name: found.name,
        barcode: found.barcode,
        quantity_expected: qty,
      });
    } else {
      if (!manualName.trim()) {
        Alert.alert("Product name required for manual entry");
        return;
      }
      onAdd({
        localId: `${Date.now()}-${Math.random()}`,
        product_id: null,
        product_name: manualName.trim(),
        barcode: code.trim(),
        quantity_expected: qty,
      });
    }
    haptic.success();
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
            <Text
              style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}
            >
              CANCEL
            </Text>
          </Pressable>
          <Text style={[type.displayXs, { color: T.text }]}>Add item</Text>
          <Pressable onPress={commit} hitSlop={10}>
            <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
              ADD
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: layout.contentPaddingH,
            gap: space.s20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View>
            <Text
              style={[
                type.label,
                {
                  color: T.textMuted,
                  letterSpacing: 2,
                  marginBottom: space.s8,
                },
              ]}
            >
              PRODUCT
            </Text>
            <View
              style={[
                sheetStyles.barcodeRow,
                { borderColor: T.borderSubtle, backgroundColor: T.bgElevated },
              ]}
            >
              <Icon name="barcode" size={14} color={T.textDim} />
              <TextInput
                value={code}
                onChangeText={(v) => {
                  setCode(v);
                  setLookupTried(false);
                  setFound(null);
                }}
                placeholder="Scan or type barcode / SKU"
                placeholderTextColor={T.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={lookup}
                returnKeyType="search"
                style={[
                  type.monoBody,
                  { flex: 1, color: T.text, padding: 0, fontSize: 14 },
                ]}
              />
              {code.length > 0 ? (
                <Pressable onPress={lookup} hitSlop={10}>
                  <Text
                    style={[
                      type.labelSm,
                      { color: T.accent, letterSpacing: 1.5 },
                    ]}
                  >
                    {searching ? "…" : "LOOKUP"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {found ? (
            <View style={[sheetStyles.foundCard, { borderColor: T.success }]}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[type.labelSm, { color: T.success, letterSpacing: 2 }]}
                >
                  FOUND
                </Text>
                <Text
                  style={[type.displayXs, { color: T.text, marginTop: 4 }]}
                  numberOfLines={1}
                >
                  {found.name}
                </Text>
                <Text
                  style={[type.monoSm, { color: T.textMuted, marginTop: 2 }]}
                >
                  {found.internal_sku ?? found.barcode}
                </Text>
              </View>
            </View>
          ) : lookupTried && code.trim() ? (
            <View style={{ gap: space.s12 }}>
              <View style={[sheetStyles.notFound, { borderColor: T.warning }]}>
                <Icon name="alert-circle" size={14} color={T.warning} />
                <Text
                  style={[
                    type.bodySm,
                    { color: T.warning, marginLeft: space.s8, fontSize: 13 },
                  ]}
                >
                  Not in catalog. Enter manually below — it'll be registered
                  when received.
                </Text>
              </View>
              <Field theme={T} label="Product name">
                <TextInput
                  value={manualName}
                  onChangeText={setManualName}
                  placeholder="e.g. Oak hardwood, 24 sqft"
                  placeholderTextColor={T.textDim}
                  autoCapitalize="words"
                  style={[type.body, { color: T.text, padding: 0 }]}
                />
              </Field>
            </View>
          ) : null}

          <View>
            <Text
              style={[
                type.label,
                {
                  color: T.textMuted,
                  letterSpacing: 2,
                  marginBottom: space.s8,
                },
              ]}
            >
              EXPECTED QUANTITY
            </Text>
            <View style={sheetStyles.qtyRow}>
              <Pressable
                onPress={() => {
                  haptic.selection();
                  const n = parseInt(quantity, 10) || 1;
                  if (n > 1) setQuantity(String(n - 1));
                }}
                style={[
                  sheetStyles.qtyBtn,
                  {
                    borderColor: T.borderSubtle,
                    backgroundColor: T.bgElevated,
                  },
                ]}
              >
                <Text
                  style={[type.displayMd, { color: T.textMuted, fontSize: 20 }]}
                >
                  −
                </Text>
              </Pressable>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
                style={[
                  sheetStyles.qtyInput,
                  type.monoBody,
                  {
                    color: T.text,
                    borderColor: T.borderSubtle,
                    backgroundColor: T.bgElevated,
                  },
                ]}
              />
              <Pressable
                onPress={() => {
                  haptic.selection();
                  const n = parseInt(quantity, 10) || 0;
                  setQuantity(String(n + 1));
                }}
                style={[
                  sheetStyles.qtyBtn,
                  {
                    borderColor: T.borderSubtle,
                    backgroundColor: T.bgElevated,
                  },
                ]}
              >
                <Text
                  style={[type.displayMd, { color: T.accent, fontSize: 20 }]}
                >
                  +
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={{ height: insets.bottom + space.s24 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD WRAPPER
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
          sheetStyles.fieldShell,
          { borderColor: T.borderSubtle, backgroundColor: T.bgElevated },
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
    alignItems: "center",
    paddingVertical: space.s12,
    paddingRight: layout.contentPaddingH,
    paddingLeft: layout.contentPaddingH - 4,
    borderBottomWidth: layout.hairlineWidth,
    gap: space.s12,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
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

  fieldShell: {
    borderWidth: layout.hairlineWidth,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
  },

  itemsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.s12,
  },
  itemsList: {
    borderWidth: layout.hairlineWidth,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
    minHeight: 56,
  },

  barcodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
    borderWidth: layout.hairlineWidth,
  },
  foundCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: space.s16,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  notFound: {
    flexDirection: "row",
    alignItems: "center",
    padding: space.s12,
    borderWidth: 1,
    borderLeftWidth: 4,
  },

  qtyRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space.s8,
  },
  qtyBtn: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: layout.hairlineWidth,
  },
  qtyInput: {
    flex: 1,
    textAlign: "center",
    fontSize: 22,
    borderWidth: layout.hairlineWidth,
    paddingHorizontal: space.s12,
  },

  primary: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s16,
  },
  ghost: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s14,
    borderWidth: 1,
  },
});
