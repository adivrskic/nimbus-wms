<div align="center">

# Nautilus — Mobile

**The on-the-floor app for the Nautilus warehouse platform.**
Barcode scanning, product registration, inventory lookup, relocations, a tilt-to-view floor plan, analytics, and an AI assistant — built for warehouse staff working a phone in the aisles. Desk operators use the Dashboard; this surface is for the people on their feet.

`Expo SDK 54` · `React Native 0.81` · `React 19` · `TypeScript` · `expo-router` · `Supabase`

_Internal engineering doc — Nautilus team only._

</div>

---

## Table of contents

- [What this is](#what-this-is)
- [Where it sits in the suite](#where-it-sits-in-the-suite)
- [Stack](#stack)
- [Feature tour](#feature-tour)
- [Roles & permissions](#roles--permissions)
- [Offline-first architecture](#offline-first-architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Data model](#data-model)
- [Architecture](#architecture)
- [Design system](#design-system)
- [Project layout](#project-layout)
- [Common tasks](#common-tasks)
- [Status snapshot](#status-snapshot)
- [Engineering notes](#engineering-notes)

---

## What this is

Nautilus Mobile is the customer-facing application that warehouse staff carry on the floor. It is a barcode-first tool: point the camera at a product to look it up or register it, adjust quantities, relocate stock between bay/level slots, walk a visual floor plan, and check operational analytics. It runs offline — scans and adjustments queue locally and sync when the device reconnects — because warehouse dead zones are a fact of life.

The app is an [Expo](https://expo.dev) / React Native project using the `expo-router` file-based router, backed by the same Supabase project as the rest of the suite, with row-level security isolating every workspace's data.

This README is for the Nautilus engineering team. It assumes you have access to the shared Supabase project, the sibling repos, and the internal design-system doc.

---

## Where it sits in the suite

Nautilus is a multi-surface product. This repo is the mobile piece.

| Surface                      | Repo / location         | Purpose                                    |
| ---------------------------- | ----------------------- | ------------------------------------------ |
| **Marketing site**           | apex domain (`<apex>`)  | Public marketing, SEO, AI sales assistant  |
| **Dashboard**                | `app.<apex>`            | Desk-bound operator + admin console        |
| **Mobile app** _(this repo)_ | Expo / React Native     | On-the-floor barcode picking + adjustments |
| **Edge functions**           | `nimbus-edge-functions` | AI narration and background jobs           |

All surfaces share one **Supabase project** and are meant to share one **design system** (`nimbus-design-system.md`). Note that the mobile app's visual language has **diverged** from the canonical tokens today — see [Design system](#design-system) for the as-built reality and the alignment gap.

---

## Stack

- **Runtime** — Expo SDK ~54, React Native 0.81.5, React 19.1, new architecture enabled (`newArchEnabled: true`)
- **Language** — TypeScript (strict mode), `@/*` path alias mapped to the project root
- **Navigation** — `expo-router` ~6 (file-based, typed routes enabled) over React Navigation 7
- **Auth + data** — Supabase (`@supabase/supabase-js`) — Postgres, Auth, Realtime-capable, Storage for product photos
- **Local storage** — `@react-native-async-storage/async-storage` (cache, prefs, offline queue) + `expo-secure-store` (credentials)
- **Device** — `expo-camera` (barcode scanning + photo capture), `expo-local-authentication` (biometric re-login), `expo-haptics` (tactile feedback), `expo-image-picker` (product photos)
- **Connectivity** — `@react-native-community/netinfo` (online/offline detection)
- **UI** — `expo-linear-gradient`, `react-native-svg` (the notched tab bar), `@expo/vector-icons` (FontAwesome), `react-native-reanimated` + the built-in `Animated` API
- **AI** — Anthropic Messages API (`claude-sonnet-4-20250514`), called from the in-app assistant modal

---

## Feature tour

### Home (`app/(tabs)/index.tsx`)

The dashboard. A collapsible warehouse header, a debounced product search (name or barcode), a "bento" grid of stat cards (scans today, registered today, low-stock chips), permission-gated quick actions (scan, analytics, cycle count, CSV export), and a recent-activity timeline. Reads are cached in-memory (30s TTL) and persisted via the cache layer so the screen survives going offline.

### Floor-plan map (`app/(tabs)/map.tsx`)

A top-down warehouse view. Sections are laid out in two rows split by a center aisle, between DOCK and ENTRY landmarks — and the whole grid is **rotated 90°**, so the design intent is that you turn the phone landscape to read it. Tapping a section opens a bay-by-bay, level-by-level rack view; occupied slots show the product and link through to its detail page.

### Inventory (`app/(tabs)/inventory.tsx`)

The full catalog for the active warehouse. Category filter pills (hardwood, laminate, vinyl/LVP, tile, carpet, etc.), six sort modes, client-side pagination (30/page), a summary strip (products / total units / showing), and CSV export (manager+). Each product card shows its location chip, quantity, and a low-stock flag.

### Scanner (`app/(tabs)/scanner.tsx`)

The heart of the app. A live camera with an animated crosshair scans barcodes (EAN, UPC, Code 39/93/128, ITF, QR). On a hit:

- **Existing product** → a full-screen success overlay with location, quantity, category, and barcode, plus a jump to the detail page.
- **Unknown barcode** → an inline registration form (name, category, weight, quantity, section/bay/level, optional photo, notes). Offline, registration **queues** instead of failing.

Manual barcode entry, a torch toggle, and photo capture (uploaded to Supabase Storage) are all here too.

### Product detail (`app/product/[id].tsx`)

A collapsing-header detail screen. Inline quantity steppers per location, a relocate flow (section → bay → level), full edit (name, category, weight, dimensions, manufacturer, reorder point, notes — manager+), delete (manager+), photo change via camera or library, a details card, and an activity timeline. Quantity adjusts and relocations both work offline with optimistic UI.

### Analytics (`app/analytics.tsx`)

A four-tab reporting screen (manager+ via the Home entry point):

- **Overview** — stock by category, stock by section with fill bars, an activity-type proportion breakdown.
- **Inventory** — low-stock alerts, reorder-needed list, section fill rates.
- **Activity** — a 7-day bar chart, staff-productivity ranking, and an audit trail.
- **Operations** — orders by status, purchase orders by status, returns by disposition.

### AI assistant (`app/(tabs)/_layout.tsx`)

**Long-press the center scan button** to open a chat assistant. It gathers live warehouse context (product/stock totals, section count, today's scans, low-stock list, recent activity) into a system prompt and streams answers from Anthropic. Six suggestion chips seed common questions (what's running low, today's activity, staff productivity, etc.).

### Settings (`app/(tabs)/settings.tsx`)

Profile (with inline edit), preference toggles (push notifications, biometric, dark mode), and manager+ sections: Manage Warehouses (edit details), Staff Management (grant/revoke access, change roles via email lookup), Label Printing (size + content config; Bluetooth pairing is a "coming soon" stub). Plus Terms / Privacy modals and sign-out.

### Login (`app/login.tsx`)

Email/password sign-in and sign-up, with iOS keychain auto-submit and a biometric fast-path on subsequent launches (see [Architecture](#auth--protected-routes)). Branded with the per-client logo from config.

---

## Roles & permissions

Permissions derive from a single role string (`profiles.role`) resolved in `lib/permissions.ts` via the `usePermissions()` hook. Three roles, cumulative:

| Capability                                                           | staff | manager | super_admin |
| -------------------------------------------------------------------- | :---: | :-----: | :---------: |
| Scan, register, adjust quantity, relocate, view inventory            |  ✅   |   ✅    |     ✅      |
| Edit/delete products, export inventory, view reports, edit warehouse |   —   |   ✅    |     ✅      |
| Manage staff, assign roles, edit settings, label printing            |   —   |   ✅    |     ✅      |
| Create/delete warehouses, promote to super_admin                     |   —   |    —    |     ✅      |

Gate UI on the boolean, not the role string (`perms.canViewReports`, not `role === "manager"`) so the matrix stays in one place. These booleans gate UI affordances; data access itself is scoped server-side per warehouse (see [Data model](#data-model)).

---

## Offline-first architecture

Warehouses have dead zones, so the app is built to keep working without a connection. The offline system lives in `lib/offline.tsx` (`OfflineProvider` / `useOffline`).

### The queue

Three operation types can be queued: **`register`** (new product + location + scan log), **`adjust`** (quantity delta), and **`relocate`** (move to a new slot). When offline, screens call `queueOperation(...)`; the op is assigned an id + timestamp and persisted to AsyncStorage. The UI updates optimistically.

### Sync

`NetInfo` watches connectivity. On reconnect — and on app foreground via `AppState` — the queue auto-syncs. Each op runs through `processOp`; successes drain from the queue, network errors stay queued for retry.

### Conflict detection & resolution

Sync isn't naïve last-write-wins. Each op checks server state before applying:

- **register** — if the barcode now exists (someone else registered it), it's a conflict.
- **adjust / relocate** — if the location's `updated_at` is newer than the op's `createdAt`, it's a conflict.

Conflicts surface in `ConflictModal` (`lib/offlineUI.tsx`), letting the user **keep server** or **keep mine** (which force-applies via `forceApplyOp`). A pending-count badge rides on the tab bar's scan button; an `OfflineBanner` sits atop the main screens.

> **Two cache layers, don't confuse them.** `lib/cache.ts` is the _persistent_ AsyncStorage cache (warehouse-scoped, 10-min TTL via `getCacheFresh`) used to render screens offline. The Home screen _also_ has a separate _in-memory_ 30s cache (`dashboardCache` module variable) purely to avoid refetch churn between focus events. They're independent.

---

## Getting started

### Prerequisites

- Node.js (LTS) and npm
- The Expo tooling (`npx expo`) — no global install needed
- **A development build or a physical device.** This app uses `expo-camera`, `expo-local-authentication`, and `expo-secure-store`; the camera/biometric paths don't work in a plain web build, and Expo Go may not satisfy all native modules. Prefer `expo-dev-client` on a real device.

### Install

```bash
npm install
```

### Run

```bash
npm run start      # Expo dev server (scan the QR with a dev build)
npm run ios        # build + run on iOS simulator/device
npm run android    # build + run on Android emulator/device
npm run web        # browser — limited; camera/biometric won't work
```

### Scripts

| Script            | Does                                    |
| ----------------- | --------------------------------------- |
| `npm run start`   | Start the Expo dev server               |
| `npm run ios`     | `expo run:ios` — native build + run     |
| `npm run android` | `expo run:android` — native build + run |
| `npm run web`     | `expo start --web`                      |

---

## Configuration

### Per-client branding (`lib/config.ts`)

The app is built to be **re-skinned per customer** from one file. `APP_CONFIG` holds the product name, client name/short-name, logo `require()`, and a full theme color block (`THEME`). To deploy for a new client: swap `clientName` / `clientShortName`, drop their logo in `assets/` and point `clientLogo` at it, and adjust the `theme` colors.

> Note that `THEME` in `config.ts` and the `LIGHT`/`DARK` palettes in `lib/theme.tsx` are **separate** sources of color. The runtime theme provider (`useTheme`) is what most screens consume; `config.ts` `THEME` feeds the tab bar and a few standalone spots. Aligning these is part of the [design-system cleanup](#known-sharp-edges-worth-knowing-before-you-touch-them).

### App identity (`app.json`)

Orientation is locked portrait; `userInterfaceStyle` is `automatic` (the app supports light/dark). Plugins: `expo-router`, `expo-secure-store`.

---

## Data model

The Supabase client is created in `lib/supabase.ts`. The app reads/writes these tables (all RLS-scoped to warehouses the user can access):

- **`profiles`** — `id`, `email`, `full_name`, `phone`, `role`
- **`warehouses`** — `id`, `name`, `address`, `city`, `state`, `zip`, `phone`, `owner_id`
- **`warehouse_access`** — join table (`user_id`, `warehouse_id`, `granted_by`, `granted_at`) that RLS uses to scope visibility
- **`sections`** — `code`, `name`, `color`, `total_bays`, `total_levels`, `warehouse_id`
- **`products`** — `barcode`, `name`, `category`, `weight`, `dimensions`, `manufacturer`, `internal_sku`, `reorder_point`, `notes`, `photo_url`
- **`locations`** — `product_id`, `section_id`, `warehouse_id`, `bay`, `level`, `quantity`, `updated_at`
- **`scan_history`** — `product_id`, `warehouse_id`, `scanned_by`, `action`, `quantity`, `from_location`, `to_location`, `notes`, `scanned_at`
- **`orders`**, **`purchase_orders`**, **`returns`** — read by Analytics for status/disposition rollups

Storage: a **`product-photos`** bucket holds `<productId>.jpg` uploads (public URLs).

> Warehouse visibility is scoped through `warehouse_access` and RLS. The conflict-detection logic depends on `locations.updated_at` being maintained server-side — keep it current on every location write.

---

## Architecture

### Provider nesting (`app/_layout.tsx`)

Providers wrap the app outermost → innermost:

```
ThemeProvider
└─ AuthProvider
   └─ WarehouseProvider
      └─ OfflineProvider
         └─ ToastProvider
            └─ RootLayoutNav  (+ ConflictModal)
```

`RootLayoutNav` runs `useProtectedRoute` and declares the stack: `login`, `(tabs)`, `analytics`, `product/[id]`, and a `modal`.

### Auth & protected routes

`lib/auth.tsx` owns the session. On launch it checks for an existing Supabase session; if none, it tries a **biometric fast-path** — reading stored credentials from secure-store and, if the device has hardware + enrollment and the user hasn't disabled it, prompting Face ID / Touch ID then signing in. `useProtectedRoute` (in `_layout.tsx`) redirects unauthenticated users to `/login` and authenticated users away from it. Credentials are saved to secure-store on successful login (`saveCredentials`) and cleared on sign-out.

### Warehouse context (`lib/warehouse.tsx`)

`WarehouseProvider` is the spine of the app. It loads the user, their role, and every warehouse they can access (RLS-filtered), then activates one — preferring the last-used id from AsyncStorage, falling back to the first available. It exposes `switchWarehouse`, `createWarehouse`, `refreshWarehouses`, and the greeting/name/role used across screens. Almost every screen spreads `{...wh}` into `<ScreenHeader />`.

### The shared header (`lib/Header.tsx`)

`ScreenHeader` is a single animated component reused on every tab. It collapses on scroll (via `useHeaderScroll`), expands on tap into a warehouse switcher + add-warehouse form, and optionally renders a stats strip. Keeping it in one place is why the tabs feel consistent — don't fork it per screen.

### Data fetching

There's no global query cache; screens fetch directly with the Supabase client in `useEffect` / `useFocusEffect`, then lean on `lib/cache.ts` for offline persistence and the Home in-memory cache for focus churn. Parallel reads use `Promise.all`. Realtime isn't wired up — screens refetch on focus and pull-to-refresh.

### The custom tab bar (`app/(tabs)/_layout.tsx`)

A bespoke SVG-notched tab bar with a floating, animated center scan button (rotating gradient rings). Tab press navigates; **long-press opens the AI modal**. The pending-offline badge renders on the scan button.

---

## Design system

> **Heads-up: this surface has drifted from the suite tokens.** The canonical Nautilus design system (`nimbus-design-system.md`) — sharp 0px corners, gold-on-deep-ocean, Satoshi + JetBrains Mono — is **not** what the mobile app currently implements. This section documents the app **as built**; aligning it is tracked as a [sharp edge](#known-sharp-edges-worth-knowing-before-you-touch-them).

As-built, mobile uses:

- **Color** — a maroon→navy brand gradient (`#93143A` → `#22214E`) used on headers, buttons, and the scan button. Light and dark palettes in `lib/theme.tsx` (`useTheme`); a parallel `THEME` block in `lib/config.ts`.
- **Corners** — generously rounded everywhere: inputs/cards ~10–16px, pills ~20px, the header's bottom corners a dramatic 55px.
- **Type** — system fonts; `SpaceMono` is bundled (`MonoText`) but barely used. No Satoshi / JetBrains Mono.
- **Icons** — FontAwesome via `@expo/vector-icons`.
- **Motion** — heavy use of `Animated` (spring presses, collapsing headers, the rotating scan-button rings, skeleton shimmers, count-up numbers).
- **Theming** — light/dark via `ThemeProvider`, toggled in Settings or following the system scheme.

Shared UI primitives live in `lib/ui.tsx`: `haptic` (the tactile vocabulary — use it on every meaningful tap), `Skeleton` / `SkeletonCard`, `AnimatedCounter`, `GradientCard`, `GradientButton`, `ElevatedCard`, and a `ToastProvider` (`showToast`).

---

## Project layout

```
app/                          # expo-router routes (file = screen)
├── _layout.tsx               # Provider nesting + protected-route logic + stack
├── login.tsx                 # Email/password + biometric fast-path
├── modal.tsx                 # Example modal route
├── +not-found.tsx            # 404
├── +html.tsx                 # Web static-render shell
├── analytics.tsx             # 4-tab reporting screen (manager+)
├── product/[id].tsx          # Product detail: adjust, relocate, edit, history
└── (tabs)/
    ├── _layout.tsx           # Custom SVG tab bar + AI assistant modal
    ├── index.tsx             # Home / dashboard
    ├── map.tsx               # Tilt-to-view floor plan + bay rack view
    ├── scanner.tsx           # Camera scan + register + photo
    ├── inventory.tsx         # Catalog: filter, sort, paginate, CSV
    └── settings.tsx          # Profile, warehouses, staff, labels, theme

lib/                          # App logic + providers
├── supabase.ts               # Supabase client + secure-store credential helpers
├── auth.tsx                  # AuthProvider — session + biometric login
├── warehouse.tsx             # WarehouseProvider — active warehouse, switching, roles
├── offline.tsx               # OfflineProvider — queue, sync, conflict detection
├── offlineUI.tsx             # OfflineBanner, ConflictModal, PendingBadge
├── permissions.ts            # usePermissions() role → capability matrix
├── theme.tsx                 # Light/dark palettes + ThemeProvider
├── config.ts                 # Per-client branding + theme colors
├── cache.ts                  # Persistent warehouse-scoped AsyncStorage cache
├── Header.tsx                # Shared collapsing ScreenHeader + warehouse switcher
└── ui.tsx                    # haptics, skeletons, toasts, gradient primitives

components/                   # Expo-scaffold leftovers (Themed, StyledText, hooks)
constants/Colors.ts           # Scaffold color constants (mostly superseded by theme.tsx)
assets/                       # Logo + app icons
app.json · tsconfig.json · package.json
```

---

## Common tasks

### Add a new screen

1. Create the file under `app/` (a tab goes in `app/(tabs)/` and needs a `<Tabs.Screen>` entry in `(tabs)/_layout.tsx`; a stacked screen needs a `<Stack.Screen>` in `app/_layout.tsx`).
2. Pull theme via `useTheme()`, warehouse via `useWarehouse()`, permissions via `usePermissions()`.
3. Render `<ScreenHeader {...wh} scrollY={scrollY} />` (with `useHeaderScroll`) for a consistent header, and `<OfflineBanner />` if it shows live data.
4. Fire `haptic.*` on meaningful taps; use `Skeleton` for loading and the cache layer if it should work offline.

### Add a permission

Add the boolean to the `Permissions` type and the returned object in `lib/permissions.ts`, then gate UI on `perms.yourFlag`. Mirror the rule in the corresponding Supabase RLS policy.

### Add an offline operation type

1. Extend the `OfflineOp["type"]` union in `lib/offline.tsx`.
2. Add a `case` to `processOp` (with conflict detection) and to `forceApplyOp` (keep-mine path).
3. Call `queueOperation({ type, warehouseId, payload })` from the screen on the offline branch, with an optimistic UI update.

### Re-skin for a new client

Edit `lib/config.ts`: `clientName`, `clientShortName`, `clientLogo`, and the `theme` block. Drop the logo in `assets/`. (If you also want the runtime light/dark palettes to match, update `lib/theme.tsx` — see the config/theme split note.)

---

## Status snapshot

**Live:** Auth (email/password + biometric re-login), warehouse switching + creation, Home dashboard, Inventory (filter/sort/paginate/CSV), Scanner (barcode + register + photo upload), Product detail (adjust/relocate/edit/delete/history), Floor-plan map + bay view, Analytics (4 tabs), the long-press AI assistant, Settings (profile, manage warehouses, staff management, theme), offline queue with conflict resolution.

**Stubbed / partial:**

- **Label printing** — the config UI (size, content toggles) exists, but Bluetooth printer pairing is an explicit "coming in a future update" stub.
- **Notifications & biometric prefs** — the Settings toggles persist to AsyncStorage, but there's no push-notification pipeline wired up; only the biometric pref is actually consumed (by `auth.tsx`).
- **Realtime** — not implemented; screens refetch on focus / pull-to-refresh rather than subscribing.
- **`modal.tsx` / scaffold files** — leftover Expo scaffolding (`components/`, `constants/Colors.ts`, the example modal) still ships; safe to prune.

---

## Engineering notes

- Keep screens consistent: spread `{...wh}` into `ScreenHeader`, use `useTheme()` tokens (never hard-code hex on screens), and fire haptics on interaction.
- Gate features on `usePermissions()` booleans.
- Treat the offline path as a first-class citizen — any new mutation should consider its offline branch and conflict story, not just the happy online path.
- Pull color from the theme provider; the long-term goal is to converge mobile onto the shared Nautilus tokens.

### Known sharp edges worth knowing before you touch them

- **Design-system divergence.** Rounded corners, maroon/navy gradient, FontAwesome, and system fonts diverge from the canonical Nautilus tokens (sharp corners, gold-on-ocean, Satoshi + JetBrains Mono). Plan for an alignment pass rather than assuming parity with the web surfaces.
- **Two color sources.** `lib/config.ts` `THEME` and `lib/theme.tsx` `LIGHT`/`DARK` are independent; a value changed in one won't reflect in the other. Consolidate when you touch theming.
- **No test suite.** There's a single Expo-scaffold snapshot test (`components/__tests__`). Validate changes manually on a device until real coverage lands.
