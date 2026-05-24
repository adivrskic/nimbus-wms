/**
 * ScreenHeader — Nimbus mobile header per §8.4.
 *
 *   56px tall · logo/back glyph + title · 1px hairline bottom · static.
 *
 * Replaces the animated collapsing header in `lib/Header.tsx`. That file is
 * kept around so already-migrated screens (home, map, inventory, settings)
 * still compile — they'll move to this one screen-by-screen.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  [leading]   eyebrow (optional, mono caps)        [trailing] │
 *   │              Title (display-xs)                              │
 *   ├──────────────────────────────────────────────────────────────┤  ← hairline
 *
 * No gradient. No background fill (transparent — sits on var(--bg)). No
 * stats strip, no warehouse picker chrome — those move to dedicated
 * surfaces (Settings → workspace, or a tap-target on the title).
 */

import React from "react";
import { Platform, StatusBar, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme";
import { layout, type } from "./tokens";

const IOS_STATUS_BAR_APPROX = 47;

interface Props {
  title: string;
  /** Mono caps text above the title — typically the section ("inventory",
   *  "facility name"). Keep ≤ ~28 chars. */
  eyebrow?: string;
  /** Leading slot — typically a back/menu glyph or a logo mark. 24×24 area. */
  leading?: React.ReactNode;
  /** Trailing slot — one or two ghost icons (search, filter, more). */
  trailing?: React.ReactNode;
}

export function ScreenHeader({ title, eyebrow, leading, trailing }: Props) {
  const T = useTheme();

  const statusBarHeight =
    Platform.OS === "ios"
      ? IOS_STATUS_BAR_APPROX
      : StatusBar.currentHeight ?? 24;

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: statusBarHeight,
          borderBottomColor: T.borderSubtle,
          backgroundColor: T.bg,
        },
      ]}
    >
      <View style={styles.row}>
        {leading ? <View style={styles.leading}>{leading}</View> : null}

        <View style={styles.center}>
          {eyebrow ? (
            <Text
              style={[type.labelSm, { color: T.textMuted }]}
              numberOfLines={1}
            >
              {eyebrow}
            </Text>
          ) : null}
          <Text style={[type.displayXs, { color: T.text }]} numberOfLines={1}>
            {title}
          </Text>
        </View>

        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: layout.hairlineWidth,
  },
  row: {
    height: layout.topBarHeight,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: layout.contentPaddingH,
  },
  leading: {
    width: 32,
    height: 32,
    marginRight: 12,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 12,
  },
});
