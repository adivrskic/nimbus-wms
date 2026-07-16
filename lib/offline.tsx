import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, AppState } from "react-native";
import { applyOrQueueAdjustment } from "./adjustments";
import { supabase } from "./supabase";

// ============================================================
// TYPES
// ============================================================
export type OfflineOp = {
  id: string;
  type: "register" | "adjust" | "relocate";
  createdAt: string;
  warehouseId: string;
  /** Org of the warehouse. Optional for ops queued by older builds — replay
   * resolves it from the warehouse row when absent. */
  orgId?: string;
  payload: any;
};

export type Conflict = {
  op: OfflineOp;
  serverData: any;
  reason: string;
};

type OfflineContextType = {
  isOnline: boolean;
  pendingCount: number;
  conflicts: Conflict[];
  queueOperation: (op: Omit<OfflineOp, "id" | "createdAt">) => Promise<void>;
  syncPending: () => Promise<void>;
  resolveConflict: (opId: string, keepLocal: boolean) => Promise<void>;
  dismissConflict: (opId: string) => void;
  syncing: boolean;
};

const OfflineContext = createContext<OfflineContextType>({
  isOnline: true,
  pendingCount: 0,
  conflicts: [],
  queueOperation: async () => {},
  syncPending: async () => {},
  resolveConflict: async () => {},
  dismissConflict: () => {},
  syncing: false,
});

export const useOffline = () => useContext(OfflineContext);

