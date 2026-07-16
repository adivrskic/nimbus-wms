<div align="center">

# Nautilus — Mobile

**The on-the-floor app for the Nautilus warehouse platform.**
Barcode scanning, product registration, inventory lookup, relocations, pick runs, receive runs, returns, a floor-plan map, and an activity feed — built for warehouse staff working a phone in the aisles. Desk operators use the Dashboard; this surface is for the people on their feet.

`Expo SDK 54` · `React Native 0.81` · `React 19` · `TypeScript` · `expo-router` · `Supabase`

_Internal engineering doc — Nautilus team only._

</div>

---

## Table of contents

- [What this is](#what-this-is)
- [Where it sits in the suite](#where-it-sits-in-the-suite)
- [Stack](#stack)
- [Navigation & information architecture](#navigation--information-architecture)
- [Feature tour](#feature-tour)
- [Roles & permissions](#roles--permissions)
- [Offline-first architecture](#offline-first-architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Data model](#data-model)
- [Architecture](#architecture)
- [Design system](#design-system)
- [The design-system migration](#the-design-system-migration)
- [Project layout](#project-layout)
- [Common tasks](#common-tasks)
- [Status snapshot](#status-snapshot)
- [Engineering notes](#engineering-notes)

---

## What this is

Nautilus Mobile is the customer-facing application that warehouse staff carry on the floor. It is a barcode-first tool: point the camera at a product to look it up or register it, adjust quantities, relocate stock, walk a visual floor plan, run picks against orders, receive against purchase orders, and log returns. It runs offline — scans and adjustments queue locally and sync when the device reconnects — because warehouse dead zones are a fact of life.

The app is an [Expo](https://expo.dev) / React Native project using the `expo-router` file-based router, backed by the same Supabase project as the rest of the suite, with row-level security isolating every workspace's data.

This README is for the Nautilus engineering team. It assumes you have access to the shared Supabase project, the sibling repos, and the internal design-system doc (`nimbus-design-system.md`).

---

## Where it sits in the suite

Nautilus is a multi-surface product. This repo is the mobile piece.

| Surface                      | Repo / location         | Purpose                                    |
| ---------------------------- | ----------------------- | ------------------------------------------ |
| **Marketing site**           | apex domain (`<apex>`)  | Public marketing, SEO, AI sales assistant  |
| **Dashboard**                | `app.<apex>`            | Desk-bound operator + admin console        |
| **Mobile app** _(this repo)_ | Expo / React Native     | On-the-floor barcode picking + adjustments |
| **Edge functions**           | `nimbus-edge-functions` | AI narration and background jobs           |

All surfaces share one **Supabase project** and one **design system** (`nimbus-design-system.md`). The mobile app is fully on the shared Nautilus tokens (sharp corners, gold-on-dark, Satoshi + JetBrains Mono loaded via `expo-font`) — see [Design system](#design-system) and [the migration section](#the-design-system-migration).

---

## Stack

- **Runtime** — Expo SDK ~54, React Native 0.81.5, React 19.1, new architecture enabled (`newArchEnabled: true`)
- **Language** — TypeScript (strict mode), `@/*` path alias mapped to the project root
- **Navigation** — `expo-router` ~6 (file-based, typed routes enabled) over React Navigation 7
- **Auth + data** — Supabase (`@supabase/supabase-js`) — Postgres, Auth, Storage for product photos
- **Local storage** — `@react-native-async-storage/async-storage` (cache, prefs, offline queue) + `expo-secure-store` (credentials)
- **Device** — `expo-camera` (barcode scanning + photo capture), `expo-local-authentication` (biometric re-login), `expo-haptics` (tactile feedback), `expo-image-picker` (product photos)
- **Connectivity** — `@react-native-community/netinfo`
- **UI** — `react-native-svg` (the icon set + chrome), `@shopify/react-native-skia`, `react-native-animated-glow`, `expo-blur`, `expo-linear-gradient` (legacy screens), `react-native-reanimated` + the built-in `Animated` API
- **Icons** — a custom Lucide-style line set rendered through `react-native-svg` (`lib/nimbus/Icon.tsx`). `@expo/vector-icons` (FontAwesome) is still present on not-yet-migrated screens.

---

## Navigation & information architecture

The IA was reworked in the rebuild ("Option A"). The bottom bar has four tabs plus a floating scan button:

```
[ Home ]  [ Inventory ]  [ Orders ]  [ More ]            (•) ← scan FAB, bottom-right
```

- **Tabs** (`app/(tabs)/_layout.tsx`): `index` (Home), `inventory`, `orders`, `more`.
- **Scan FAB**: a 64×64 sharp gold square pinned bottom-right. Tap → Scanner. (Long-press is reserved for the AI assistant but is currently a no-op — see [Status snapshot](#status-snapshot).)
- **Hidden tab routes** (`href: null`, reached programmatically): `scanner`, `map`, `settings`. These live under `(tabs)/` for now; a planned follow-up moves `map` and `settings` (and `analytics`) to the stack root so they get proper push/pop and a back button.
- **More menu** (`app/(tabs)/more.tsx`) routes to: Map, Purchase orders, Returns, Notifications, Analytics (flagged "coming soon" / desktop-for-now), and Settings — plus Sign out.

> Because Map/Settings are hidden tabs rather than stacked screens, the back gesture from them currently jumps to the parent tab group rather than to More. Known rough edge, deferred.

---

## Feature tour

### Home (`app/(tabs)/index.tsx`)

The dashboard. A static Nautilus header, a debounced product search (name or barcode), a KPI strip (scans today, registered, low-stock), permission-gated quick actions, and a recent-activity timeline read from `scan_history`. Reads use the cache layer so the screen survives going offline.

### Inventory (`app/(tabs)/inventory.tsx`)

The full catalog for the active warehouse — category filter pills, sort modes, client-side pagination, a summary strip, and CSV export (manager+). Each card shows location chip, quantity, and a low-stock flag.

### Orders (`app/(tabs)/orders.tsx` + `app/orders/[id].tsx`)

Order queue and detail. The detail screen has two surfaces in one file: a **detail view** (customer, delivery, line items) and a full-screen **pick run** sheet. Pick-run mode hides the tab bar, shows an "END RUN" ghost button and a live pick counter, and lets the operator tap line items to mark them fully picked — each pick writes a `scan_history` row (`action: "pick"`). Status flows `created`/`pick_list_assigned` → `in_progress` → `staged`. Items are sorted by section → bay → level as a proximity proxy. (Partial-quantity picks and walk-path optimization are explicitly deferred.)

### Purchase orders (`app/purchase-orders.tsx` + `app/po/[id].tsx`)

The PO mirror of orders: a queue plus a detail screen with a **receive run** sheet. Each receive marks a line received and writes `scan_history` (`action: "receive"`); all-received → `fully_received`, some → `partially_received`. Note receiving updates the PO and logs the scan but does **not** place stock into `locations` — placement is a separate scanner step (flagged for a future combined flow).

### Returns (`app/returns.tsx`)

A returns list plus a full-screen **log-return** sheet: barcode/SKU lookup → quantity → disposition radio (`restock` / `damaged` / `hold_for_inspection` / `supplier_return`) → optional reason. Saving inserts a `returns` row and a `scan_history` row (`action: "return"`). Photo capture is intentionally not in this round.

### Scanner (`app/(tabs)/scanner.tsx`)

Reached via the FAB. A live camera with an animated crosshair scans barcodes (EAN, UPC, Code 39/93/128, ITF, QR). On a hit: an existing product opens a success overlay + detail jump; an unknown barcode opens an inline registration form (offline, registration **queues** instead of failing). Manual entry, torch, and photo capture (uploaded to Supabase Storage) are here too.

### Product detail (`app/product/[id].tsx`)

Inline quantity steppers per location, a relocate flow (section → bay → level), full edit (manager+), delete (manager+), photo change, and an activity timeline. Adjusts and relocations work offline with optimistic UI.

### Map (`app/(tabs)/map.tsx`)

A top-down floor plan; sections laid out in two rows split by a center aisle, rotated 90° (turn the phone landscape to read it). Tapping a section opens a bay/level rack view; occupied slots link to product detail. Reached from More.

### Notifications (`app/notifications.tsx`)

A read-only activity feed aggregated from existing data (no `notifications` table yet): low stock, late/pending orders, recent returns (7d), recent scans (24h), merged into one timeline with an ALL · ALERTS · ORDERS · ACTIVITY filter strip. Tapping a row routes to its source. When push infrastructure lands this becomes the in-app mirror of push payloads.

### Analytics (`app/analytics.tsx`)

A four-tab reporting screen (Overview / Inventory / Activity / Operations). Currently surfaced from More as "coming soon — desktop for now"; the screen exists but is not yet wired as a primary destination.

### Settings (`app/(tabs)/settings.tsx`)

Profile, preference toggles (notifications, biometric, dark mode), and manager+ sections: Manage Warehouses, Staff Management (grant/revoke access, change roles), Label Printing (config UI; Bluetooth pairing is a stub). Reached from More.

### Login (`app/login.tsx`)

Email/password sign-in, biometric fast-path on subsequent launches, and a password-reset stub. Per design-system §8.5, **auth always renders in light mode** regardless of system theme — the screen hard-codes a light palette rather than reading `useTheme()`. Sign-up currently deep-links to the dashboard's web signup.

---

## Roles & permissions

Permissions derive from a single role string (`profiles.role`) resolved in `lib/permissions.ts` via the `usePermissions()` hook. Three roles, cumulative:

| Capability                                                           | staff | manager | super_admin |
| -------------------------------------------------------------------- | :---: | :-----: | :---------: |
| Scan, register, adjust, relocate, view inventory, pick, receive      |  ✅   |   ✅    |     ✅      |
| Edit/delete products, export inventory, view reports, edit warehouse |   —   |   ✅    |     ✅      |
| Manage staff, assign roles, edit settings, label printing            |   —   |   ✅    |     ✅      |
| Create/delete warehouses, promote to super_admin                     |   —   |    —    |     ✅      |

Gate UI on the boolean, not the role string (`perms.canViewReports`, not `role === "manager"`) so the matrix stays in one place. These booleans gate UI affordances; data access itself is scoped server-side per warehouse and per org (see [Data model](#data-model)).

---

## Offline-first architecture

Warehouses have dead zones, so the app keeps working without a connection. The offline system lives in `lib/offline.tsx` (`OfflineProvider` / `useOffline`).

### The queue

Three operation types queue today: **`register`** (new product + location + scan log), **`adjust`** (quantity delta), and **`relocate`** (move to a new slot). When offline, screens call `queueOperation(...)`; the op gets an id + timestamp, persists to AsyncStorage, and the UI updates optimistically. _(Pick/receive/return runs are currently online actions.)_

### Sync

`NetInfo` watches connectivity. On reconnect — and on app foreground via `AppState` — the queue auto-syncs through `processOp`; successes drain, network errors stay queued for retry.

### Conflict detection & resolution

Each op checks server state before applying: **register** conflicts if the barcode now exists; **adjust/relocate** conflict if the location's `updated_at` is newer than the op's `createdAt`. Conflicts surface in `ConflictModal` (`lib/offlineUI.tsx`) with **keep server** / **keep mine** (the latter force-applies via `forceApplyOp`). A pending badge rides the tab bar; an `OfflineBanner` sits atop the main screens.

> **Two cache layers, don't confuse them.** `lib/cache.ts` is the _persistent_ warehouse-scoped AsyncStorage cache (10-min TTL via `getCacheFresh`) used to render offline. Home also keeps a separate _in-memory_ 30s cache to avoid refetch churn between focus events. Independent.

---

## Getting started

### Prerequisites

- Node.js (LTS) and npm
- The Expo tooling (`npx expo`) — no global install needed
- **A development build or a physical device.** The app uses `expo-camera`, `expo-local-authentication`, `expo-secure-store`, and Skia; camera/biometric paths don't work in a plain web build and Expo Go may not satisfy all native modules. Prefer `expo-dev-client` on a real device.

### Install & run

```bash
npm install
npm run start      # Expo dev server (scan the QR with a dev build)
npm run ios        # build + run on iOS simulator/device
npm run android    # build + run on Android emulator/device
npm run web        # browser — limited; camera/biometric won't work
```

### Fonts

**Satoshi** (display) and **JetBrains Mono** are vendored in `assets/fonts/` and loaded via `expo-font` in `app/_layout.tsx` (`useFonts` gates the splash screen). RN custom fonts need **one family name per weight** — Android won't synthesize bold/medium — so each weight registers under its own name (`Satoshi`, `Satoshi-Medium`, `Satoshi-Bold`, `JetBrainsMono`, `-Medium`, `-SemiBold`, `-Bold`). The type tokens in `lib/nimbus/tokens.ts` bake the weight into `fontFamily`; **never set `fontWeight` on brand-font text** — use `fontFamilyFor(kind, weight)` from the tokens module instead.

---

## Configuration

### Per-client branding (`lib/config.ts`)

`APP_CONFIG` holds the product/client names and logo `require()`. To deploy for a new client, swap the names, drop the logo in `assets/`, and point `clientLogo` at it. (Colors are not per-client — they come from `lib/nimbus/tokens.ts` / `useTheme()`.)

### App identity (`app.json`)

Orientation is locked portrait; `userInterfaceStyle` is `automatic`. Plugins: `expo-router`, `expo-secure-store`. Typed routes are on (`experiments.typedRoutes`).

---

## Data model

The Supabase client is created in `lib/supabase.ts`. Tables the app reads/writes (RLS-scoped to accessible warehouses; rows now carry `org_id` for workspace isolation):

- **`profiles`** — `id`, `email`, `full_name`, `phone`, `role`
- **`warehouses`** — `id`, `name`, address fields, `owner_id`
- **`warehouse_access`** — join table (`user_id`, `warehouse_id`, `granted_by`) that RLS uses to scope visibility
- **`sections`** — `code`, `name`, `color`, `total_bays`, `total_levels`, `warehouse_id`
- **`products`** — `barcode`, `name`, `category`, `weight`, `dimensions`, `manufacturer`, `internal_sku`, `reorder_point`, `notes`, `photo_url`
- **`locations`** — `product_id`, `section_id`, `warehouse_id`, `bay`, `level`, `quantity`, `updated_at`
- **`scan_history`** — the action log: `action` (`register`/`locate`/`relocate`/`pick`/`receive`/`return`/`cycle_count`/`adjust`), `quantity`, `from_location`, `to_location`, `scanned_by`, `org_id`, `notes`, `scanned_at`
- **`orders`** / **`order_items`** — order header (`order_number`, `order_type`, `status`, customer + delivery fields, `assigned_to`, `org_id`) and line items (`quantity_requested`, `quantity_picked`, `picked_by`, `picked_at`)
- **`purchase_orders`** / **`po_line_items`** — PO header + lines (`quantity_expected`, `quantity_received`, `received_by`, `received_at`)
- **`returns`** — `product_id`, `quantity`, `disposition`, `reason`, `photo_url`, `received_by`, `reviewed_by`, `org_id`

Storage: a **`product-photos`** bucket holds `<productId>.jpg` uploads.

> Warehouse visibility is scoped through `warehouse_access` + RLS; rows also carry `org_id` for multi-workspace isolation. The conflict-detection logic depends on `locations.updated_at` being maintained server-side — keep it current on every location write.

---

## Architecture

### Provider nesting (`app/_layout.tsx`)

```
ThemeProvider
└─ AuthProvider
   └─ WarehouseProvider
      └─ OfflineProvider
         └─ ToastProvider
            └─ RootLayoutNav  (+ ConflictModal)
```

`RootLayoutNav` runs `useProtectedRoute` and renders the router `Stack` with the native header disabled globally — every screen draws its own `ScreenHeader`. `RootLayout` also loads the brand fonts (Satoshi + JetBrains Mono, per-weight families) via `useFonts`, holding the splash screen until they're ready.

### Auth & protected routes

`lib/auth.tsx` owns the session: on launch it checks for a Supabase session, else tries a **biometric fast-path** (stored credentials from secure-store → Face ID / Touch ID → sign in, unless disabled). `useProtectedRoute` redirects unauthenticated users to `/login` and authenticated users away from it.

### Warehouse context (`lib/warehouse.tsx`)

The spine of the app. Loads the user, role (from `profiles`), and RLS-filtered accessible warehouses, then activates one (last-used id from AsyncStorage, else the first). Exposes `switchWarehouse`, `createWarehouse`, `refreshWarehouses`, and the greeting/name/role used across screens.

### Headers

Every screen uses `ScreenHeader` from **`lib/nimbus/Header.tsx`** — a static 56px header (eyebrow + title, hairline bottom, no gradient). The old animated collapsing header (`lib/Header.tsx`) has been deleted.

### Data fetching

No global query cache; screens fetch directly with the Supabase client in `useEffect` / `useFocusEffect`, then lean on `lib/cache.ts` for offline persistence and Home's in-memory cache for focus churn. Parallel reads use `Promise.all`. Realtime isn't wired — screens refetch on focus / pull-to-refresh.

### The custom tab bar (`app/(tabs)/_layout.tsx`)

A flat 56px bar (hairline top) with an active-tab gold rule, four `TabButton`s, and a separate 64×64 gold `ScanFab` (sharp corners). The bar filters/orders routes via `TAB_ORDER`; hidden routes (`href: null`) stay routable but unrendered.

---

## Design system

The app pulls from the canonical Nautilus tokens, defined for RN in **`lib/nimbus/tokens.ts`** (source of truth: `nimbus-design-system.md`; web parity: the marketing site's `globals.css`). Role mappings (light/dark) live in `lib/theme.tsx`.

- **Color** — black background, white text, a single gold accent (`#d4a853`, bright `#e7c074`), rationed to ≤3 per screen. Semantic colors (success/warning/danger/info) plus dim variants. Translucent white/black overlay scales for hairlines and surfaces.
- **Corners** — **sharp (0px) by default.** `radius.pill` (999) is reserved for avatars and status dots only.
- **Type** — Satoshi (display) + JetBrains Mono, loaded via `expo-font` with one family name per weight. Mono is used for every label, eyebrow, badge, ID, and numeric readout (caps + letter-spacing); the type scale in `tokens.ts` exposes concrete RN `fontSize`s (`displayXl`…`bodySm`, `label`/`labelSm`/`labelLg`, `monoBody`/`monoSm`) with the weight baked into `fontFamily`. Never pair `fontWeight` with a brand `fontFamily` — map weights through `fontFamilyFor(kind, weight)`.
- **Spacing** — an 8px scale (`space.s2`…`s200`).
- **Motion** — bezier easings (`motion.ease.out/smooth/inOut`) + durations (`motion.dur.*`) that plug straight into `Animated.timing`.
- **Layout constants** — `layout` carries the spec'd numbers: 56px top/tab bars, 64px scan FAB, 16px content padding, 1px hairlines.
- **Icons** — Lucide-style line glyphs (24×24, stroke 1.5, `currentColor`, never filled) in `lib/nimbus/Icon.tsx`; add new ones by pasting Lucide path data into the `PATHS` map.
- **Theme** — **dark by default** everywhere except auth (light, per §8.5), regardless of the OS scheme — matching desktop. `useTheme()` returns the active palette; `useThemeToggle()` flips it; the choice persists to AsyncStorage (`nautilus_theme`) and is restored on launch.

---

## The design-system migration

The migration from the app's original look (rounded corners, maroon→navy gradient, FontAwesome, system fonts) to the Nautilus tokens is **complete at the chrome level**: every screen renders `ScreenHeader` from `lib/nimbus/Header.tsx`, the legacy collapsing header (`lib/Header.tsx`) has been **deleted**, the Expo scaffold leftovers (`components/`, `constants/Colors.ts`, `app/modal.tsx`, SpaceMono) are gone, and the brand fonts load for real via `expo-font`.

What remains of the transition:

- **Legacy theme aliases** — `lib/theme.tsx` still exposes old keys (`primary`, `surface`, `headerGradient`, …) mapped onto Nautilus values for screens that haven't moved to the new keys internally. Don't add new consumers.
- **FontAwesome** — `@expo/vector-icons` glyphs still appear on some screens; the target is the Lucide-style set in `lib/nimbus/Icon.tsx`.
- **Inline `fontWeight` overrides** — a handful of styles spread a type token and then override `fontWeight` inline; with per-weight font families this selects the wrong face and should be replaced with `fontFamilyFor(...)`.
- **Token rule** — new and migrated code should consume the **new** theme keys (`accent`, `bg`, `text`, `textMuted`, `borderSubtle`, `bgElevated`, …), never the legacy aliases.

Shared interaction primitives live in `lib/ui.tsx`: `haptic` (the tactile vocabulary — use it on every meaningful tap), `Skeleton`/`SkeletonCard`, `AnimatedCounter`, gradient/elevated cards (legacy), and `ToastProvider` (`showToast`).

---

## Project layout

```
app/                          # expo-router routes (file = screen)
├── _layout.tsx               # Providers + protected-route logic + stack
├── login.tsx                 # Email/password + biometric (light-mode locked)
├── +not-found.tsx · +html.tsx
├── analytics.tsx             # 4-tab reporting ("coming soon" in More)
├── notifications.tsx         # Aggregated activity feed
├── returns.tsx               # Returns list + log-return sheet
├── purchase-orders.tsx       # PO queue
├── orders/[id].tsx           # Order detail + pick-run sheet
├── po/[id].tsx               # PO detail + receive-run sheet
├── product/[id].tsx          # Product detail
└── (tabs)/
    ├── _layout.tsx           # Custom tab bar (Home·Inventory·Orders·More) + scan FAB
    ├── index.tsx             # Home / dashboard
    ├── inventory.tsx         # Catalog
    ├── orders.tsx            # Order queue
    ├── more.tsx              # Secondary nav (Map, POs, Returns, Notifs, Analytics, Settings)
    ├── scanner.tsx           # Camera scan + register (hidden tab, via FAB)
    ├── map.tsx               # Floor plan (hidden tab, via More)
    └── settings.tsx          # Profile/warehouses/staff (hidden tab, via More)

lib/
├── nimbus/                   # The Nautilus design layer
│   ├── tokens.ts             # color, space, radius, type, motion, layout
│   ├── Header.tsx            # ScreenHeader (static 56px, hairline)
│   └── Icon.tsx              # Lucide-style SVG icon set
├── supabase.ts               # Supabase client + secure-store credential helpers
├── auth.tsx                  # AuthProvider — session + biometric login
├── warehouse.tsx             # WarehouseProvider — active warehouse, switching, roles
├── offline.tsx               # OfflineProvider — queue, sync, conflict detection
├── offlineUI.tsx             # OfflineBanner, ConflictModal, PendingBadge
├── permissions.ts            # usePermissions() role → capability matrix
├── theme.tsx                 # Light/dark role mappings (+ legacy aliases)
├── config.ts                 # Per-client branding
├── cache.ts                  # Persistent warehouse-scoped AsyncStorage cache
└── ui.tsx                    # haptics, skeletons, toasts, (legacy) gradient primitives

assets/                       # Logo + app icons; fonts/ holds Satoshi + JetBrains Mono
app.json · tsconfig.json · package.json
```

---

## Common tasks

### Add a new screen

1. Create the file under `app/`. A tab goes in `app/(tabs)/` with a `<Tabs.Screen>` entry in `(tabs)/_layout.tsx` (and an entry in `TAB_META`/`TAB_ORDER` if it's a visible tab); a stacked screen goes at the `app/` root with a `<Stack.Screen>` in `app/_layout.tsx`; a secondary destination gets a row in `more.tsx`.
2. Use `ScreenHeader` from `lib/nimbus/Header`, pull tokens from `lib/nimbus/tokens`, color from `useTheme()` (new keys), warehouse via `useWarehouse()`, permissions via `usePermissions()`.
3. Add `<OfflineBanner />` if it shows live data; fire `haptic.*` on meaningful taps; use `Skeleton` for loading and the cache layer if it should work offline.

### Add an icon

Paste the Lucide 24×24 path data into the `PATHS` map in `lib/nimbus/Icon.tsx` and add the name to the `IconName` union.

### Add a permission

Add the boolean to the `Permissions` type and hook in `lib/permissions.ts`, gate UI on `perms.yourFlag`, and mirror the rule in the corresponding Supabase RLS policy.

### Add an offline operation type

Extend the `OfflineOp["type"]` union in `lib/offline.tsx`, add a `case` to `processOp` (with conflict detection) and to `forceApplyOp` (keep-mine path), then call `queueOperation(...)` from the screen's offline branch with an optimistic update.

### Finish migrating a screen's internals

All screens are on `ScreenHeader` already; what's left on some is cosmetic: replace FontAwesome glyphs with `lib/nimbus/Icon`, move off the legacy theme aliases (`primary`, `surface`, …) onto the new keys, and replace any inline `fontWeight` override on brand-font text with `fontFamilyFor(kind, weight)` from `lib/nimbus/tokens`.

---

## Status snapshot

**Live:** Auth (email/password + biometric), warehouse switching + creation, Home, Inventory (filter/sort/paginate/CSV), Scanner (barcode + register + photo upload), Product detail (adjust/relocate/edit/delete/history), Orders + pick runs, Purchase orders + receive runs, Returns logging, Notifications feed, Map, Settings, offline queue with conflict resolution.

**Stubbed / partial:**

- **AI assistant** — the scan-FAB long-press is wired to a `TODO(redesign-phase-2)` no-op; the assistant modal needs to be re-extracted and connected. (It was functional before the IA rebuild.)
- **Analytics** — screen exists but is surfaced from More as "coming soon — desktop for now."
- **Pick/receive/return offline** — these runs are online-only; only register/adjust/relocate queue.
- **PO receiving → placement** — receiving logs the scan but doesn't write `locations`; placement is a separate scanner step.
- **Label printing** — config UI exists; Bluetooth pairing is a stub.
- **Notifications** — computed on the fly from existing tables; no real `notifications` table / read-state yet.
- **Navigation** — Map/Settings are hidden tabs, so their back gesture is awkward; planned move to the stack root.

---

## Engineering notes

- Build new screens on `lib/nimbus/*` + the new theme keys. Treat the legacy theme aliases as deprecated — touch them only to migrate a screen off them.
- Pull every color, spacing, type, and motion value from tokens; never hard-code hex. Consistency across the suite is a hard requirement, anchored on `nimbus-design-system.md`.
- Gate features on `usePermissions()` booleans.
- Treat the offline path as first-class — any new mutation should consider its offline branch and conflict story, and ideally extend the queue rather than being online-only.
- Ration the gold accent (≤3 per screen) and keep corners sharp; the pill radius is for avatars and status dots only.

### Known rough edges

- **Legacy theme aliases.** `lib/theme.tsx` keeps old keys (`primary`, `surface`, `headerGradient`, …) pointed at Nautilus values purely for back-compat. Don't add new consumers of them.
- **Inline `fontWeight` on brand text.** A few styles still spread a type token and override `fontWeight`; with per-weight families that can select the wrong face — swap to `fontFamilyFor(...)`.
- **Hidden-tab back behavior.** Back from Map/Settings jumps to the tab group, not More — deferred until they move to the stack root.
- **No test suite.** Validate on a physical device.
