# Mobile feature-gap audit — 2026-07-08

> **STATUS UPDATE (same day):** the implementation pass shipped everything in
> §1 (schema drift) and items 1–9 of §2: wave picking (`app/waves.tsx`),
> cycle counts (`app/cycle-counts.tsx`), ASN/LPN receiving (`app/inbound.tsx`),
> QC pass/fail + lot capture (PO detail/receive), scan-to-verify picking +
> FEFO hints (order pick run), real notifications inbox, adjustment
> reasons/approvals, atomic return restock, categories/role reconnection.
> Remaining from §2: items 10–12 (directed move queue, work-order completion,
> label reprint requests) and Expo push-token registration into
> `app.user_devices`.

Comparison of the desktop app (`D:\app-nimbus1`, Next.js, Supabase project `seypbrzjjiuibrwyxewj`)
against this mobile app (Expo/React Native). Scope: features that belong on a phone in
the warehouse — desk/admin features (billing, integrations, report builder, facility
CAD builder, forecasting) are intentionally excluded.

## 0 · Blockers fixed in this pass (2026-07-08)

These were fixed alongside the audit because nothing else matters until they work:

- **Wrong Supabase project.** `lib/supabase.ts` pointed at the retired
  `american-flooring-services` project (`wbtudewmkomijnrgeuvd`), which has **no `app`
  schema** — every query from this client 406'd. Now points at `nimbus-wms`
  (`seypbrzjjiuibrwyxewj`), the same project the desktop app uses.
- **`get_warehouse_stats` schema routing.** The RPC lives in `public`, but this client
  defaults to the `app` schema. The Home KPI call now uses `.schema("public")`.
- **Pick/receive dead for everyone.** Order detail and PO detail gated on
  `perms.canEdit`, which never existed on `Permissions` → always `undefined` → the
  Start Pick Run and Receive buttons were hidden for every role. Re-gated on
  `canAdjustQuantity` (all roles) / `canEditProducts` (PO cancel).
- Styling parity pass (see git diff): cream light theme matching desktop, old
  crimson/navy `config.ts` palette replaced, toast/skeleton/conflict-modal restyled to
  the sharp-corner Nimbus language, analytics chart colors moved onto the Nimbus
  palette, `space.s14` token added (4 screens referenced it; paddings were silently
  `undefined`), `haptic.warning` added (failed sign-in crashed).

## 1 · Remaining schema drift (P0 — breaks screens against the live DB)

The mobile app was written against the old flooring-project schema. The desktop `app`
schema has diverged:

| Mobile expects | Live schema has | Impact |
|---|---|---|
| `products.category` (text enum, hardcoded flooring list: hardwood, laminate, …) | `products.category_id` → `app.categories` (org-defined rows: id, name, icon, color) | Inventory category filter, scanner registration, product edit, analytics category breakdown all select/insert a nonexistent column. ~82 references across `inventory.tsx`, `scanner.tsx`, `product/[id].tsx`, `analytics.tsx`, `orders.tsx`. |
| `profiles.role` | No `role` on `app.profiles`; role lives on `app.org_members.role` + `permissions` | Settings profile screen and `useWarehouse` role resolution read a missing column. |
| Direct `locations.quantity` UPDATE for adjustments | Desktop governance: `app.adjustment_reasons`, `app.stock_adjustment_requests` (threshold → approval queue), `scan_history.reason_code` | Mobile bypasses the adjustment-approval system the desk app enforces. Should call the same apply-or-queue path with a reason code. |
| Direct `returns` INSERT | Atomic `app.restock_return` RPC (restock disposition restocks stock + audit in one tx) | Mobile "restock" disposition logs the return but never restocks inventory. |
| Client-side RBAC from `role` string | Desktop granular permissions matrix (`org_members.permissions`, `effectivePermissions`) | Mobile's `usePermissions` invents its own role model (`super_admin`/`manager`/`staff`) that doesn't match desktop roles (owner/admin/member + per-permission grants). |

