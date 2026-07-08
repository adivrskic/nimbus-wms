/**
 * Cycle counts — the floor half of the desk app's count program.
 *
 * The desk app schedules `cycle_count_tasks` (weekly discrepancy-risk cron,
 * status='pending') and reviews variances; this screen is where the count
 * physically happens:
 *
 *   1. **Queue** — pending tasks for this facility, soonest due first.
 *   2. **Count run** (full-screen sheet) — BLIND count: one qty input per
 *      location, expected on-hand deliberately hidden. Submit records every
 *      location through the atomic `app.record_cycle_count` RPC (same
 *      variance/approval governance as the desk: over-threshold or
 *      approval-flagged deltas queue a stock_adjustment_request instead of
 *      committing), then marks the task completed.
 *
 * Routed from the More menu. No tab.
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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

import { adjustmentNeedsApproval } from "../lib/adjustments";
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

interface CountTask {
  id: string;
  product_id: string;
  score: number | null;
  reason: string | null;
  due_date: string | null;
  products: {
    id: string;
    name: string;
    barcode: string | null;
    internal_sku: string | null;
  } | null;
}

interface CountLocation {
  id: string;
  bay: number | null;
  level: number | null;
  quantity: number | null;
  quarantined: boolean | null;
  sections: { code: string | null; name: string | null } | null;
}

function dueLabel(iso: string | null): { text: string; late: boolean } {
  if (!iso) return { text: "NO DUE DATE", late: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(iso + "T00:00:00");
  if (due < today) return { text: "OVERDUE", late: true };
  return {
    text: `DUE ${due
      .toLocaleDateString("en-US", { month: "short", day: "numeric" })
      .toUpperCase()}`,
    late: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN — queue
// ─────────────────────────────────────────────────────────────────────────────

export default function CycleCountsScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();

  const [tasks, setTasks] = useState<CountTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runTask, setRunTask] = useState<CountTask | null>(null);

  const load = useCallback(async () => {
    if (!wh.warehouseId) return;
    if (!refreshing) setLoading(true);
    const { data } = await supabase
      .from("cycle_count_tasks")
      .select(
        "id, product_id, score, reason, due_date, products(id, name, barcode, internal_sku)"
      )
      .eq("warehouse_id", wh.warehouseId)
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(100);
    if (data) setTasks(data as unknown as CountTask[]);
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
          wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Counts"
        }
        title="Cycle counts"
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

      {loading && tasks.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : tasks.length === 0 ? (
        <View style={styles.empty}>
          <Text
            style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}
          >
            QUEUE CLEAR · 00
          </Text>
          <Text
            style={[
              type.bodyLg,
              { color: T.text, marginTop: space.s8, textAlign: "center" },
            ]}
          >
            No counts scheduled
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
            The desk app files count tasks weekly by discrepancy risk. Pull to
            refresh.
          </Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(t) => t.id}
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
            const due = dueLabel(item.due_date);
            return (
              <Pressable
                onPress={() => {
                  haptic.light();
                  setRunTask(item);
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? T.surface2 : "transparent",
                    borderBottomColor: T.borderFaint,
                    borderLeftColor: due.late ? T.danger : "transparent",
                    borderLeftWidth: 4,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text
                      style={[
                        type.labelSm,
                        {
                          color: due.late ? T.danger : T.textMuted,
                          letterSpacing: 1.5,
                        },
                      ]}
                    >
                      {due.text}
                    </Text>
                    {item.score != null ? (
                      <Text style={[type.monoSm, { color: T.textDim }]}>
                        RISK {Number(item.score).toFixed(0)}
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    style={[type.body, { color: T.text, marginTop: 4, fontSize: 14 }]}
                    numberOfLines={1}
                  >
                    {item.products?.name ?? "Unknown product"}
                  </Text>
                  <Text style={[type.monoSm, { color: T.textMuted, marginTop: 2 }]}>
                    {item.products?.internal_sku ??
                      item.products?.barcode ??
                      ""}
                    {item.reason ? ` · ${item.reason}` : ""}
                  </Text>
                </View>
                <Icon name="chevron-right" size={14} color={T.textDim} />
              </Pressable>
            );
          }}
        />
      )}

      {runTask ? (
        <CountRunSheet
          task={runTask}
          theme={T}
          onDone={() => {
            setRunTask(null);
            load();
          }}
          onClose={() => setRunTask(null)}
        />
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNT RUN — blind count per location, atomic submit
// ─────────────────────────────────────────────────────────────────────────────

function CountRunSheet({
  task,
  theme: T,
  onDone,
  onClose,
}: {
  task: CountTask;
  theme: ReturnType<typeof useTheme>;
  onDone: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { warehouseId, orgId, userId } = useWarehouse();

  const [locations, setLocations] = useState<CountLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!warehouseId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("locations")
        .select("id, bay, level, quantity, quarantined, sections(code, name)")
        .eq("warehouse_id", warehouseId)
        .eq("product_id", task.product_id)
        .eq("is_active", true)
        .order("bay");
      setLocations((data as unknown as CountLocation[]) ?? []);
      setLoading(false);
    })();
  }, [warehouseId, task.product_id]);

  const allEntered =
    locations.length > 0 && locations.every((l) => counts[l.id]?.trim());

  async function submit() {
    if (!orgId || !userId || submitting || !allEntered) return;
    setSubmitting(true);
    haptic.medium();

    let committed = 0;
    let queued = 0;
    let noVariance = 0;
    let failed: string | null = null;

    for (const loc of locations) {
      const counted = parseInt(counts[loc.id], 10);
      if (Number.isNaN(counted) || counted < 0) {
        failed = `Invalid count for bay ${loc.bay ?? "?"}.`;
        break;
      }
      // Same governance as the desk: threshold + the cycle_count reason.
      const delta = counted - (loc.quantity ?? 0);
      const needsApproval =
        delta !== 0 &&
        (await adjustmentNeedsApproval(
          orgId,
          { code: "cycle_count", label: "Cycle count correction", requiresApproval: false },
          delta
        ));

      const { data, error } = await supabase.rpc("record_cycle_count", {
        p_org_id: orgId,
        p_location_id: loc.id,
        p_product_id: task.product_id,
        p_counted_qty: counted,
        p_notes: notes.trim() || null,
        p_reason_code: "cycle_count",
        p_counted_by: userId,
        p_needs_approval: needsApproval,
      });
      const r = (data ?? {}) as { outcome?: string; error?: string };
      if (error || r.error) {
        failed = error?.message ?? r.error ?? "unknown";
        break;
      }
      if (r.outcome === "committed") committed++;
      else if (r.outcome === "queued") queued++;
      else noVariance++;
    }

    if (failed) {
      setSubmitting(false);
      Alert.alert("Count failed", failed);
      return;
    }

    // Counting the product completes its queue task (desk parity).
    await supabase
      .from("cycle_count_tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: userId,
      })
      .eq("id", task.id)
      .eq("status", "pending");

    setSubmitting(false);
    haptic.success();
    showToast(
      queued > 0
        ? `Count recorded — ${queued} variance${queued === 1 ? "" : "s"} queued for approval`
        : committed > 0
        ? `Count recorded — ${committed} slot${committed === 1 ? "" : "s"} adjusted`
        : "Count recorded — no variance",
      "success"
    );
    onDone();
  }

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
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Cancel">
            <Text style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}>
              CANCEL
            </Text>
          </Pressable>
          <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
            BLIND COUNT
          </Text>
          <View style={{ width: 52 }} />
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: layout.contentPaddingH,
            paddingBottom: 160,
            gap: space.s12,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[type.bodyLg, { color: T.text }]} numberOfLines={2}>
            {task.products?.name ?? "Unknown product"}
          </Text>
          <Text style={[type.monoSm, { color: T.textMuted }]}>
            Count every slot below. Expected quantities are hidden — enter
            exactly what you see on the shelf.
          </Text>

          {loading ? (
            <ActivityIndicator
              color={T.accent}
              size="small"
              style={{ marginTop: 24 }}
            />
          ) : locations.length === 0 ? (
            <Text style={[type.bodySm, { color: T.textMuted, marginTop: 16 }]}>
              This product has no active slots at this facility. Dismiss the
              task from the desk app if the SKU has been retired.
            </Text>
          ) : (
            locations.map((loc) => (
              <View
                key={loc.id}
                style={[
                  styles.countRow,
                  {
                    borderColor: T.borderSubtle,
                    backgroundColor: T.bgElevated,
                    borderLeftColor: loc.quarantined
                      ? T.warning
                      : T.borderSubtle,
                    borderLeftWidth: loc.quarantined ? 4 : 1,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.monoBody, { color: T.text }]}>
                    {loc.sections?.code ?? "?"} · Bay {loc.bay ?? "?"} · L
                    {loc.level ?? "?"}
                  </Text>
                  {loc.quarantined ? (
                    <Text
                      style={[
                        type.labelSm,
                        { color: T.warning, letterSpacing: 1.5, marginTop: 2 },
                      ]}
                    >
                      QC QUARANTINE — COUNT ANYWAY
                    </Text>
                  ) : null}
                </View>
                <TextInput
                  value={counts[loc.id] ?? ""}
                  onChangeText={(v) =>
                    setCounts((prev) => ({
                      ...prev,
                      [loc.id]: v.replace(/[^0-9]/g, ""),
                    }))
                  }
                  placeholder="—"
                  placeholderTextColor={T.textDim}
                  keyboardType="number-pad"
                  style={[
                    type.monoBody,
                    styles.countInput,
                    {
                      color: T.text,
                      borderColor: counts[loc.id]?.trim()
                        ? T.accent
                        : T.borderSubtle,
                    },
                  ]}
                />
              </View>
            ))
          )}

          <View
            style={[
              styles.notesField,
              { borderColor: T.borderSubtle, backgroundColor: T.surface2 },
            ]}
          >
            <Text
              style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}
            >
              NOTES · OPTIONAL
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. water damage on back pallets"
              placeholderTextColor={T.textDim}
              multiline
              style={[
                type.body,
                { color: T.text, padding: 0, marginTop: 6, minHeight: 40 },
              ]}
            />
          </View>
        </ScrollView>

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
            onPress={submit}
            disabled={!allEntered || submitting}
            style={({ pressed }) => [
              styles.ctaPrimary,
              {
                backgroundColor: !allEntered
                  ? T.surface3
                  : pressed
                  ? T.accentBright
                  : T.accent,
              },
            ]}
            accessibilityLabel="Submit count"
          >
            <Text
              style={[
                type.label,
                {
                  color: allEntered ? "#000" : T.textDim,
                  letterSpacing: 2,
                },
              ]}
            >
              {submitting
                ? "RECORDING…"
                : `SUBMIT COUNT · ${
                    locations.filter((l) => counts[l.id]?.trim()).length
                  }/${locations.length}`}
            </Text>
          </Pressable>
        </View>
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
    paddingRight: layout.contentPaddingH,
    paddingLeft: layout.contentPaddingH - 4,
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
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    borderWidth: 1,
    padding: space.s12,
  },
  countInput: {
    borderWidth: 1,
    minWidth: 72,
    textAlign: "center",
    paddingVertical: space.s8,
    paddingHorizontal: space.s12,
    fontSize: 18,
  },
  notesField: {
    borderWidth: 1,
    paddingHorizontal: space.s12,
    paddingVertical: space.s8,
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
  ctaPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s16,
  },
});
