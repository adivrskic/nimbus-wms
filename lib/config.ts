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
  version: "1.0.0",

  // ----------------------------------------------------------
  // Client logo — swap this require() per customer
  // Place logo files in /assets/ and reference here
  // ----------------------------------------------------------
  clientLogo: require("../assets/images/icon.png"),
};

// Theme colors live in lib/nimbus/tokens.ts (raw values) and lib/theme.tsx
// (light/dark role mappings via useTheme()). No hex values here.
