# Copilot / AI pair-programming instructions — Nautilus Mobile

Conventions for working in this repo. They steer AI assistants (Copilot, Claude, etc.) and double as a human cheat sheet. Read alongside the [README](./README.md).

## What this project is

The **Nautilus** warehouse platform's **mobile** surface: an Expo / React Native app for warehouse staff on the floor — scanning, registration, inventory, relocations, pick runs, receive runs, returns, a floor-plan map, and an activity feed. Part of a four-surface suite (marketing site, dashboard, mobile, edge functions) sharing one Supabase project and one design system.

> **All screens are on the Nautilus chrome.** Every route renders `ScreenHeader` + `Icon` + the token scales (`color`, `space`, `type`, `layout`, `radius`); no screen uses the legacy `lib/Header.tsx`, `LinearGradient`, or FontAwesome anymore. Build everything new on the Nautilus layer and don't add new consumers of the legacy theme aliases (`primary`, `surface`, `textPrimary`, …). **Still legacy (shared primitives, not screens):** `lib/offlineUI.tsx` (offline banner / conflict modal / pending badge) and parts of `lib/ui.tsx` still use FontAwesome/LinearGradient, and `lib/Header.tsx` is now unused but not deleted — so `_layout.tsx` must keep loading `FontAwesome.font` until those are migrated. See "Design / UI" below.

## Stack (don't reach for alternatives)

- Expo SDK ~54, React Native 0.81, React 19, new architecture on.
- TypeScript, **strict mode**. Use the `@/*` path alias (root-relative).
- `expo-router` ~6, file-based, **typed routes enabled**.
- Supabase (`@supabase/supabase-js`) for auth + data + storage.
- AsyncStorage (cache/prefs/queue); `expo-secure-store` (credentials).
- Icons: the custom `lib/nimbus/Icon.tsx` (Lucide-style SVG). FontAwesome only survives on unmigrated screens.

Don't introduce a new state manager, data-fetching library, navigation system, icon set, or font without explicit sign-off — suite consistency is a hard requirement.

## Navigation / IA

- Tabs (`app/(tabs)/_layout.tsx`): **Home · Inventory · Orders · More**. Scanner is a hidden tab reached via the gold scan **FAB**; Map and Settings are hidden tabs reached from **More**.
- A new visible tab needs the file in `app/(tabs)/` **and** entries in `TAB_META` + `TAB_ORDER`. A stacked screen goes at `app/` root with a `<Stack.Screen>` in `app/_layout.tsx`. A secondary destination gets a row in `app/(tabs)/more.tsx`.
- Order/PO/return detail screens live at the `app/` root (`orders/[id]`, `po/[id]`, `returns`), not under tabs.

## Architecture rules

- **Provider order is load-bearing** (`app/_layout.tsx`): `ThemeProvider → AuthProvider → WarehouseProvider → OfflineProvider → ToastProvider`. Don't reorder.
- **Consume context, don't refetch it.** Theme via `useTheme()`, warehouse/role via `useWarehouse()`, permissions via `usePermissions()`, connectivity/queue via `useOffline()`.
- **Use the new header.** `ScreenHeader` from `lib/nimbus/Header` (static 56px). The old `lib/Header.tsx` is deprecated — don't build on it.
- **No realtime today.** Refetch on `useFocusEffect` / pull-to-refresh; batch parallel reads with `Promise.all`.
- **Task-flow screens** (pick run, receive run) use a full-screen `Modal` that covers the tab bar, an "END RUN" ghost button, and a live counter. Each pick/receive/return writes a `scan_history` row with the right `action`.

## Design / UI — the Nautilus token system

