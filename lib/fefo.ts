/**
 * FEFO lot guidance — mobile port of desktop `lib/data/fefo.ts`.
 *
 * Per-lot on-hand is derived, not stored:
 *   received (po_line_items.quantity_received by lot) − picked
 *   (order_items.quantity_picked by lot). Lots with stock remaining are
 *   ordered earliest-expiring first; never-expiring lots fall back to
 *   FIFO by received_at. Guidance only — the pick RPC doesn't enforce it.
 */

import { supabase } from "./supabase";

export interface FefoSuggestion {
  lotNumber: string;
  expiresAt: string | null;
  remaining: number;
}

export async function fefoSuggestions(
  productIds: string[]
): Promise<Map<string, FefoSuggestion>> {
  const result = new Map<string, FefoSuggestion>();
  if (productIds.length === 0) return result;

  const { data: lots } = await supabase
    .from("lots")
    .select("id, product_id, lot_number, expires_at, received_at")
    .in("product_id", productIds);
  if (!lots || lots.length === 0) return result;

  const lotIds = lots.map((l: any) => l.id);
  const [{ data: received }, { data: picked }] = await Promise.all([
    supabase
      .from("po_line_items")
      .select("lot_id, quantity_received")
      .in("lot_id", lotIds),
    supabase
      .from("order_items")
      .select("lot_id, quantity_picked")
      .in("lot_id", lotIds),
  ]);

  const receivedByLot = new Map<string, number>();
  for (const r of received ?? []) {
    receivedByLot.set(
      (r as any).lot_id,
      (receivedByLot.get((r as any).lot_id) ?? 0) +
        ((r as any).quantity_received ?? 0)
    );
  }
  const pickedByLot = new Map<string, number>();
  for (const p of picked ?? []) {
    pickedByLot.set(
      (p as any).lot_id,
      (pickedByLot.get((p as any).lot_id) ?? 0) +
        ((p as any).quantity_picked ?? 0)
    );
  }

  // Group per product, keep lots with remaining stock, FEFO-sort.
  const byProduct = new Map<string, any[]>();
  for (const lot of lots) {
    const pid = (lot as any).product_id as string;
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid)!.push(lot);
  }

  for (const [pid, productLots] of byProduct) {
    const candidates = productLots
      .map((l: any) => ({
        lotNumber: l.lot_number as string,
        expiresAt: (l.expires_at as string | null) ?? null,
        receivedAt: (l.received_at as string | null) ?? "",
        remaining:
          (receivedByLot.get(l.id) ?? 0) - (pickedByLot.get(l.id) ?? 0),
      }))
      .filter((c) => c.remaining > 0)
      .sort((a, b) => {
        if (a.expiresAt && b.expiresAt)
          return a.expiresAt.localeCompare(b.expiresAt);
        if (a.expiresAt) return -1; // expiring lots first
        if (b.expiresAt) return 1;
        return a.receivedAt.localeCompare(b.receivedAt); // FIFO fallback
      });
    if (candidates.length > 0) {
      const first = candidates[0];
      result.set(pid, {
        lotNumber: first.lotNumber,
        expiresAt: first.expiresAt,
        remaining: first.remaining,
      });
    }
  }

  return result;
}
