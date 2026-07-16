/**
 * Pick waves — execution side of the desk app's wave planning.
 *
 * The desk builds waves (app.pick_waves: batch of orders picked together,
 * status planned → released → complete) and prints FEFO pick lists; the
 * physical picking happens here:
 *
 *   1. **Wave list** — open waves for this facility (released first).
 *      Claim / release a wave (assigned_to).
 *   2. **Wave run** (full-screen sheet) — every unpicked line across the
 *      wave's orders in one walk-ordered list (section → bay → level).
 *      Lines pick through the same atomic `app.pick_order_item` RPC as
 *      single-order runs (decrements on-hand + audits in one tx), with
 *      FEFO lot hints for lot-tracked products. Completing the wave stamps
 *      pick_waves.status='complete' and stages fully-picked member orders.
 *
 * Routed from the More menu. No tab.
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
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

import { fefoSuggestions, type FefoSuggestion } from "../lib/fefo";
import { ScreenHeader } from "../lib/nimbus/Header";
import { Icon } from "../lib/nimbus/Icon";
import { color, layout, space, type } from "../lib/nimbus/tokens";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { haptic, showToast } from "../lib/ui";
import { useWarehouse } from "../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type WaveStatus = "planned" | "released" | "complete" | "cancelled";

interface Wave {
  id: string;
  code: string;
  status: WaveStatus;
  assigned_to: string | null;
  notes: string | null;
  created_at: string | null;
  orders: { count: number }[];
}

interface WaveLine {
  id: string; // order_item id
  quantity_requested: number;
  quantity_picked: number | null;
  orderId: string;
  orderNumber: string;
  products: {
    id: string;
    name: string;
    barcode: string | null;
    internal_sku: string | null;
    track_lots: boolean | null;
  } | null;
  locations: {
    bay: number | null;
    level: number | null;
    sections: { code: string | null; color: string | null } | null;
  } | null;
}

interface WaveOrder {
  id: string;
  order_number: string | null;
  status: string;
  org_id: string;
  order_items: any[];
}

function linePicked(l: WaveLine): boolean {
  return (l.quantity_picked ?? 0) >= l.quantity_requested;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN — wave list
// ─────────────────────────────────────────────────────────────────────────────

export default function WavesScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();

  const [waves, setWaves] = useState<Wave[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runWave, setRunWave] = useState<Wave | null>(null);

  // Ref, not a dep — a `refreshing` dependency re-fired the focus effect on
  // every pull-to-refresh.
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  const load = useCallback(async () => {
    if (!wh.warehouseId) return;
    if (!refreshingRef.current) setLoading(true);
    const { data } = await supabase
      .from("pick_waves")
      .select("id, code, status, assigned_to, notes, created_at, orders(count)")
      .eq("warehouse_id", wh.warehouseId)
      .in("status", ["planned", "released"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setWaves(data as unknown as Wave[]);
    setLoading(false);
    setRefreshing(false);
  }, [wh.warehouseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function toggleClaim(wave: Wave) {
    haptic.medium();
    const mine = wave.assigned_to === wh.userId;
    if (mine) {
      // Release only if it's still ours.
      const { error } = await supabase
        .from("pick_waves")
        .update({ assigned_to: null })
        .eq("id", wave.id)
        .eq("assigned_to", wh.userId);
      if (error) Alert.alert("Couldn't release wave", error.message);
    } else {
      // Guarded claim: only wins if nobody holds it — two pickers used to be
      // able to silently steal each other's wave.
      const { data, error } = await supabase
        .from("pick_waves")
        .update({ assigned_to: wh.userId })
        .eq("id", wave.id)
        .is("assigned_to", null)
        .select("id");
      if (error) {
        Alert.alert("Couldn't claim wave", error.message);
      } else if (!data || data.length === 0) {
        showToast("Wave was just claimed by someone else", "error");
      }
    }
    load();
  }

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Waves"}
        title="Pick waves"
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

      {loading && waves.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : waves.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}
          >
            NO OPEN WAVES · 00
          </Text>
          <Text
            style={[
              type.bodyLg,
              { color: T.text, marginTop: space.s8, textAlign: "center" },
            ]}
          >
            Nothing to pick
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
            Waves are planned from the desk app's Picking page. Released waves
            show up here ready to run.
          </Text>
        </View>
      ) : (
        <FlatList
          data={waves}
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
            const released = item.status === "released";
            const mine = item.assigned_to === wh.userId;
            const orderCount = item.orders?.[0]?.count ?? 0;
            return (
              <Pressable
                onPress={() => {
                  haptic.light();
                  setRunWave(item);
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? T.surface2 : "transparent",
                    borderBottomColor: T.borderFaint,
                    borderLeftColor: released ? T.accent : "transparent",
                    borderLeftWidth: 4,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text style={[type.monoBody, { color: T.text, fontSize: 15 }]}>
                      {item.code}
                    </Text>
                    <Text
                      style={[
                        type.labelSm,
                        {
                          color: released ? T.accent : T.textMuted,
                          letterSpacing: 1.5,
                        },
                      ]}
                    >
                      {item.status.toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={[type.monoSm, { color: T.textMuted, marginTop: 4 }]}
                  >
                    {orderCount} order{orderCount === 1 ? "" : "s"}
                    {mine
                      ? " · ASSIGNED TO YOU"
                      : item.assigned_to
                      ? " · claimed"
                      : " · unclaimed"}
                  </Text>
                </View>
                <Pressable
                  onPress={() => toggleClaim(item)}
                  hitSlop={8}
                  style={[
                    styles.claimBtn,
                    { borderColor: mine ? T.textMuted : T.accent },
                  ]}
                >
                  <Text
                    style={[
                      type.labelSm,
                      {
                        color: mine ? T.textMuted : T.accent,
                        letterSpacing: 1.5,
                      },
                    ]}
                  >
                    {mine ? "RELEASE" : "CLAIM"}
                  </Text>
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}

      {runWave ? (
        <WaveRunSheet
          wave={runWave}
          theme={T}
          onDone={() => {
            setRunWave(null);
            load();
          }}
          onClose={() => {
            setRunWave(null);
            load();
          }}
        />
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE RUN — combined walk-ordered pick list across the wave's orders
// ─────────────────────────────────────────────────────────────────────────────

function WaveRunSheet({
  wave,
  theme: T,
  onDone,
  onClose,
}: {
  wave: Wave;
  theme: ReturnType<typeof useTheme>;
  onDone: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { orgId } = useWarehouse();

  const [orders, setOrders] = useState<WaveOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [fefoHints, setFefoHints] = useState<Map<string, FefoSuggestion>>(
    new Map()
  );

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_number, status, org_id, " +
          "order_items(id, quantity_requested, quantity_picked, products(id, name, barcode, internal_sku, track_lots), locations(bay, level, sections(code, color)))"
      )
      .eq("pick_wave_id", wave.id);
    setOrders((data as unknown as WaveOrder[]) ?? []);
    setLoading(false);
  }, [wave.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Flatten to one walk-ordered list (section → bay → level).
  const lines = useMemo<WaveLine[]>(() => {
    const out: WaveLine[] = [];
    for (const o of orders) {
      for (const i of o.order_items ?? []) {
        out.push({
          ...i,
          orderId: o.id,
          orderNumber: o.order_number ?? o.id.slice(0, 8).toUpperCase(),
        });
      }
    }
    return out.sort((a, b) => {
      const ax = a.locations?.sections?.code ?? "ZZ";
      const bx = b.locations?.sections?.code ?? "ZZ";
      if (ax !== bx) return ax.localeCompare(bx);
      const ay = a.locations?.bay ?? 999;
      const by = b.locations?.bay ?? 999;
      if (ay !== by) return ay - by;
      return (a.locations?.level ?? 0) - (b.locations?.level ?? 0);
    });
  }, [orders]);

  useEffect(() => {
    const lotTracked = Array.from(
      new Set(
        lines
          .filter((l) => l.products?.track_lots && l.products?.id)
          .map((l) => l.products!.id)
      )
    );
    if (lotTracked.length > 0) fefoSuggestions(lotTracked).then(setFefoHints);
  }, [lines]);

  const remaining = lines.filter((l) => !linePicked(l));
  const done = lines.filter(linePicked);
  const allPicked = lines.length > 0 && remaining.length === 0;

  async function pickLine(line: WaveLine) {
    if (pickingId || linePicked(line)) return;
    setPickingId(line.id);
    haptic.medium();
    const order = orders.find((o) => o.id === line.orderId);
    const { error } = await supabase.rpc("pick_order_item", {
      p_org_id: order?.org_id ?? orgId,
      p_order_item_id: line.id,
    });
    setPickingId(null);
    if (error) {
      Alert.alert("Couldn't pick", error.message);
      return;
    }
    load();
  }

  async function completeWave() {
    if (!allPicked || completing) return;
    setCompleting(true);
    haptic.medium();

    // Stage fully-picked member orders still in an early status (matches the
    // single-order run's complete behavior).
    for (const o of orders) {
      if (
        ["created", "pick_list_assigned", "in_progress"].includes(o.status)
      ) {
        const { error: stageErr } = await supabase
          .from("orders")
          .update({ status: "staged" })
          .eq("id", o.id);
        if (stageErr) {
          setCompleting(false);
          Alert.alert("Couldn't stage order", stageErr.message);
          return;
        }
      }
    }

    const { error } = await supabase
      .from("pick_waves")
      .update({ status: "complete" })
      .eq("id", wave.id);
    setCompleting(false);
    if (error) {
      Alert.alert("Couldn't complete wave", error.message);
      return;
    }
    haptic.success();
    showToast(`Wave ${wave.code} complete`, "success");
    onDone();
  }

  const totalRequested = lines.reduce((s, l) => s + l.quantity_requested, 0);
  const totalPicked = lines.reduce(
    (s, l) => s + Math.min(l.quantity_picked ?? 0, l.quantity_requested),
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
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="End run">
            <Text style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}>
              END RUN
            </Text>
          </Pressable>
          <Text style={[type.monoBody, { color: T.text, fontSize: 14 }]}>
            {wave.code}
          </Text>
          <View style={styles.counter}>
            <Text
              style={[
                type.monoBody,
                { color: T.accent, fontSize: 22 },
              ]}
            >
              {String(totalPicked).padStart(2, "0")}
            </Text>
            <Text style={[type.monoSm, { color: T.textDim, marginHorizontal: 2 }]}>
              /
            </Text>
            <Text style={[type.monoBody, { color: T.textMuted, fontSize: 14 }]}>
              {String(totalRequested).padStart(2, "0")}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={T.accent} size="small" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
            {remaining.length > 0 ? (
              <>
                <Text style={[type.label, styles.groupLabel, { color: T.textMuted }]}>
                  REMAINING · {String(remaining.length).padStart(2, "0")}
                </Text>
                {remaining.map((line) => (
                  <WaveRunRow
                    key={line.id}
                    line={line}
                    theme={T}
                    isPicking={pickingId === line.id}
                    fefo={
                      line.products?.id
                        ? fefoHints.get(line.products.id)
                        : undefined
                    }
                    onPress={() => pickLine(line)}
                  />
                ))}
              </>
            ) : null}

            {done.length > 0 ? (
              <>
                <Text style={[type.label, styles.groupLabel, { color: T.textMuted }]}>
                  PICKED · {String(done.length).padStart(2, "0")}
                </Text>
                {done.map((line) => (
                  <WaveRunRow
                    key={line.id}
                    line={line}
                    theme={T}
                    isPicking={false}
                    completed
                    onPress={() => {}}
                  />
                ))}
              </>
            ) : null}
          </ScrollView>
        )}

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
              onPress={completeWave}
              disabled={completing}
              style={[styles.ctaPrimary, { backgroundColor: T.success }]}
              accessibilityLabel="Complete wave"
            >
              <Icon name="check" size={16} color={color.black} strokeWidth={2} />
              <Text
                style={[
                  type.label,
                  { color: color.black, letterSpacing: 2, marginLeft: space.s8 },
                ]}
              >
                {completing ? "COMPLETING…" : "COMPLETE WAVE"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function WaveRunRow({
  line,
  theme: T,
  isPicking,
  completed,
  fefo,
  onPress,
}: {
  line: WaveLine;
  theme: ReturnType<typeof useTheme>;
  isPicking: boolean;
  completed?: boolean;
  fefo?: FefoSuggestion;
  onPress: () => void;
}) {
  const sectionColor = line.locations?.sections?.color ?? T.accent;
  const locLabel = line.locations
    ? `${line.locations.sections?.code ?? "?"} · Bay ${
        line.locations.bay ?? "?"
      } · L${line.locations.level ?? "?"}`
    : "UNLOCATED";
  return (
    <Pressable
      onPress={onPress}
      disabled={completed || isPicking}
      style={({ pressed }) => [
        styles.runRow,
        {
          backgroundColor: pressed && !completed ? T.surface2 : "transparent",
          borderBottomColor: T.borderFaint,
          opacity: completed ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.lineAccent, { backgroundColor: sectionColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={[type.monoBody, { color: T.accent, fontSize: 15 }]}>
          {locLabel}
        </Text>
        <Text
          style={[type.bodyLg, { color: T.text, fontSize: 14, marginTop: 2 }]}
          numberOfLines={1}
        >
          {line.products?.name ?? "Unknown product"}
        </Text>
        <Text style={[type.monoSm, { color: T.textDim, marginTop: 2 }]}>
          {line.orderNumber}
          {line.products?.internal_sku ? ` · ${line.products.internal_sku}` : ""}
        </Text>
        {fefo && !completed ? (
          <Text
            style={[
              type.labelSm,
              { color: T.warning, letterSpacing: 1.5, marginTop: 4 },
            ]}
          >
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
          <>
            <Text
              style={[
                type.monoBody,
                { color: T.text, fontSize: 24 },
              ]}
            >
              {line.quantity_requested}
            </Text>
            <Text style={[type.labelSm, { color: T.textDim, letterSpacing: 1.5 }]}>
              TAP TO PICK
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
    paddingRight: layout.contentPaddingH,
    paddingLeft: layout.contentPaddingH - 4,
    borderBottomWidth: layout.hairlineWidth,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  claimBtn: {
    borderWidth: 1,
    paddingHorizontal: space.s12,
    paddingVertical: space.s6,
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
  groupLabel: {
    letterSpacing: 2,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s20,
    paddingBottom: space.s8,
  },
  runRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingVertical: space.s12,
    paddingRight: layout.contentPaddingH,
    borderBottomWidth: layout.hairlineWidth,
  },
  lineAccent: { width: 4, alignSelf: "stretch", marginRight: space.s8 },
  runRowRight: { alignItems: "flex-end", gap: 2 },
  runCtaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s12,
    borderTopWidth: layout.hairlineWidth,
  },
  ctaPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s16,
  },
});
