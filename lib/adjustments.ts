/**
 * Adjustment governance — mobile port of desktop `lib/data/adjustments.ts`.
 *
 * Every manual quantity change goes through applyOrQueueAdjustment:
 *   - small deltas commit atomically via the `app.commit_stock_adjustment` RPC
 *     (guarded against lost updates: it only writes if on-hand still matches
 *     what the user saw, and writes the audited scan_history row itself);
 *   - deltas at/above the org's `adjustment_approval_threshold`, or reasons
 *     flagged `requires_approval`, queue a `stock_adjustment_requests` row for
 *     an admin to approve from the desktop app.
 */

import { supabase } from "./supabase";

export interface AdjustmentReason {
  code: string;
  label: string;
  requiresApproval: boolean;
}

/** Same starter set the desktop offers when the org has none configured. */
export const DEFAULT_REASONS: AdjustmentReason[] = [
  { code: "cycle_count", label: "Cycle count correction", requiresApproval: false },
  { code: "damage", label: "Damaged / unsellable", requiresApproval: false },
  { code: "shrinkage", label: "Shrinkage / loss", requiresApproval: true },
  { code: "theft", label: "Theft", requiresApproval: true },
  { code: "found", label: "Found stock", requiresApproval: false },
  { code: "expiry", label: "Expired", requiresApproval: false },
  { code: "sample", label: "Sample / giveaway", requiresApproval: false },
  { code: "receiving_error", label: "Receiving error", requiresApproval: false },
];

export async function fetchReasons(orgId: string): Promise<AdjustmentReason[]> {
  const { data } = await supabase
    .from("adjustment_reasons")
    .select("code, label, requires_approval, is_active, sort_order")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  const rows = (data ?? []).map((r: any) => ({
    code: r.code as string,
    label: r.label as string,
    requiresApproval: Boolean(r.requires_approval),
  }));
  return rows.length > 0 ? rows : DEFAULT_REASONS;
}

export async function adjustmentNeedsApproval(
  orgId: string,
  reason: AdjustmentReason | null,
  delta: number
): Promise<boolean> {
  const { data: org } = await supabase
    .from("orgs")
    .select("adjustment_approval_threshold")
    .eq("id", orgId)
    .maybeSingle();
  const threshold =
    (org as { adjustment_approval_threshold: number | null } | null)
      ?.adjustment_approval_threshold ?? null;
  return (
    (threshold != null && Math.abs(delta) >= threshold) ||
    Boolean(reason?.requiresApproval)
  );
}

export interface AdjustArgs {
  orgId: string;
  userId: string;
  locationId: string;
  warehouseId: string | null;
  productId: string | null;
  currentQty: number;
  requestedQty: number;
  reason: AdjustmentReason | null;
  notes?: string | null;
}

export type AdjustResult =
  | { outcome: "noop" }
  | { outcome: "committed" }
  | { outcome: "queued" }
  | { outcome: "error"; message: string };

export async function applyOrQueueAdjustment(
  a: AdjustArgs
): Promise<AdjustResult> {
  const delta = a.requestedQty - a.currentQty;
  if (delta === 0) return { outcome: "noop" };

  const queue = await adjustmentNeedsApproval(a.orgId, a.reason, delta);

  if (queue) {
    const { error } = await supabase.from("stock_adjustment_requests").insert({
      org_id: a.orgId,
      warehouse_id: a.warehouseId,
      location_id: a.locationId,
      product_id: a.productId,
      current_qty: a.currentQty,
      requested_qty: a.requestedQty,
      delta,
      reason_code: a.reason?.code ?? null,
      notes: a.notes ?? null,
      requested_by: a.userId,
    });
    if (error) return { outcome: "error", message: error.message };
    return { outcome: "queued" };
  }

  const { data, error } = await supabase.rpc("commit_stock_adjustment", {
    p_org_id: a.orgId,
    p_location_id: a.locationId,
    p_warehouse_id: a.warehouseId,
    p_product_id: a.productId,
    p_current_qty: a.currentQty,
    p_requested_qty: a.requestedQty,
    p_reason_code: a.reason?.code ?? null,
    p_notes: a.notes ?? null,
  });
  if (error) return { outcome: "error", message: error.message };
  const r = (data ?? {}) as { applied?: boolean; currentQty?: number };
  if (!r.applied) {
    return {
      outcome: "error",
      message: `Stock changed to ${r.currentQty ?? "?"} since you loaded this — refresh and retry.`,
    };
  }
  return { outcome: "committed" };
}
