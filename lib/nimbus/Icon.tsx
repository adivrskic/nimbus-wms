/**
 * Icon — Lucide-style line glyphs via `react-native-svg`.
 *
 * Updated for Option A IA: adds the glyphs the More menu needs
 * (bell, bar-chart-3, rotate-ccw, clipboard-list, log-out, layout-grid).
 *
 * Same rules as phase 1: 24×24 viewBox, stroke 1.5, currentColor, never
 * filled. Add more by pasting Lucide path data into the PATHS map.
 */

import React from "react";
import Svg, { Path } from "react-native-svg";

export type IconName =
  // Tab bar + header (phase 1)
  | "home"
  | "map"
  | "package"
  | "settings"
  | "barcode"
  | "search"
  | "x"
  | "chevron-right"
  | "chevron-left"
  | "chevron-down"
  | "plus"
  | "more-horizontal"
  | "arrow-left"
  | "menu"
  | "check"
  | "alert-circle"
  // More menu (added for Option A)
  | "clipboard-list"
  | "bell"
  | "bar-chart-3"
  | "rotate-ccw"
  | "log-out"
  | "layout-grid"
  | "fingerprint"
  | "user"
  | "truck"
  | "move"
  | "sliders"
  | "circle"
  | "camera"
  | "minus"
  | "pencil"
  | "trash"
  | "help-circle";

const PATHS: Record<IconName, string[]> = {
  home: ["M3 9.5 12 3l9 6.5V20a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2V9.5z"],
  map: ["M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z", "M9 3v15", "M15 6v15"],
  package: [
    "M16.5 9.4 7.55 4.24",
    "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
    "M3.27 6.96 12 12.01l8.73-5.05",
    "M12 22.08V12",
  ],
  settings: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ],
  barcode: [
    "M4 6v12",
    "M7 6v12",
    "M9 6v12",
    "M12 6v12",
    "M14 6v12",
    "M17 6v12",
    "M20 6v12",
  ],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "M21 21l-4.35-4.35"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  "chevron-right": ["m9 18 6-6-6-6"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-down": ["m6 9 6 6 6-6"],
  plus: ["M12 5v14", "M5 12h14"],
  "more-horizontal": ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  "arrow-left": ["m12 19-7-7 7-7", "M19 12H5"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  check: ["M20 6 9 17l-5-5"],
  "alert-circle": [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
    "M12 8v4",
    "M12 16h.01",
  ],

  // ── Option A additions ────────────────────────────────────────────
  "clipboard-list": [
    "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
    "M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z",
    "M12 11h4",
    "M12 16h4",
    "M8 11h.01",
    "M8 16h.01",
  ],
  bell: [
    "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9",
    "M10.3 21a1.94 1.94 0 0 0 3.4 0",
  ],
  "bar-chart-3": [
    "M3 3v18h18",
    "M7 16V9",
    "M11 16V5",
    "M15 16v-4",
    "M19 16v-8",
  ],
  "rotate-ccw": [
    "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
    "M3 3v5h5",
  ],
  "log-out": [
    "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
    "M16 17l5-5-5-5",
    "M21 12H9",
  ],
  "layout-grid": [
    "M3 3h7v7H3z",
    "M14 3h7v7h-7z",
    "M14 14h7v7h-7z",
    "M3 14h7v7H3z",
  ],
  fingerprint: [
    "M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4",
    "M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2",
    "M17.29 21.02c.12-.6.43-2.3.5-3.02",
    "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4",
    "M8.65 22c.21-.66.45-1.32.57-2",
    "M14 13.12c0 2.38 0 6.38-1 8.88",
    "M2 16h.01",
    "M21.8 16c.2-2 .13-5.35 0-6",
    "M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2",
  ],
  user: [
    "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
    "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  ],
  truck: [
    "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2",
    "M15 18H9",
    "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14",
    "M7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    "M17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  ],
  move: [
    "M12 2v20",
    "m15 19-3 3-3-3",
    "m19 9 3 3-3 3",
    "M2 12h20",
    "m5 9-3 3 3 3",
    "m9 5 3-3 3 3",
  ],
  sliders: [
    "M21 4h-7",
    "M10 4H3",
    "M21 12h-9",
    "M8 12H3",
    "M21 20h-5",
    "M12 20H3",
    "M14 2v4",
    "M8 10v4",
    "M16 18v4",
  ],
  circle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"],
  camera: [
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
    "M12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  ],
  minus: ["M5 12h14"],
  pencil: [
    "M21.174 6.812a1 1 0 0 0-3.986-3.986L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    "m15 5 4 4",
  ],
  trash: [
    "M3 6h18",
    "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M10 11v6",
    "M14 11v6",
  ],
  "help-circle": [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",
    "M12 17h.01",
  ],
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 18,
  color = "currentColor",
  strokeWidth = 1.5,
}: IconProps) {
  const paths = PATHS[name];
  if (!paths) {
    if (__DEV__) console.warn(`[Icon] Unknown name "${name}"`);
    return null;
  }
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d, i) => (
        <Path key={i} d={d} />
      ))}
    </Svg>
  );
}
