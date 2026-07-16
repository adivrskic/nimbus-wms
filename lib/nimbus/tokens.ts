/**
 * Nimbus design tokens — React Native flavor.
 *
 * Source of truth: `nimbus-design-system.md` §2 + Appendix A.
 * Web parity: `apps/marketing/app/globals.css` `:root` block.
 *
 * Rules:
 *   - Light/dark role mappings live in `lib/theme.tsx`, not here.
 *   - Raw color values (gold, grays, semantic) are theme-independent.
 *   - Spacing values are numbers (RN doesn't take "px" strings on most props).
 *   - Easings are `Easing.bezier(...)` objects so they plug directly into
 *     `Animated.timing(..., { easing: motion.ease.out })`.
 */

import { Easing } from "react-native";

// ─────────────────────────────────────────────────────────────────────────────
// Color — raw values. Same on iOS, Android, light, dark.
// ─────────────────────────────────────────────────────────────────────────────

export const color = {
  // Neutrals
  black: "#000000",
  nearBlack: "#0a0a0a",
  white: "#ffffff",
  gray1: "#f5f5f5",
  gray2: "#a3a3a3",
  gray3: "#737373",
  gray4: "#404040",
  gray5: "#262626",
  gray6: "#171717",
  gray7: "#0e0e0e",

  // Brand — the one gold. Rationed: ≤3 per screen.
  accent: "#d4a853",
  accentDim: "rgba(212, 168, 83, 0.15)",
  accentSoft: "rgba(212, 168, 83, 0.55)", // focused-field borders
  accentGlow: "rgba(212, 168, 83, 0.08)", // ambient glows / focus rings
  accentBright: "#e7c074",
  accentDeep: "#9a7732",

  // Semantic — also rationed. Escalate only the top one or two items in a list.
  success: "#22c55e",
  successDim: "rgba(34, 197, 94, 0.12)",
  warning: "#d97706",
  warningDim: "rgba(217, 119, 6, 0.12)",
  danger: "#ef4444",
  dangerDim: "rgba(239, 68, 68, 0.10)",
  info: "#60a5fa",
  infoDim: "rgba(96, 165, 250, 0.12)",

  // Translucent overlays
  whiteAlpha: {
    a1: "rgba(255,255,255,0.04)", // hover on dark
    a2: "rgba(255,255,255,0.06)", // border-subtle on dark
    a3: "rgba(255,255,255,0.08)",
    a4: "rgba(255,255,255,0.12)",
    a5: "rgba(255,255,255,0.16)",
    a6: "rgba(255,255,255,0.32)",
  },
  blackAlpha: {
    a1: "rgba(0,0,0,0.04)",
    a2: "rgba(0,0,0,0.06)", // border-subtle on light
    a3: "rgba(0,0,0,0.08)",
    a4: "rgba(0,0,0,0.12)",
    a6: "rgba(0,0,0,0.60)", // modal backdrop
  },

  // Light mode — warm cream, mirrors the desktop app's [data-theme="light"]
  // block in app-nimbus1/app/globals.css. Not gray: cream surfaces + warm ink.
  cream: {
    bg: "#f5efde", // page background
    surface: "#fdfaf0", // cards / elevated-1
    elevated: "#ffffff", // elevated-2 (sheets, popovers)
    ink: "#1a1612", // primary text — warm near-black
    inkSecondary: "#3d362e",
    inkMuted: "#6b6259",
    inkDim: "#948b80",
    border: "rgba(26, 22, 18, 0.18)",
    borderHover: "rgba(26, 22, 18, 0.32)",
    borderSubtle: "rgba(26, 22, 18, 0.08)",
    borderFaint: "rgba(26, 22, 18, 0.05)",
    surface2: "rgba(26, 22, 18, 0.03)",
    surface3: "rgba(26, 22, 18, 0.06)",
    glassBg: "rgba(253, 250, 240, 0.85)",
    glassBorder: "rgba(26, 22, 18, 0.10)",
    accentDeep: "#8b6a1f", // gold-as-text on cream
  },

  // Semantic colors deepened for contrast on cream (desktop light-theme values).
  semanticOnLight: {
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
    info: "#1d4ed8",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Spacing — 8px scale (with a 6 half-step for mono labels).
// ─────────────────────────────────────────────────────────────────────────────

export const space = {
  s2: 2,
  s4: 4,
  s6: 6,
  s8: 8,
  s12: 12,
  s14: 14, // half-step used by form rows (po/returns/purchase-orders/scanner)
  s16: 16,
  s20: 20,
  s24: 24,
  s32: 32,
  s40: 40,
  s48: 48,
  s56: 56,
  s64: 64,
  s80: 80,
  s96: 96,
  s120: 120,
  s160: 160,
  s200: 200,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Radii — sharp by default. Pill is for avatars + status dots only.
// ─────────────────────────────────────────────────────────────────────────────

export const radius = {
  none: 0,
  pill: 999,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Type — Satoshi (display) + JetBrains Mono, loaded via expo-font in
// `app/_layout.tsx`. RN custom fonts need one family name PER WEIGHT —
// Android won't synthesize bold/medium from a single face, and setting
// `fontWeight` alongside a custom family can select the wrong (system)
// face. So: pick the family via `fontFamilyFor(...)` / the `font` map and
// do NOT set `fontWeight` on brand-font text.
// ─────────────────────────────────────────────────────────────────────────────

export const font = {
  // Satoshi (display) — weights 400 / 500 / 600+ map to these faces.
  display: "Satoshi",
  displayMedium: "Satoshi-Medium",
  displayBold: "Satoshi-Bold",
  // JetBrains Mono — weights 400 / 500 / 600 / 700.
  mono: "JetBrainsMono",
  monoMedium: "JetBrainsMono-Medium",
  monoSemiBold: "JetBrainsMono-SemiBold",
  monoBold: "JetBrainsMono-Bold",
} as const;

type WeightInput =
  | number
  | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900"
  | "normal"
  | "bold";

/**
 * Map an inline weight to the loaded per-weight family name.
 * Display (Satoshi): 400→Regular, 500→Medium, 600+→Bold (no SemiBold face).
 * Mono (JetBrains): 400→Regular, 500→Medium, 600→SemiBold, 700+→Bold.
 *
 * Use this instead of `fontWeight` when a style needs a heavier/lighter
 * brand face, e.g. `{ fontFamily: fontFamilyFor("mono", "600") }`.
 */
export function fontFamilyFor(kind: "display" | "mono", weight: WeightInput): string {
  const w =
    weight === "normal" ? 400 :
    weight === "bold" ? 700 :
    typeof weight === "number" ? weight : parseInt(weight, 10);

  if (kind === "display") {
    if (w >= 600) return font.displayBold;
    if (w >= 500) return font.displayMedium;
    return font.display;
  }
  if (w >= 700) return font.monoBold;
  if (w >= 600) return font.monoSemiBold;
  if (w >= 500) return font.monoMedium;
  return font.mono;
}

/**
 * Type scale. Web uses `display-xl` / `display-md` etc.; here we surface
 * concrete pixel sizes for RN's `fontSize` prop. Use mono caps with
 * letterSpacing for labels/eyebrows. Weight is baked into `fontFamily`
 * (per-weight faces) — don't add `fontWeight` on top of these.
 */
export const type = {
  // Display / Satoshi
  displayXl: {
    fontFamily: font.displayBold, // 700
    fontSize: 48,
    lineHeight: 52,
    letterSpacing: -0.8,
  },
  displayLg: {
    fontFamily: font.displayBold, // 700
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  displayMd: {
    fontFamily: font.displayBold, // 600 → Bold face (no Satoshi SemiBold)
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  displayXs: {
    fontFamily: font.displayBold, // 600 → Bold face
    fontSize: 18,
    lineHeight: 24,
  },
  bodyLg: {
    fontFamily: font.display, // 400
    fontSize: 16,
    lineHeight: 24,
  },
  body: {
    fontFamily: font.display, // 400
    fontSize: 14,
    lineHeight: 20,
  },
  bodySm: {
    fontFamily: font.display, // 400
    fontSize: 13,
    lineHeight: 18,
  },

  // Mono / JetBrains — labels, eyebrows, badges, numerics in tables, IDs.
  label: {
    fontFamily: font.monoMedium, // 500
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
  },
  labelSm: {
    fontFamily: font.monoMedium, // 500
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase" as const,
  },
  labelLg: {
    fontFamily: font.monoMedium, // 500
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 2.5,
    textTransform: "uppercase" as const,
  },
  monoBody: {
    fontFamily: font.mono, // 400
    fontSize: 13,
    lineHeight: 20,
  },
  monoSm: {
    fontFamily: font.mono, // 400
    fontSize: 11,
    lineHeight: 16,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Motion — easings + durations. Plug directly into Animated.timing.
// ─────────────────────────────────────────────────────────────────────────────

export const motion = {
  ease: {
    out: Easing.bezier(0.22, 1, 0.36, 1),
    smooth: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.bezier(0.4, 0, 0.2, 1),
  },
  dur: {
    instant: 120,
    quick: 200,
    base: 300,
    slow: 500,
    deliberate: 800,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants — the spec'd numbers from §8.4.
// ─────────────────────────────────────────────────────────────────────────────

export const layout = {
  topBarHeight: 56, // §8.4 — fixed, not collapsing
  tabBarHeight: 56, // §8.4
  scanFabSize: 64, // §8.4 — 64×64 square
  scanFabOffsetBottom: 24, // §8.4 — sits 24px above safe-area-inset-bottom
  scanFabOffsetRight: 16,
  contentPaddingH: 16, // §5.2 — edge-to-edge with 16px horizontal padding inside
  hairlineWidth: 1,
} as const;