**Recommendation:** treat "reconnect mobile to the live schema" as its own pass before
any new features: categories join, org_members role, adjustment RPC, restock RPC,
permissions parity.

## 2 · Missing features that belong on mobile (ranked)

### High value — core floor work the desk app can only plan, not execute

1. **Wave picking execution.** Desktop builds `app.pick_waves` and prints FEFO pick
   lists; the table comment literally says *"physical picking stays on mobile."*
   Mobile only picks single orders. Add: "My waves" list → wave pick run (sequenced by
   pick path), scan-to-verify each pick, `pick_order_item` per line (RPC already
   deployed and mobile already uses it for single orders).
2. **Cycle counts.** Desktop schedules recurring counts (`app.cycle_counts`,
   `app.cycle_count_tasks`) and reviews variances — but there's no way to *do* a count
   on the floor. Add: assigned-counts queue → blind count entry per location →
   variance submit (atomic count RPC already exists desktop-side).
3. **ASN / LPN receiving + directed putaway.** Desktop creates ASNs
   (`app.asns`/`asn_lines`) with pallet-level LPNs; receiving a pallet is a dock job.
   Mobile receives only against raw POs. Add: scan LPN → receive pallet (one tap, the
   desktop `receive-pallet` flow), then a putaway task showing the suggested slot.
   (This was already noted as a follow-up when desk ASN shipped.)
4. **QC disposition.** Mobile shows quarantine state (mobile PR #1) but can't act on
   it. Desktop's QC queue (`po_line_items.qc_status`) is pass/fail paperwork that
   belongs at the dock with the goods. Add pass/fail with notes from the PO receive
   screen.
5. **Scan-to-verify in pick/receive runs.** The scanner exists but pick runs confirm
   by tapping. Standard WMS practice: scan the product (or location) barcode to
   confirm the line. Cheap to add — camera + lookup code already exists.

### Medium value — capture-at-source data the desk currently backfills

6. **Lot + expiry capture at receive, FEFO hints at pick.** `products.track_lots`,
   `app.lots`, and desk FEFO guidance exist; mobile receiving can't enter a lot/expiry
   and mobile picks ignore FEFO. Without mobile capture, lot data is always
   second-hand.
7. **Serial capture.** `products.track_serials` + `app.serial_units` exist;
   scanning serial numbers at receive/pick/return is precisely a phone-camera job.
8. **Real notifications + push.** Mobile synthesizes its feed client-side from 4
   queries; desktop writes real rows to `app.notifications`. Read those instead, and
   register Expo push tokens in `app.user_devices` — the desk Settings→Devices page
   already exists and shows zero devices.
9. **Adjustment reason codes.** When adjusting quantity, offer the org's
   `adjustment_reasons` list and thread `reason_code` into `scan_history` (column
   exists), routing large deltas into the approval queue instead of applying directly.

### Lower value / opportunistic

10. **Transfers & slotting move tasks.** Desktop computes slotting moves
    ("apply moves") and inter-location transfers; executing a move list is floor work.
    Mobile's ad-hoc "relocate" covers the manual case; a directed move queue would
    close the loop.
11. **Work order completion.** Assembly happens on a bench; confirming component
    consumption + finished-good completion from a phone is plausible but niche.
12. **Label reprint request.** Desktop prints Code128 label sheets; from mobile, a
    "reprint label for this product/location" action (queue it for the desk printer)
    beats trying to print from the phone.

### Explicitly not worth porting

Kiosk/wallboard, facility layout builder + 3D viewer, forecasting/dead-stock/valuation
analytics, custom report builder, billing/API keys/webhooks/integrations, customer &
supplier CRUD, workspace provisioning. All desk work.

## 3 · Branding note

`lib/config.ts` still brands the app "American Flooring Services / AFS" with the old
client logo (`assets/logo.webp`). Desktop product is Nautilus Inventory
(app.nautilusinventory.com). Rebrand when convenient — left untouched because logo
assets are needed.
