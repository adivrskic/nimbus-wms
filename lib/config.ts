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
  productName: "Nimbus WMS",

  // ----------------------------------------------------------
  // Client branding (changes per customer)
  // ----------------------------------------------------------
  clientName: "American Flooring Services",
  clientShortName: "AFS",

  // ----------------------------------------------------------
  // Client logo — swap this require() per customer
  // Place logo files in /assets/ and reference here
  // ----------------------------------------------------------
  clientLogo: require("../assets/logo.webp"),

  // ----------------------------------------------------------
  // Theme colors (changes per customer)
  // ----------------------------------------------------------
  theme: {
    primary: "#93143A",
    secondary: "#22234F",
    background: "#F9F9F9",
    surface: "#FFFFFF",
    textPrimary: "#22234F",
    textSecondary: "#999999",
    border: "#EEEEEE",
    borderInput: "#DDDDDD",
    success: "#2E7D32",
    warning: "#E65100",
    danger: "#C62828",
  },
};

export const THEME = APP_CONFIG.theme;
