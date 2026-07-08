// ============================================================
// NIMBUS WMS — Client Configuration
// ============================================================
// Change these values per client deployment.
// Everything else in the app reads from here.
// ============================================================

export const APP_CONFIG = {
  // ----------------------------------------------------------
  // Product branding (your company — stays the same)
  // ----------------------------------------------------------
  productName: "Nautilus Inventory",

  // ----------------------------------------------------------
  // Client branding (changes per customer)
  // ----------------------------------------------------------
  clientName: "Nautilus Inventory",
  clientShortName: "NAUTILUS",

  // ----------------------------------------------------------
  // Client logo — swap this require() per customer
  // Place logo files in /assets/ and reference here
  // ----------------------------------------------------------
  clientLogo: require("../assets/images/icon.png"),

  // ----------------------------------------------------------
  // Theme colors — Nimbus dark palette. Kept only for legacy
  // consumers (lib/ui.tsx, lib/offlineUI.tsx); new code should
  // read from useTheme() / lib/nimbus/tokens instead.
  // ----------------------------------------------------------
  theme: {
    primary: "#d4a853", // gold accent
    secondary: "#a3a3a3", // gray-2
    background: "#000000",
    surface: "#0a0a0a",
    textPrimary: "#ffffff",
    textSecondary: "#737373",
    border: "#262626",
    borderInput: "#262626",
    success: "#22c55e",
    warning: "#d97706",
    danger: "#ef4444",
  },
};

export const THEME = APP_CONFIG.theme;