- **Pull everything from tokens.** `lib/nimbus/tokens.ts` exports `color`, `space`, `radius`, `type`, `motion`, `layout`. Never hard-code hex, spacing, font sizes, or durations.
- **Color via `useTheme()` — use the NEW keys** (`accent`, `bg`, `bgElevated`, `text`, `textMuted`, `textDim`, `borderSubtle`, `borderHover`, `success`/`warning`/`danger`/`info` + `*Dim`). The **legacy aliases** (`primary`, `secondary`, `surface`, `background`, `border`, `headerGradient`) exist only for unmigrated screens — do not add new consumers.
- **Sharp corners (0px) by default.** `radius.pill` is for avatars and status dots only.
- **Ration the gold accent — ≤3 per screen.** Same for semantic reds/ambers.
- **Type:** Satoshi (display) + JetBrains Mono. Mono caps + letter-spacing for every label/eyebrow/badge/ID/numeric readout. Use the `type.*` scale, don't invent sizes.
- **Dark by default** everywhere except auth, which is locked to light per spec §8.5 (login hard-codes its palette; don't make it read `useTheme()`).
- **Icons:** add Lucide path data to the `PATHS` map + `IconName` union in `lib/nimbus/Icon.tsx`.
- Reuse interaction primitives from `lib/ui.tsx` (`haptic`, `Skeleton`, `showToast`); the gradient/elevated cards there are legacy.
- **Fire `haptic.*` on every meaningful tap** (`light` minor/nav, `medium` actions, `success`/`warning` outcomes, `selection` pickers, `heavy` run-complete).

## Building a screen (the Nautilus pattern — migration is done)

Swap `lib/Header.tsx` → `lib/nimbus/Header`; FontAwesome → `lib/nimbus/Icon`; `LinearGradient`/rounded styles → flat + sharp token styles; legacy theme aliases → new keys.

## Permissions

Role lives in `profiles.role` (`staff` / `manager` / `super_admin`), resolved in `lib/permissions.ts`. Gate UI on the **boolean** (`perms.canEditProducts`), never the raw role. Add new capabilities to the type + hook, then mirror in RLS.

## Offline-first — treat it as first-class

1. Offline branch → `queueOperation({ type, warehouseId, payload })` + optimistic UI.
2. New op types: extend `OfflineOp["type"]`, add a `case` to `processOp` (**with conflict detection** — `updated_at` vs `createdAt`, or existence for inserts) and the keep-mine path to `forceApplyOp`.
3. Surface conflicts via the existing `ConflictModal`.
4. Two independent caches: persistent `lib/cache.ts` vs Home's in-memory 30s cache. Don't conflate them.
5. Pick/receive/return are currently online-only — prefer extending the queue over adding new online-only mutations.

## Secrets & data access (coding standards)

- **Never put a real API key or secret in client code.** Route third-party/AI calls through a server-side proxy or edge function (`nimbus-edge-functions`); keep secrets in env / `expo-constants` / EAS secrets.
- **RLS + `org_id` scope the data, not the UI.** `usePermissions()` booleans gate affordances; warehouse visibility is enforced server-side via `warehouse_access` + RLS, and rows carry `org_id` for workspace isolation. Add the matching policy when you add a capability.

## Supabase data shape

`profiles`, `warehouses`, `warehouse_access` (RLS join), `sections`, `products`, `locations` (`updated_at` powers conflict detection), `scan_history` (the action log — `register`/`locate`/`relocate`/`pick`/`receive`/`return`/`cycle_count`/`adjust`), `orders`/`order_items`, `purchase_orders`/`po_line_items`, `returns`. Rows carry `org_id`. Photos: `product-photos` bucket, `<productId>.jpg`.

## Before you ship

- No automated tests beyond one scaffold snapshot — validate on a **physical device** (camera, biometrics, secure-store, Skia don't fully work on web/simulator).
- Prune scaffold leftovers (`components/`, `constants/Colors.ts`, `app/modal.tsx`) only deliberately — confirm nothing imports them first.

## Quick "where does this go?"

| Task                          | File(s)                                                  |
| ----------------------------- | -------------------------------------------------------- |
| New visible tab               | `app/(tabs)/...` + `TAB_META`/`TAB_ORDER`                |
| New stacked screen            | `app/...` + `<Stack.Screen>` in `app/_layout.tsx`        |
| New secondary destination     | row in `app/(tabs)/more.tsx`                             |
| New permission                | `lib/permissions.ts` (+ RLS)                             |
| New offline op                | `lib/offline.tsx` (`processOp` + `forceApplyOp`)         |
| New icon                      | `lib/nimbus/Icon.tsx` (`PATHS` + `IconName`)             |
| Design token / color          | `lib/nimbus/tokens.ts` + role mapping in `lib/theme.tsx` |
| Header                        | `lib/nimbus/Header.tsx`                                  |
| Client rebrand                | `lib/config.ts` + `assets/`                              |
| Interaction primitive         | `lib/ui.tsx`                                             |
| Auth / biometric              | `lib/auth.tsx`                                           |
| Active-warehouse / role logic | `lib/warehouse.tsx`                                      |
