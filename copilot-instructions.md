# Copilot / AI pair-programming instructions — Nautilus Mobile

These are the conventions for working in this repo. They steer AI assistants (GitHub Copilot, Claude, etc.) and double as a human cheat sheet. Read alongside the [README](./README.md).

## What this project is

The **Nautilus** warehouse platform's **mobile** surface: an Expo / React Native app for warehouse staff on the floor — barcode scanning, product registration, inventory, relocations, a floor-plan map, analytics, and an AI assistant. Part of a four-surface suite (marketing site, dashboard, mobile, edge functions) sharing one Supabase project.

## Stack (don't reach for alternatives)

- Expo SDK ~54, React Native 0.81, React 19, new architecture on.
- TypeScript, **strict mode**. Use the `@/*` path alias (root-relative).
- `expo-router` ~6, file-based, **typed routes enabled**.
- Supabase (`@supabase/supabase-js`) for auth + data + storage.
- AsyncStorage for cache/prefs/queue; `expo-secure-store` for credentials.
- `@expo/vector-icons` (FontAwesome), `expo-linear-gradient`, `react-native-svg`, `expo-haptics`.

Don't introduce a new state manager, data-fetching library, navigation system, icon set, or font without explicit sign-off — consistency across the suite is a hard requirement.

## Architecture rules

- **Routes are files** under `app/`. A new tab needs both the file in `app/(tabs)/` and a `<Tabs.Screen>` in `(tabs)/_layout.tsx`; a stacked screen needs a `<Stack.Screen>` in `app/_layout.tsx`.
- **Provider order is load-bearing** (`app/_layout.tsx`): `ThemeProvider → AuthProvider → WarehouseProvider → OfflineProvider → ToastProvider`. Don't reorder; later providers depend on earlier ones.
- **Consume context, don't refetch it.** Theme via `useTheme()`, warehouse/role via `useWarehouse()`, permissions via `usePermissions()`, connectivity/queue via `useOffline()`.
- **Use the shared header.** Render `<ScreenHeader {...wh} scrollY={scrollY} />` with `useHeaderScroll()`; never fork a per-screen header.
- **No realtime today.** Refetch on `useFocusEffect` and pull-to-refresh. Batch parallel reads with `Promise.all`.

## Secrets & data access (coding standards)

- **Never put a real API key or secret in client code.** Route third-party/AI calls through a server-side proxy or edge function (`nimbus-edge-functions`), and keep secrets in env / `expo-constants` / EAS secrets.
- **RLS scopes the data, not the UI.** `usePermissions()` booleans gate affordances; warehouse visibility and access are enforced server-side via `warehouse_access` + RLS. When you add a capability, add the matching RLS policy too.

## Permissions

- Role lives in `profiles.role` (`staff` / `manager` / `super_admin`), resolved in `lib/permissions.ts`.
- Gate UI on the **boolean** (`perms.canEditProducts`), never the raw role string. Add new capabilities to the `Permissions` type + hook, then mirror in RLS.

## Offline-first — treat it as first-class

Any new mutation must consider its offline story, not just the online happy path:

1. On the offline branch, call `queueOperation({ type, warehouseId, payload })` and update the UI **optimistically**.
2. New op types: extend the `OfflineOp["type"]` union, add a `case` to `processOp` (**with conflict detection** — check `updated_at` vs `createdAt`, or existence for inserts), and add the keep-mine path to `forceApplyOp`.
3. Surface conflicts through the existing `ConflictModal`; don't invent a parallel mechanism.
4. Remember the **two independent caches**: persistent warehouse-scoped (`lib/cache.ts`) vs. Home's in-memory 30s `dashboardCache`. Don't conflate them.

## Design / UI conventions

- **Pull color from `useTheme()` tokens. Never hard-code hex on screens.** (The `THEME` block in `lib/config.ts` and `LIGHT`/`DARK` in `lib/theme.tsx` are separate sources — if you touch theming, consolidate rather than diverge further.)
- Reuse primitives from `lib/ui.tsx`: `haptic`, `Skeleton`/`SkeletonCard`, `AnimatedCounter`, `GradientCard`, `GradientButton`, `ElevatedCard`, `showToast`.
- **Fire `haptic.*` on every meaningful tap** (`light` for navigation/minor, `medium` for actions, `success`/`error` for outcomes, `selection` for pickers).
- Match the as-built visual language (rounded corners, brand gradient, FontAwesome) for now. A future pass aligns mobile to the canonical Nautilus tokens (sharp corners, gold-on-ocean, Satoshi + JetBrains Mono) — flag, don't silently half-migrate.
- Use `Skeleton` loaders, not bare spinners, for content-shaped loading states.

## Per-client branding

The app re-skins from `lib/config.ts` (`APP_CONFIG`): product/client names, logo `require()`, theme colors. Keep all client-specific values there; don't scatter client names or colors through screens.

## Supabase data shape

Core tables: `profiles`, `warehouses`, `warehouse_access` (RLS join), `sections`, `products`, `locations` (note `updated_at` powers conflict detection), `scan_history` (the audit/action log), plus `orders` / `purchase_orders` / `returns` (read by Analytics). Photos: `product-photos` storage bucket, keyed `<productId>.jpg`. Always scope warehouse queries through the access model.

## Before you ship

- No automated tests beyond one scaffold snapshot — validate on a **physical device** (camera, biometrics, and secure-store don't fully work on web/simulator).
- Prune scaffold leftovers (`components/`, `constants/Colors.ts`, `app/modal.tsx`) only deliberately — confirm nothing imports them first.

## Quick "where does this go?"

| Task                          | File(s)                                            |
| ----------------------------- | -------------------------------------------------- |
| New screen                    | `app/...` (+ a `Screen` entry in the right layout) |
| New permission                | `lib/permissions.ts` (+ RLS)                       |
| New offline op                | `lib/offline.tsx` (`processOp` + `forceApplyOp`)   |
| Theme / color change          | `lib/theme.tsx` (+ reconcile `lib/config.ts`)      |
| Client rebrand                | `lib/config.ts` + `assets/`                        |
| Shared UI primitive           | `lib/ui.tsx`                                       |
| Header / warehouse switcher   | `lib/Header.tsx`                                   |
| Auth / biometric behavior     | `lib/auth.tsx`                                     |
| Active-warehouse / role logic | `lib/warehouse.tsx`                                |
