/**
 * Canonical external URLs for the Nautilus suite. The public marketing, help,
 * and legal pages all live on the apex domain nautilusinventory.com.
 *
 * Keep every outbound link here so the domain can't drift across screens
 * (the app previously pointed at a stale nimbuswms.com).
 */
export const LINKS = {
  signup: "https://nautilusinventory.com/signup",
  help: "https://nautilusinventory.com/help",
  terms: "https://nautilusinventory.com/legal/terms",
  privacy: "https://nautilusinventory.com/legal/privacy",
} as const;
