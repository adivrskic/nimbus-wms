/**
 * Returns — list view + log-return form sheet.
 *
 * Drop-in new screen at app/returns.tsx (routed from the More menu).
 * No tab.
 *
 * Surfaces:
 *
 *   1. **List** — returns for the current warehouse, sorted by date
 *      desc. Each row: product name, quantity, disposition badge,
 *      reason, relative time. Tap → detail sheet (read-only).
 *
 *   2. **Log sheet** (full-screen) — opens via "+ NEW" in the header.
 *      Barcode/SKU lookup → product found → quantity stepper +
 *      disposition radio + optional reason. On save: INSERT returns
 *      row + INSERT scan_history with action='return'.
 *
 * Photo capture is intentionally not included in this round — the
 * scanner screen already handles the same expo-camera flow and the
 * pattern's been established. Easy to drop into the log sheet later
 * once we extract a shared <PhotoCapture /> primitive.
 *
 * Schema (verified):
 *   returns: id, warehouse_id, product_id, order_id (null), quantity,
 *            disposition (enum: restock/damaged/hold_for_inspection/
 *            supplier_return), reason, photo_url, received_by,
 *            reviewed_by, reviewed_at, created_at, org_id
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { usePermissions } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { haptic } from "../lib/ui";
import { useWarehouse } from "../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Disposition =
  | "restock"
  | "damaged"
  | "hold_for_inspection"
  | "supplier_return";

interface ProductLite {
  id: string;
  name: string;
  barcode: string;
  internal_sku: string | null;
}

interface ReturnRow {
  id: string;
  quantity: number;
  disposition: Disposition;
  reason: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  restocked_at: string | null;
  products: ProductLite | null;
}

/** Reviewed restock-disposition returns that haven't been restocked yet. */
function isRestockable(r: ReturnRow): boolean {
  return (
    r.disposition === "restock" &&
    !!r.reviewed_at &&
    !r.restocked_at &&
    !!r.products
  );
}

const DISPOSITION_LABEL: Record<Disposition, string> = {
  restock: "RESTOCK",
  damaged: "DAMAGED",
  hold_for_inspection: "HOLD",
  supplier_return: "SUPPLIER",
};