const QUEUE_KEY = "nimbus_offline_queue";

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// PROVIDER
// ============================================================
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<OfflineOp[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [syncing, setSyncing] = useState(false);
  // The in-flight guard must be a ref: two rapid queueOperation() calls both
  // schedule syncPending() with `syncing === false` captured in their closure,
  // so a state-based guard let both runs process the same snapshot (double-
  // applied adjustments surfacing as spurious conflicts).
  const syncingRef = useRef(false);
  const wasOffline = useRef(false);
  // Mirror of `queue` for callbacks/effects that would otherwise close over a
  // stale value (immediate post-enqueue sync, foreground/online edges).
  const queueRef = useRef<OfflineOp[]>([]);

  // Listen to network state
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!(
        state.isConnected && state.isInternetReachable !== false
      );
      setIsOnline((prev) => {
        if (!prev && online) wasOffline.current = true;
        return online;
      });
    });
    return () => unsubscribe();
  }, []);

  // Load queue from storage on mount
  useEffect(() => {
    loadQueue();
  }, []);

  // Defined before the effects below so it can be a stable dependency.
  // Reads the queue from queueRef (not a closed-over value) and relies on the
  // hoisted processOp / persistQueue declarations further down.
  const syncPending = useCallback(async () => {
    const snapshot = queueRef.current;
    if (syncingRef.current || snapshot.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);

    try {
      const remaining: OfflineOp[] = [];
      const newConflicts: Conflict[] = [];

      for (const op of snapshot) {
        try {
          const result = await processOp(op);
          if (result.conflict) {
            newConflicts.push({
              op,
              serverData: result.serverData,
              reason: result.reason || "Modified while offline",
            });
          }
          // If success or conflict, don't re-queue (conflicts go to conflict list)
        } catch (e: any) {
          // Network or unexpected error — keep in queue to retry
          remaining.push(op);
        }
      }

      // Preserve anything enqueued while this sync was running.
      const added = queueRef.current.filter((op) => !snapshot.includes(op));
      await persistQueue([...remaining, ...added]);
      if (newConflicts.length > 0) {
        setConflicts((prev) => [...prev, ...newConflicts]);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && wasOffline.current && queueRef.current.length > 0) {
      wasOffline.current = false;
      syncPending();
    }
  }, [isOnline, syncPending]);

  // Also try syncing when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && isOnline && queueRef.current.length > 0) {
        syncPending();
      }
    });
    return () => sub.remove();
  }, [isOnline, syncPending]);

  async function loadQueue() {
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      if (raw) {
        const parsed: OfflineOp[] = JSON.parse(raw);
        queueRef.current = parsed;
        setQueue(parsed);
      }
    } catch {}
  }

  async function persistQueue(newQueue: OfflineOp[]) {
    queueRef.current = newQueue;
    setQueue(newQueue);
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(newQueue));
    } catch {}
  }

  async function queueOperation(op: Omit<OfflineOp, "id" | "createdAt">) {
    const fullOp: OfflineOp = {
      ...op,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    const newQueue = [...queue, fullOp];
    await persistQueue(newQueue);

    // If online, try to sync immediately
    if (isOnline) {
      setTimeout(() => syncPending(), 100);
    }
  }

  // scan_history.org_id is NOT NULL — audit rows written without it were
  // silently rejected (23502). Ops queued before orgId was captured resolve
  // it from the warehouse row.
  async function resolveOrgId(op: OfflineOp): Promise<string | null> {
    if (op.orgId) return op.orgId;
    const { data } = await supabase
      .from("warehouses")
      .select("org_id")
      .eq("id", op.warehouseId)
      .maybeSingle();
    return (data as { org_id: string } | null)?.org_id ?? null;
  }

  async function processOp(
    op: OfflineOp
  ): Promise<{ conflict?: boolean; serverData?: any; reason?: string }> {
    switch (op.type) {
      case "register": {
        const { product, location } = op.payload;
        // Check if barcode already exists (someone else registered it)
        const { data: existing } = await supabase
          .from("products")
          .select("id, name")
          .eq("barcode", product.barcode)
          .maybeSingle();
        if (existing) {
          return {
            conflict: true,
            serverData: existing,
            reason: `Product with barcode ${product.barcode} was already registered as "${existing.name}"`,
          };
        }
        // Insert product
        const { data: newProduct, error: pErr } = await supabase
          .from("products")
          .insert(product)
          .select()
          .single();
        if (pErr) throw pErr;
        // Insert location. If this fails, roll back the product we just
        // created so we don't leave an orphaned product with no location.
        const { error: lErr } = await supabase.from("locations").insert({
          ...location,
          product_id: newProduct.id,
          warehouse_id: op.warehouseId,
        });
        if (lErr) {
          await supabase.from("products").delete().eq("id", newProduct.id);
          throw lErr;
        }
        // Log scan_history (best-effort — a failed audit row must not undo
        // the registration, which has already succeeded above).
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const orgId = await resolveOrgId(op);
        await supabase
          .from("scan_history")
          .insert({
            org_id: orgId,
            product_id: newProduct.id,
            warehouse_id: op.warehouseId,
            scanned_by: user?.id,
            action: "register",
            to_location: location.to_location_label,
          })
          .then(({ error }) => {
            if (error && __DEV__)
              console.warn("[offline] register scan_history failed", error);
          });
        return {};
      }

      case "adjust": {
        const { locationId, delta, productId } = op.payload;
        // Check current state
        const { data: loc } = await supabase
          .from("locations")
          .select("quantity, updated_at")
          .eq("id", locationId)
          .single();
        if (!loc) throw new Error("Location not found");

        // Conflict: if location was updated after this op was created
        if (
          loc.updated_at &&
          new Date(loc.updated_at) > new Date(op.createdAt)
        ) {
          return {
            conflict: true,
            serverData: { currentQuantity: loc.quantity, locationId },
            reason: `Quantity was changed to ${
              loc.quantity
            } while you were offline. You tried to adjust by ${
              delta > 0 ? "+" : ""
            }${delta}.`,
          };
        }

        // Replay through the SAME governance path the online flow uses:
        // commit_stock_adjustment is compare-and-set + writes the audited
        // scan_history row itself, and over-threshold deltas queue for
        // approval instead of applying silently. A raw locations.update here
        // let offline ops bypass all of that.
        const orgId = await resolveOrgId(op);
        if (!orgId) throw new Error("Could not resolve org for adjustment");
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const result = await applyOrQueueAdjustment({
          orgId,
          userId: user?.id ?? "",
          locationId,
          warehouseId: op.warehouseId,
          productId: productId ?? null,
          currentQty: loc.quantity,
          requestedQty: Math.max(0, loc.quantity + delta),
          reason: null,
          notes: `Offline: ${delta > 0 ? "+" : ""}${delta}`,
        });
        if (result.outcome === "error") {
          // CAS lost or RLS refused — surface as a conflict, not a retry loop.
          return {
            conflict: true,
            serverData: { currentQuantity: loc.quantity, locationId },
            reason: result.message,
          };
        }
        return {};
      }

      case "relocate": {
        const {
          locationId,
          newSectionId,
          newBay,
          newLevel,
          productId,
          toLocationLabel,
          fromLocationLabel,
        } = op.payload;
        // Check if location was modified
        const { data: loc } = await supabase
          .from("locations")
          .select("section_id, bay, level, updated_at")
          .eq("id", locationId)
          .single();
        if (!loc) throw new Error("Location not found");

        if (
          loc.updated_at &&
          new Date(loc.updated_at) > new Date(op.createdAt)
        ) {
          return {
            conflict: true,
            serverData: loc,
            reason: `This product was moved to a different location while you were offline.`,
          };
        }

        const { error } = await supabase
          .from("locations")
          .update({ section_id: newSectionId, bay: newBay, level: newLevel })
          .eq("id", locationId);
        if (error) throw error;

        const {
          data: { user },
        } = await supabase.auth.getUser();
        const orgId = await resolveOrgId(op);
        await supabase
          .from("scan_history")
          .insert({
            org_id: orgId,
            product_id: productId,
            warehouse_id: op.warehouseId,
            scanned_by: user?.id,
            action: "relocate",
            from_location: fromLocationLabel,
            to_location: toLocationLabel,
            notes: "Offline operation",
          })
          .then(({ error: audErr }) => {
            if (audErr && __DEV__)
              console.warn("[offline] relocate scan_history failed", audErr);
          });
        return {};
      }

      default:
        return {};
    }
  }

  async function resolveConflict(opId: string, keepLocal: boolean) {
    const conflict = conflicts.find((c) => c.op.id === opId);
    if (!conflict) return;

    if (keepLocal) {
      // Force apply the local operation, ignoring timestamp check
      try {
        await forceApplyOp(conflict.op);
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Failed to apply changes");
      }
    }
    // Either way, remove from conflicts
    setConflicts((prev) => prev.filter((c) => c.op.id !== opId));
  }

  async function forceApplyOp(op: OfflineOp) {
    switch (op.type) {
      case "register": {
        // For register conflicts (barcode exists), skip — user chose server version
        break;
      }
      case "adjust": {
        const { locationId, delta, productId } = op.payload;
        // "Keep mine" re-applies the delta on top of the FRESH server value,
        // still through governance (CAS + audit + approval threshold).
        const { data: loc } = await supabase
          .from("locations")
          .select("quantity")
          .eq("id", locationId)
          .single();
        if (!loc) return;
        const orgId = await resolveOrgId(op);
        if (!orgId) throw new Error("Could not resolve org for adjustment");
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const result = await applyOrQueueAdjustment({
          orgId,
          userId: user?.id ?? "",
          locationId,
          warehouseId: op.warehouseId,
          productId: productId ?? null,
          currentQty: loc.quantity,
          requestedQty: Math.max(0, loc.quantity + delta),
          reason: null,
          notes: `Conflict resolved: ${delta > 0 ? "+" : ""}${delta}`,
        });
        if (result.outcome === "error") throw new Error(result.message);
        break;
      }
      case "relocate": {
        const {
          locationId,
          newSectionId,
          newBay,
          newLevel,
          productId,
          toLocationLabel,
          fromLocationLabel,
        } = op.payload;
        const { error: relErr } = await supabase
          .from("locations")
          .update({ section_id: newSectionId, bay: newBay, level: newLevel })
          .eq("id", locationId);
        if (relErr) throw relErr;
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const orgId = await resolveOrgId(op);
        await supabase
          .from("scan_history")
          .insert({
            org_id: orgId,
            product_id: productId,
            warehouse_id: op.warehouseId,
            scanned_by: user?.id,
            action: "relocate",
            from_location: fromLocationLabel,
            to_location: toLocationLabel,
            notes: "Conflict resolved: kept local",
          })
          .then(({ error: audErr }) => {
            if (audErr && __DEV__)
              console.warn("[offline] relocate scan_history failed", audErr);
          });
        break;
      }
    }
  }

  function dismissConflict(opId: string) {
    setConflicts((prev) => prev.filter((c) => c.op.id !== opId));
  }

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        pendingCount: queue.length,
        conflicts,
        queueOperation,
        syncPending,
        resolveConflict,
        dismissConflict,
        syncing,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
