/**
 * Inbound (ASN) — dock-side receiving for Advanced Shipping Notices.
 *
 * The desk app creates ASNs (manual or from a PO) with pallet-level LPNs;
 * this screen is the dock half:
 *
 *   1. **ASN list** — open ASNs (pending / in_transit) for this facility.
 *   2. **Receive sheet** (full-screen) — lines grouped by LPN. Receive one
 *      line, or a whole pallet in one tap. Writes mirror the desk's
 *      receiveAsnLine/receiveLpn sequence exactly: asn_lines.quantity_received
 *      += qty → linked po_line_items reconciled (received_at/by) → scan_history
 *      audit → parent PO status recomputed (sent / partially_received /
 *      fully_received) → ASN auto-flips to received when every line lands.
 *
 * Putaway stays a separate motion (register/relocate) — receiving alone
 * doesn't create on-hand, matching the desk app.
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
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { haptic, showToast } from "../lib/ui";
import { useWarehouse } from "../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Asn {
  id: string;
  asn_number: string;
  reference: string | null;
  status: string;
  carrier: string | null;
  tracking_number: string | null;
  expected_date: string | null;
  po_id: string | null;
  org_id: string;
  asn_lines: { count: number }[];
}

interface AsnLine {
  id: string;
  product_id: string | null;
  product_name: string | null;
  lpn: string | null;
  quantity_expected: number;
  quantity_received: number | null;
  lot_number: string | null;
  po_line_id: string | null;
}

function lineRemaining(l: AsnLine): number {
  return Math.max(0, l.quantity_expected - (l.quantity_received ?? 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN — ASN list
// ─────────────────────────────────────────────────────────────────────────────

export default function InboundScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();

  const [asns, setAsns] = useState<Asn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openAsn, setOpenAsn] = useState<Asn | null>(null);

  const load = useCallback(async () => {
    if (!wh.warehouseId) return;
    if (!refreshing) setLoading(true);
    const { data } = await supabase
      .from("asns")
      .select(
        "id, asn_number, reference, status, carrier, tracking_number, expected_date, po_id, org_id, asn_lines(count)"
      )
      .eq("warehouse_id", wh.warehouseId)
      .not("status", "in", "(received,cancelled)")
      .order("expected_date", { ascending: true, nullsFirst: false })
      .limit(50);
    if (data) setAsns(data as unknown as Asn[]);
    setLoading(false);
    setRefreshing(false);
  }, [wh.warehouseId, refreshing]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={
          wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Inbound"
        }
        title="Inbound · ASN"
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

      {loading && asns.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : asns.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}
          >
            DOCK CLEAR · 00
          </Text>
          <Text
            style={[
              type.bodyLg,
              { color: T.text, marginTop: space.s8, textAlign: "center" },
            ]}
          >
            No inbound shipments
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
            ASNs created from the desk app (manual or from a PO) appear here
            when they're on the way.
          </Text>
        </View>
      ) : (
        <FlatList
          data={asns}
          keyExtractor={(a) => a.id}
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
            const lineCount = item.asn_lines?.[0]?.count ?? 0;
            return (
              <Pressable
                onPress={() => {
                  haptic.light();
                  setOpenAsn(item);
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? T.surface2 : "transparent",
                    borderBottomColor: T.borderFaint,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text style={[type.monoBody, { color: T.text, fontSize: 15 }]}>
                      {item.asn_number}
                    </Text>
                    <Text
                      style={[
                        type.labelSm,
                        { color: T.info, letterSpacing: 1.5 },
                      ]}
                    >
                      {item.status.replace(/_/g, " ").toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={[type.monoSm, { color: T.textMuted, marginTop: 4 }]}
                    numberOfLines={1}
                  >
                    {lineCount} line{lineCount === 1 ? "" : "s"}
                    {item.carrier ? ` · ${item.carrier}` : ""}
                    {item.expected_date ? ` · ETA ${item.expected_date}` : ""}
                  </Text>
                  {item.reference ? (
                    <Text style={[type.monoSm, { color: T.textDim, marginTop: 2 }]}>
                      REF {item.reference}
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevron-right" size={14} color={T.textDim} />
              </Pressable>
            );
          }}
        />
      )}

      {openAsn ? (
        <AsnReceiveSheet
          asn={openAsn}
          warehouseId={wh.warehouseId}
          userId={wh.userId}
          theme={T}
          onClose={() => {
            setOpenAsn(null);
            load();
          }}
        />
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECEIVE SHEET — lines grouped by LPN, receive line or whole pallet
// ─────────────────────────────────────────────────────────────────────────────

function AsnReceiveSheet({
  asn,
  warehouseId,
  userId,
  theme: T,
  onClose,
}: {
  asn: Asn;
  warehouseId: string | null;
  userId: string;
  theme: ReturnType<typeof useTheme>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<AsnLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("asn_lines")
      .select(
        "id, product_id, product_name, lpn, quantity_expected, quantity_received, lot_number, po_line_id"
      )
      .eq("asn_id", asn.id)
      .order("lpn", { ascending: true, nullsFirst: false });
    setLines((data as unknown as AsnLine[]) ?? []);
    setLoading(false);
  }, [asn.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Group by LPN; null-LPN lines get their own "LOOSE" group.
  const groups = useMemo(() => {
    const map = new Map<string, AsnLine[]>();
    for (const l of lines) {
      const key = l.lpn ?? "__loose__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return Array.from(map.entries());
  }, [lines]);

  /**
   * Mirrors the desk receiveAsnLine sequence for one line (full remaining
   * qty): asn_line → po_line reconcile → audit scan. PO + ASN status
   * recompute happens once per batch in finishBatch().
   */
  async function receiveLineWrites(line: AsnLine): Promise<string | null> {
    const qty = lineRemaining(line);
    if (qty <= 0) return null;
    const now = new Date().toISOString();

    const { error: lineErr } = await supabase
      .from("asn_lines")
      .update({ quantity_received: (line.quantity_received ?? 0) + qty })
      .eq("id", line.id);
    if (lineErr) return lineErr.message;

    if (line.po_line_id) {
      const { data: poLine } = await supabase
        .from("po_line_items")
        .select("id, quantity_received")
        .eq("id", line.po_line_id)
        .maybeSingle();
      if (poLine) {
        const { error: poLineErr } = await supabase
          .from("po_line_items")
          .update({
            quantity_received: ((poLine as any).quantity_received ?? 0) + qty,
            received_at: now,
            received_by: userId,
          })
          .eq("id", line.po_line_id);
        if (poLineErr) return poLineErr.message;
      }
    }

    if (line.product_id) {
      await supabase.from("scan_history").insert({
        org_id: asn.org_id,
        product_id: line.product_id,
        warehouse_id: warehouseId,
        scanned_by: userId,
        action: "receive",
        quantity: qty,
        notes: `ASN ${asn.asn_number}${line.lpn ? ` · LPN ${line.lpn}` : ""}`,
      });
    }
    return null;
  }

  /** PO + ASN status recompute, once per receive batch (desk parity). */
  async function finishBatch() {
    if (asn.po_id) {
      const { data: poLines } = await supabase
        .from("po_line_items")
        .select("quantity_expected, quantity_received")
        .eq("po_id", asn.po_id);
      if (poLines && poLines.length > 0) {
        const allReceived = (poLines as any[]).every(
          (l) => (l.quantity_received ?? 0) >= l.quantity_expected
        );
        const anyReceived = (poLines as any[]).some(
          (l) => (l.quantity_received ?? 0) > 0
        );
        const status = allReceived
          ? "fully_received"
          : anyReceived
          ? "partially_received"
          : "sent";
        await supabase
          .from("purchase_orders")
          .update({
            status,
            ...(allReceived ? { received_at: new Date().toISOString() } : {}),
          })
          .eq("id", asn.po_id);
      }
    }

    const { data: allLines } = await supabase
      .from("asn_lines")
      .select("quantity_expected, quantity_received")
      .eq("asn_id", asn.id);
    const complete =
      (allLines ?? []).length > 0 &&
      (allLines as any[]).every(
        (l) => (l.quantity_received ?? 0) >= l.quantity_expected
      );
    await supabase
      .from("asns")
      .update(
        complete
          ? { status: "received", received_at: new Date().toISOString() }
          : { status: "in_transit" }
      )
      .eq("id", asn.id);
    return complete;
  }

  async function receiveLines(batch: AsnLine[], label: string) {
    if (busy) return;
    const pending = batch.filter((l) => lineRemaining(l) > 0);
    if (pending.length === 0) return;
    setBusy(true);
    haptic.medium();
    let failed: string | null = null;
    for (const line of pending) {
      failed = await receiveLineWrites(line);
      if (failed) break;
    }
    if (!failed) {
      const complete = await finishBatch();
      haptic.success();
      showToast(
        complete ? `${asn.asn_number} fully received` : `${label} received`,
        "success"
      );
    } else {
      Alert.alert("Couldn't receive", failed);
    }
    setBusy(false);
    load();
  }

  const totalExpected = lines.reduce((s, l) => s + l.quantity_expected, 0);
  const totalReceived = lines.reduce(
    (s, l) => s + Math.min(l.quantity_received ?? 0, l.quantity_expected),
    0
  );

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.runWrap, { backgroundColor: T.bg }]}>
        <View
          style={[
            styles.runTopBar,
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
            {asn.asn_number}
          </Text>
          <View style={styles.counter}>
            <Text style={[type.monoBody, { color: T.accent, fontSize: 22 }]}>
              {String(totalReceived).padStart(2, "0")}
            </Text>
            <Text style={[type.monoSm, { color: T.textDim, marginHorizontal: 2 }]}>
              /
            </Text>
            <Text style={[type.monoBody, { color: T.textMuted, fontSize: 14 }]}>
              {String(totalExpected).padStart(2, "0")}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={T.accent} size="small" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
            {groups.map(([lpn, groupLines]) => {
              const isPallet = lpn !== "__loose__";
              const palletPending = groupLines.some((l) => lineRemaining(l) > 0);
              return (
                <View key={lpn}>
                  <View style={styles.groupHeader}>
                    <Text
                      style={[
                        type.label,
                        { color: T.textMuted, letterSpacing: 2 },
                      ]}
                    >
                      {isPallet ? `LPN · ${lpn}` : "LOOSE LINES"}
                    </Text>
                    {isPallet && palletPending ? (
                      <Pressable
                        disabled={busy}
                        onPress={() =>
                          receiveLines(groupLines, `Pallet ${lpn}`)
                        }
                        style={[styles.palletBtn, { borderColor: T.accent }]}
                      >
                        <Text
                          style={[
                            type.labelSm,
                            { color: T.accent, letterSpacing: 1.5 },
                          ]}
                        >
                          RECEIVE PALLET
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {groupLines.map((line) => {
                    const remaining = lineRemaining(line);
                    const done = remaining === 0;
                    return (
                      <View
                        key={line.id}
                        style={[
                          styles.lineRow,
                          {
                            borderBottomColor: T.borderFaint,
                            opacity: done ? 0.55 : 1,
                          },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[type.body, { color: T.text, fontSize: 14 }]}
                            numberOfLines={1}
                          >
                            {line.product_name ?? "Unknown product"}
                          </Text>
                          <Text
                            style={[
                              type.monoSm,
                              { color: T.textMuted, marginTop: 2 },
                            ]}
                          >
                            {line.quantity_received ?? 0}/{line.quantity_expected}
                            {line.lot_number ? ` · LOT ${line.lot_number}` : ""}
                          </Text>
                        </View>
                        {done ? (
                          <Icon name="check" size={18} color={T.success} />
                        ) : (
                          <Pressable
                            disabled={busy}
                            onPress={() =>
                              receiveLines([line], line.product_name ?? "Line")
                            }
                            style={[
                              styles.receiveBtn,
                              { backgroundColor: T.accentDim, borderColor: T.accent },
                            ]}
                          >
                            <Text
                              style={[
                                type.labelSm,
                                { color: T.accent, letterSpacing: 1.5 },
                              ]}
                            >
                              RECEIVE {remaining}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: layout.contentPaddingH,
    paddingBottom: space.s64,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingVertical: space.s12,
    paddingHorizontal: layout.contentPaddingH,
    borderBottomWidth: layout.hairlineWidth,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  runWrap: { flex: 1 },
  runTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.contentPaddingH,
    paddingBottom: space.s12,
    borderBottomWidth: layout.hairlineWidth,
  },
  counter: { flexDirection: "row", alignItems: "baseline" },

  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s20,
    paddingBottom: space.s8,
  },
  palletBtn: {
    borderWidth: 1,
    paddingHorizontal: space.s12,
    paddingVertical: space.s6,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingVertical: space.s12,
    paddingHorizontal: layout.contentPaddingH,
    borderBottomWidth: layout.hairlineWidth,
  },
  receiveBtn: {
    borderWidth: 1,
    paddingHorizontal: space.s12,
    paddingVertical: space.s8,
  },
});