function dispositionTone(
  d: Disposition,
  T: ReturnType<typeof useTheme>
): string {
  switch (d) {
    case "restock":
      return T.success;
    case "damaged":
      return T.danger;
    case "hold_for_inspection":
      return T.warning;
    case "supplier_return":
      return T.info;
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN — list
// ─────────────────────────────────────────────────────────────────────────────

export default function ReturnsScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();
  const perms = usePermissions();

  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [restockTarget, setRestockTarget] = useState<ReturnRow | null>(null);

  // Ref, not a dep — a `refreshing` dependency re-fired the focus effect on
  // every pull-to-refresh.
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  const load = useCallback(async () => {
    if (!wh.warehouseId) return;
    if (!refreshingRef.current) setLoading(true);
    const { data } = await supabase
      .from("returns")
      .select(
        "id, quantity, disposition, reason, created_at, reviewed_at, restocked_at, " +
          "products(id, name, barcode, internal_sku)"
      )
      .eq("warehouse_id", wh.warehouseId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) setReturns(data as unknown as ReturnRow[]);
    setLoading(false);
    setRefreshing(false);
  }, [wh.warehouseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={
          wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Returns"
        }
        title="Returns"
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
          perms.canProcessReturns ? (
            <Pressable
              onPress={() => {
                haptic.light();
                setLogOpen(true);
              }}
              hitSlop={10}
              accessibilityLabel="Log a new return"
            >
              <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
                + NEW
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      {loading && returns.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : returns.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}
          >
            NO RETURNS · 00
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
            Nothing logged yet
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
            Tap "+ NEW" to log a damaged unit, restock a return, or send
            something back to the supplier.
          </Text>
          <Pressable
            onPress={() => {
              haptic.light();
              setLogOpen(true);
            }}
            style={({ pressed }) => [
              styles.emptyCta,
              { backgroundColor: pressed ? T.accentBright : T.accent },
            ]}
          >
            <Text
              style={[type.label, { color: color.black, letterSpacing: 2 }]}
            >
              LOG A RETURN
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={returns}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ReturnRowItem
              item={item}
              theme={T}
              onRestock={
                perms.canProcessReturns && isRestockable(item)
                  ? () => setRestockTarget(item)
                  : undefined
              }
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

      <LogReturnSheet
        open={logOpen}
        warehouseId={wh.warehouseId}
        onSaved={() => {
          setLogOpen(false);
          load();
        }}
        onClose={() => setLogOpen(false)}
        theme={T}
      />

      <RestockSheet
        target={restockTarget}
        warehouseId={wh.warehouseId}
        onDone={() => {
          setRestockTarget(null);
          load();
        }}
        onClose={() => setRestockTarget(null)}
        theme={T}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST ROW
// ─────────────────────────────────────────────────────────────────────────────

function ReturnRowItem({
  item,
  theme: T,
  onRestock,
}: {
  item: ReturnRow;
  theme: ReturnType<typeof useTheme>;
  onRestock?: () => void;
}) {
  const tone = dispositionTone(item.disposition, T);
  return (
    <View
      style={[
        styles.row,
        {
          borderBottomColor: T.borderFaint,
          // §9.5 alert escalation for damaged / hold items
          borderLeftColor:
            item.disposition === "damaged"
              ? T.danger
              : item.disposition === "hold_for_inspection"
              ? T.warning
              : "transparent",
          borderLeftWidth: 4,
        },
      ]}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[type.labelSm, { color: tone, letterSpacing: 1.5 }]}>
            {DISPOSITION_LABEL[item.disposition]}
          </Text>
          <Text style={[type.monoSm, { color: T.textDim }]}>
            {formatRelative(item.created_at)}
          </Text>
        </View>
        <Text
          style={[type.body, { color: T.text, marginTop: 4, fontSize: 14 }]}
          numberOfLines={1}
        >
          {item.products?.name ?? "Unknown product"}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={[type.monoSm, { color: T.textMuted }]}>
            × {item.quantity}
          </Text>
          {item.products?.internal_sku ? (
            <>
              <Text style={[type.monoSm, { color: T.textDim }]}> · </Text>
              <Text style={[type.monoSm, { color: T.textMuted }]}>
                {item.products.internal_sku}
              </Text>
            </>
          ) : null}
          {item.reviewed_at ? (
            <>
              <Text style={[type.monoSm, { color: T.textDim }]}> · </Text>
              <Text
                style={[type.labelSm, { color: T.success, letterSpacing: 1.5 }]}
              >
                REVIEWED
              </Text>
            </>
          ) : null}
        </View>
        {item.reason ? (
          <Text
            style={[
              type.bodySm,
              { color: T.textMuted, marginTop: 4, fontSize: 13 },
            ]}
            numberOfLines={2}
          >
            {item.reason}
          </Text>
        ) : null}
        {item.restocked_at ? (
          <Text
            style={[
              type.labelSm,
              { color: T.success, letterSpacing: 1.5, marginTop: 6 },
            ]}
          >
            RESTOCKED · {formatRelative(item.restocked_at)}
          </Text>
        ) : null}
        {onRestock ? (
          <Pressable
            onPress={() => {
              haptic.light();
              onRestock();
            }}
            style={({ pressed }) => [
              styles.restockBtn,
              {
                borderColor: T.accent,
                backgroundColor: pressed ? T.accentDim : "transparent",
              },
            ]}
          >
            <Text style={[type.labelSm, { color: T.accent, letterSpacing: 1.5 }]}>
              RESTOCK TO INVENTORY →
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESTOCK SHEET — pick a destination location, credit stock atomically via
// the app.restock_return RPC (locks return + location; audits scan_history).
// ─────────────────────────────────────────────────────────────────────────────

interface RestockLocation {
  id: string;
  bay: number | null;
  level: number | null;
  quantity: number | null;
  quarantined: boolean | null;
  is_active: boolean | null;
  product_id: string | null;
  sections: { code: string | null; name: string | null } | null;
}

function RestockSheet({
  target,
  warehouseId,
  onDone,
  onClose,
  theme: T,
}: {
  target: ReturnRow | null;
  warehouseId: string | null;
  onDone: () => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();
  const { orgId, userId } = useWarehouse();
  const [locations, setLocations] = useState<RestockLocation[]>([]);
  const [loadingLocs, setLoadingLocs] = useState(false);
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target?.products || !warehouseId) return;
    setQty(target.quantity);
    setLoadingLocs(true);
    (async () => {
      // Destination candidates: this product's active, unquarantined slots
      // at the facility, plus empty slots the RPC can claim.
      const { data } = await supabase
        .from("locations")
        .select(
          "id, bay, level, quantity, quarantined, is_active, product_id, sections(code, name)"
        )
        .eq("warehouse_id", warehouseId)
        .eq("is_active", true)
        .eq("quarantined", false)
        .or(`product_id.eq.${target.products!.id},product_id.is.null`)
        .order("quantity", { ascending: false })
        .limit(30);
      setLocations((data as unknown as RestockLocation[]) ?? []);
      setLoadingLocs(false);
    })();
  }, [target, warehouseId]);

  async function restockTo(locationId: string) {
    if (!target || !orgId || !userId || saving) return;
    setSaving(true);
    haptic.medium();
    const { data, error } = await supabase.rpc("restock_return", {
      p_org_id: orgId,
      p_return_id: target.id,
      p_location_id: locationId,
      p_qty: qty,
      p_by: userId,
    });
    setSaving(false);
    const r = (data ?? {}) as { ok?: boolean; error?: string };
    if (error || !r.ok) {
      const code = error?.message ?? r.error ?? "unknown";
      const friendly: Record<string, string> = {
        already_restocked: "This return was already restocked.",
        not_restockable:
          "This return needs a desk review sign-off (disposition: restock) first.",
        location_unavailable: "That slot is quarantined or inactive.",
        location_holds_other_product: "That slot holds a different product.",
        warehouse_mismatch: "That slot is in a different facility.",
        invalid_qty: "Quantity exceeds the returned amount.",
      };
      Alert.alert("Couldn't restock", friendly[code] ?? code);
      return;
    }
    haptic.success();
    onDone();
  }

  return (
    <Modal
      visible={!!target}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.sheetBackdrop, { backgroundColor: T.modalBackdrop }]}>
        <View
          style={[
            styles.sheetBody,
            {
              backgroundColor: T.bgElevated,
              borderTopColor: T.borderSubtle,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
            RESTOCK RETURN
          </Text>
          <Text style={[type.bodyLg, { color: T.text, marginTop: 8 }]}>
            {target?.products?.name}
          </Text>

          {/* Quantity stepper (partial restock allowed) */}
          <View style={styles.restockQtyRow}>
            <Text style={[type.labelSm, { color: T.textMuted }]}>QTY</Text>
            <View style={styles.restockQtyControls}>
              <Pressable
                onPress={() => {
                  haptic.light();
                  setQty((q) => Math.max(1, q - 1));
                }}
                style={[styles.restockQtyBtn, { borderColor: T.borderSubtle }]}
              >
                <Icon name="minus" size={14} color={T.textMuted} />
              </Pressable>
              <Text style={[type.monoBody, { color: T.text, minWidth: 36, textAlign: "center" }]}>
                {qty}
              </Text>
              <Pressable
                onPress={() => {
                  haptic.light();
                  setQty((q) => Math.min(target?.quantity ?? q, q + 1));
                }}
                style={[styles.restockQtyBtn, { borderColor: T.borderSubtle }]}
              >
                <Icon name="plus" size={14} color={T.accent} />
              </Pressable>
            </View>
            <Text style={[type.monoSm, { color: T.textDim }]}>
              of {target?.quantity}
            </Text>
          </View>

          <Text
            style={[
              type.labelSm,
              { color: T.textMuted, letterSpacing: 1.5, marginTop: 16 },
            ]}
          >
            DESTINATION SLOT
          </Text>
          {loadingLocs ? (
            <ActivityIndicator
              color={T.accent}
              size="small"
              style={{ marginTop: 16 }}
            />
          ) : locations.length === 0 ? (
            <Text style={[type.bodySm, { color: T.textMuted, marginTop: 12 }]}>
              No eligible slots at this facility.
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 280, marginTop: 8 }}>
              {locations.map((loc) => (
                <Pressable
                  key={loc.id}
                  disabled={saving}
                  onPress={() => restockTo(loc.id)}
                  style={({ pressed }) => [
                    styles.restockLocRow,
                    {
                      borderBottomColor: T.borderFaint,
                      backgroundColor: pressed ? T.surface2 : "transparent",
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[type.monoBody, { color: T.text }]}>
                      {loc.sections?.code ?? "?"} · Bay {loc.bay ?? "?"} · L
                      {loc.level ?? "?"}
                    </Text>
                    <Text style={[type.monoSm, { color: T.textMuted }]}>
                      {loc.product_id
                        ? `holds ${loc.quantity ?? 0} on hand`
                        : "empty slot"}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={14} color={T.textDim} />
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Pressable
            onPress={onClose}
            style={[styles.restockCancel, { borderColor: T.borderSubtle }]}
          >
            <Text style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}>
              CANCEL
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG RETURN SHEET — full-screen
// ─────────────────────────────────────────────────────────────────────────────

const DISPOSITIONS: {
  value: Disposition;
  label: string;
  description: string;
}[] = [
  { value: "restock", label: "RESTOCK", description: "Put back in inventory" },
  { value: "damaged", label: "DAMAGED", description: "Write off as loss" },
  {
    value: "hold_for_inspection",
    label: "HOLD",
    description: "Inspect before deciding",
  },
  {
    value: "supplier_return",
    label: "SUPPLIER",
    description: "Send back to supplier",
  },
];

function LogReturnSheet({
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
  const [code, setCode] = useState("");
  const [lookupTried, setLookupTried] = useState(false);
  const [product, setProduct] = useState<ProductLite | null>(null);
  const [searching, setSearching] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [disposition, setDisposition] = useState<Disposition>("restock");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setCode("");
      setLookupTried(false);
      setProduct(null);
      setQuantity("1");
      setDisposition("restock");
      setReason("");
    }
  }, [open]);

  async function lookup() {
    // Sanitize before interpolating into the PostgREST .or() filter — a
    // scanned value containing , ( ) . injects extra filter clauses.
    const term = code.trim().replace(/[^A-Za-z0-9_-]/g, "");
    if (!term) {
      Alert.alert("Invalid code", "Scan or type a product barcode or SKU.");
      return;
    }
    setSearching(true);
    haptic.light();
    try {
      const { data } = await supabase
        .from("products")
        .select("id, name, barcode, internal_sku")
        .eq("org_id", orgId)
        .or(`barcode.eq.${term},internal_sku.eq.${term}`)
        .limit(1)
        .maybeSingle();
      setProduct((data as unknown as ProductLite) ?? null);
      setLookupTried(true);
    } catch (e: any) {
      Alert.alert("Lookup failed", e?.message ?? "Try again.");
    } finally {
      setSearching(false);
    }
  }

  async function commit() {
    if (!product || !warehouseId || !orgId) return;
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) {
      Alert.alert("Quantity required", "Enter a positive whole number.");
      return;
    }

    setSaving(true);
    haptic.medium();
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u?.user?.id ?? null;

      const { error: rErr } = await supabase.from("returns").insert({
        warehouse_id: warehouseId,
        product_id: product.id,
        quantity: qty,
        disposition,
        reason: reason.trim() || null,
        received_by: userId,
        org_id: orgId,
      });
      if (rErr) throw rErr;

      await supabase.from("scan_history").insert({
        product_id: product.id,
        warehouse_id: warehouseId,
        scanned_by: userId,
        action: "return",
        quantity: qty,
        notes: `${DISPOSITION_LABEL[disposition]}${
          reason ? ` · ${reason}` : ""
        }`,
        org_id: orgId,
      });

      haptic.success();
      onSaved();
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!product && !!quantity.trim() && !saving;

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[sheetStyles.wrap, { backgroundColor: T.bg }]}>
        {/* Top bar */}
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
          <Text style={[type.displayXs, { color: T.text }]}>Log return</Text>
          <Pressable onPress={commit} disabled={!canSave} hitSlop={10}>
            <Text
              style={[
                type.label,
                {
                  color: canSave ? T.accent : T.textDim,
                  letterSpacing: 2,
                },
              ]}
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
          keyboardShouldPersistTaps="handled"
        >
          {/* Step 1 — product lookup */}
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
                onChangeText={setCode}
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
                <Pressable onPress={lookup} disabled={searching} hitSlop={10}>
                  <Text
                    style={[
                      type.labelSm,
                      {
                        color: searching ? T.textDim : T.accent,
                        letterSpacing: 1.5,
                      },
                    ]}
                  >
                    {searching ? "…" : "LOOKUP"}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* Lookup result */}
            {product ? (
              <View
                style={[
                  sheetStyles.foundCard,
                  { borderColor: T.success, marginTop: space.s12 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      type.labelSm,
                      { color: T.success, letterSpacing: 2 },
                    ]}
                  >
                    FOUND
                  </Text>
                  <Text
                    style={[type.displayXs, { color: T.text, marginTop: 4 }]}
                    numberOfLines={1}
                  >
                    {product.name}
                  </Text>
                  <Text
                    style={[type.monoSm, { color: T.textMuted, marginTop: 2 }]}
                  >
                    {product.internal_sku ?? product.barcode}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setProduct(null);
                    setLookupTried(false);
                  }}
                  hitSlop={10}
                >
                  <Icon name="x" size={14} color={T.textMuted} />
                </Pressable>
              </View>
            ) : lookupTried ? (
              <View
                style={[
                  sheetStyles.notFound,
                  { borderColor: T.warning, marginTop: space.s12 },
                ]}
              >
                <Icon name="alert-circle" size={14} color={T.warning} />
                <Text
                  style={[
                    type.bodySm,
                    { color: T.warning, marginLeft: space.s8, fontSize: 13 },
                  ]}
                >
                  No product matches "{code}". Check the barcode and try again.
                </Text>
              </View>
            ) : null}
          </View>

          {/* Step 2 — quantity (only when product is found) */}
          {product ? (
            <>
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
                  QUANTITY
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
                    hitSlop={4}
                  >
                    <Text
                      style={[
                        type.displayMd,
                        { color: T.textMuted, fontSize: 20 },
                      ]}
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
                    hitSlop={4}
                  >
                    <Text
                      style={[
                        type.displayMd,
                        { color: T.accent, fontSize: 20 },
                      ]}
                    >
                      +
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Step 3 — disposition */}
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
                  DISPOSITION
                </Text>
                <View
                  style={[
                    sheetStyles.dispList,
                    { borderColor: T.borderSubtle },
                  ]}
                >
                  {DISPOSITIONS.map((d, i) => {
                    const isActive = d.value === disposition;
                    return (
                      <Pressable
                        key={d.value}
                        onPress={() => {
                          haptic.selection();
                          setDisposition(d.value);
                        }}
                        style={({ pressed }) => [
                          sheetStyles.dispRow,
                          {
                            backgroundColor: pressed
                              ? T.surface2
                              : isActive
                              ? T.accentDim
                              : "transparent",
                            borderBottomColor: T.borderFaint,
                            borderBottomWidth:
                              i === DISPOSITIONS.length - 1
                                ? 0
                                : layout.hairlineWidth,
                          },
                        ]}
                      >
                        <View
                          style={[
                            sheetStyles.dispRadio,
                            {
                              borderColor: isActive ? T.accent : T.borderHover,
                              backgroundColor: isActive
                                ? T.accent
                                : "transparent",
                            },
                          ]}
                        >
                          {isActive ? (
                            <View
                              style={{
                                width: 6,
                                height: 6,
                                backgroundColor: color.black,
                              }}
                            />
                          ) : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              type.bodyLg,
                              {
                                color: isActive ? T.accent : T.text,
                                fontSize: 14,
                                letterSpacing: 1.5,
                              },
                            ]}
                          >
                            {d.label}
                          </Text>
                          <Text
                            style={[
                              type.bodySm,
                              {
                                color: T.textMuted,
                                marginTop: 2,
                                fontSize: 13,
                              },
                            ]}
                          >
                            {d.description}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Step 4 — reason */}
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
                  REASON · OPTIONAL
                </Text>
                <View
                  style={[
                    sheetStyles.fieldShell,
                    {
                      borderColor: T.borderSubtle,
                      backgroundColor: T.bgElevated,
                    },
                  ]}
                >
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="e.g. crushed corner, customer changed mind"
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
                </View>
              </View>
            </>
          ) : null}

          <View style={{ height: insets.bottom + space.s24 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // List row
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
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: layout.contentPaddingH,
    paddingBottom: space.s64,
  },
  emptyCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.s24,
    paddingVertical: space.s14,
    marginTop: space.s24,
  },

  // Restock action + sheet
  restockBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    paddingHorizontal: space.s12,
    paddingVertical: space.s8,
    marginTop: space.s8,
  },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end" },
  sheetBody: {
    borderTopWidth: 1,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s24,
  },
  restockQtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    marginTop: space.s16,
  },
  restockQtyControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
  },
  restockQtyBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  restockLocRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.s12,
    borderBottomWidth: layout.hairlineWidth,
    gap: space.s12,
  },
  restockCancel: {
    alignItems: "center",
    paddingVertical: space.s12,
    borderWidth: 1,
    marginTop: space.s16,
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
    gap: space.s12,
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

  dispList: {
    borderWidth: layout.hairlineWidth,
  },
  dispRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
    minHeight: 56,
  },
  dispRadio: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    // SHARP corners — radio is square per §1.1
  },

  fieldShell: {
    borderWidth: layout.hairlineWidth,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
  },
});
