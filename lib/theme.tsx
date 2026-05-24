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
  surface2: color.whiteAlpha.a1, // hover/elevated on dark
  surface3: "rgba(255,255,255,0.04)",

  text: color.white,
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
// LIGHT — reserved for sign-in / sign-up / forgot-password per §8.5.
// Gold accent stays the same; dark text on warm light surfaces.
// ─────────────────────────────────────────────────────────────────────────────

const LIGHT = {
  // Legacy keys
  primary: color.accent,
  secondary: color.gray3,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  background: color.gray1,
  surface: color.white,
  textPrimary: color.black,
  textSecondary: color.gray3,
  border: color.blackAlpha.a3,
  borderInput: color.blackAlpha.a3,
  navFill: color.white,
  headerGradient: [color.white, color.white] as [string, string],

  // New keys
  accent: color.accent,
  accentDim: color.accentDim,
  accentBright: color.accentBright,

  bg: color.gray1,
  bgElevated: color.white,
  surface2: color.blackAlpha.a1,
  surface3: color.blackAlpha.a2,

  text: color.black,
  textMuted: color.gray3,
  textDim: color.gray2,

  borderHover: color.blackAlpha.a4,
  borderSubtle: color.blackAlpha.a2,
  borderFaint: color.blackAlpha.a1,

  info: color.info,
  infoDim: color.infoDim,
  successDim: color.successDim,
  warningDim: color.warningDim,
  dangerDim: color.dangerDim,

  glassBg: "rgba(255,255,255,0.80)",
  glassBorder: color.blackAlpha.a2,
  modalBackdrop: color.blackAlpha.a6,

  mode: "light" as const,
};

export type ThemeColors = typeof DARK;

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
