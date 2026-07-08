/**
 * Theme — Nimbus palette, in the shape the existing app already consumes.
 *
 * Migration note:
 *   This file replaces the old `lib/theme.tsx` in place. Every existing key
 *   the codebase uses (T.primary, T.secondary, T.surface, T.background,
 *   T.border, T.headerGradient, etc.) is preserved so unmigrated screens
 *   still compile. Values are now Nimbus tokens, which means:
 *     - Brand pink → gold accent
 *     - Purple secondary → muted gray-2
 *     - Surface white → near-black (dark mode default)
 *     - headerGradient becomes a flat two-of-the-same so LinearGradient
 *       consumers render flat without code changes.
 *
 *   New code should consume the *new* keys (accent, gray1..6, borderSubtle,
 *   textMuted, bgElevated) rather than the legacy aliases, which exist only
 *   to keep the old code limping along during the rebuild.
 *
 * Light mode is reserved per spec §8.5 for auth/onboarding only; everywhere
 * else is dark.
 */

import { createContext, useContext, useState } from "react";
import { useColorScheme } from "react-native";
import { color } from "./nimbus/tokens";

// ─────────────────────────────────────────────────────────────────────────────
// DARK — the default everywhere except auth.
// ─────────────────────────────────────────────────────────────────────────────

const DARK = {
  // ── Legacy keys (kept for backward compat — DO NOT add new consumers) ──
  primary: color.accent, // was brand pink — now gold
  secondary: color.gray2, // was purple — now muted neutral
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  background: color.black,
  surface: color.nearBlack, // cards sit ~4% off pure black
  textPrimary: color.white,
  textSecondary: color.gray2,
  border: color.gray5,
  borderInput: color.gray5,
  navFill: color.nearBlack, // tab bar bg
  headerGradient: [color.nearBlack, color.nearBlack] as [string, string], // flat

  // ── New Nimbus keys — prefer these in new + migrated code ──
  accent: color.accent,
  accentDim: color.accentDim,
  accentBright: color.accentBright,

  bg: color.black,
  bgElevated: color.nearBlack,
  surface2: "rgba(255,255,255,0.02)", // pressed/elevated-1 — desktop --surface-2
  surface3: "rgba(255,255,255,0.04)", // elevated-2 — desktop --surface-3

  text: color.white,
  // textSecondary lives in the legacy block above (same value on desktop)
  textMuted: color.gray3,
  textDim: color.gray4,

  borderHover: color.gray4,
  borderSubtle: color.whiteAlpha.a2, // 1px hairline on dark surfaces
  borderFaint: color.whiteAlpha.a1, // even softer dividers

  info: color.info,
  infoDim: color.infoDim,
  successDim: color.successDim,
  warningDim: color.warningDim,
  dangerDim: color.dangerDim,

  // Glass / overlay surfaces
  glassBg: "rgba(0,0,0,0.80)",
  glassBorder: color.whiteAlpha.a2,
  modalBackdrop: color.blackAlpha.a6,

  mode: "dark" as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT — warm cream, matching the desktop app's light theme
// (app-nimbus1/app/globals.css [data-theme="light"]): cream surfaces,
// warm-ink text, deepened semantic colors for contrast. Same gold accent.
// ─────────────────────────────────────────────────────────────────────────────

const LIGHT = {
  // Legacy keys
  primary: color.accent,
  secondary: color.cream.inkMuted,
  success: color.semanticOnLight.success,
  warning: color.semanticOnLight.warning,
  danger: color.semanticOnLight.danger,
  background: color.cream.bg,
  surface: color.cream.surface,
  textPrimary: color.cream.ink,
  textSecondary: color.cream.inkSecondary,
  border: color.cream.border,
  borderInput: color.cream.border,
  navFill: color.cream.surface,
  headerGradient: [color.cream.surface, color.cream.surface] as [
    string,
    string
  ],

  // New keys
  accent: color.accent,
  accentDim: color.accentDim,
  accentBright: color.accentBright,

  bg: color.cream.bg,
  bgElevated: color.cream.surface,
  surface2: color.cream.surface2,
  surface3: color.cream.surface3,

  text: color.cream.ink,
  // textSecondary lives in the legacy block above (same value on desktop)
  textMuted: color.cream.inkMuted,
  textDim: color.cream.inkDim,

  borderHover: color.cream.borderHover,
  borderSubtle: color.cream.borderSubtle,
  borderFaint: color.cream.borderFaint,

  info: color.semanticOnLight.info,
  infoDim: color.infoDim,
  successDim: color.successDim,
  warningDim: color.warningDim,
  dangerDim: color.dangerDim,

  glassBg: color.cream.glassBg,
  glassBorder: color.cream.glassBorder,
  modalBackdrop: color.blackAlpha.a6,

  mode: "light" as const,
};

// Widen the literal hex types so both palettes are assignable — DARK is the
// shape, not the values.
export type ThemeColors = {
  [K in keyof typeof DARK]: (typeof DARK)[K] extends string
    ? K extends "mode"
      ? "dark" | "light"
      : string
    : (typeof DARK)[K];
};

const ThemeContext = createContext<{ theme: ThemeColors; toggle: () => void }>({
  theme: DARK,
  toggle: () => {},
});

/**
 * Nimbus runs dark by default everywhere except auth. We still respect the
 * system color scheme as a starting point, and let users override via the
 * Settings screen (existing `useThemeToggle` API).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [override, setOverride] = useState<"light" | "dark" | null>(null);

  // Default to dark for product surfaces. Auth screens can manually flip
  // by wrapping in their own provider or by calling toggle on mount.
  const mode = override ?? (systemScheme === "light" ? "light" : "dark");
  const theme = mode === "dark" ? DARK : LIGHT;

  function toggle() {
    setOverride((prev) => {
      if (prev === null) return mode === "dark" ? "light" : "dark";
      return prev === "dark" ? "light" : "dark";
    });
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeColors {
  return useContext(ThemeContext).theme;
}

export function useThemeToggle(): () => void {
  return useContext(ThemeContext).toggle;
}

export { DARK, LIGHT };
