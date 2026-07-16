/**
 * Nautilus logo — React Native port of the desktop/site lockup
 * (app-nimbus1/components/ui/Logo.tsx + LogoWordmark.tsx).
 *
 * The glyph is a solid square with a heavy grotesque "N" knocked out of it.
 * Desktop cuts the letter with an SVG <text> mask (Arial Black); native SVG
 * text can't rely on that font existing on iOS/Android, so the same letterform
 * is traced as a Path inside a Mask — pixel geometry matches the web glyph
 * (32×32 box, stems ~7 units, cap from y≈4.5 to the 27.5 baseline).
 *
 * <LogoWordmark> mirrors the marketing-site nav lockup:
 *
 *   ◧  Nautilus
 *      I N V E N T O R Y
 *
 * "INVENTORY" spreads its letters across exactly the width of "Nautilus"
 * via a stretched space-between row, same trick as the web component.
 */

import React from "react";
import { Text, View } from "react-native";
import Svg, { Mask, Path, Rect } from "react-native-svg";

import { font } from "./tokens";

// Heavy grotesque N, traced to match the Arial Black mask on the web glyph.
const N_PATH =
  "M4.5 27.5 V4.5 H11.4 L20.6 19.1 V4.5 H27.5 V27.5 H20.6 L11.4 12.9 V27.5 Z";

export function LogoMark({
  size = 22,
  color = "#d4a853",
}: {
  size?: number;
  /** Square fill — the N reads as the background showing through. */
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Mask id="nautilus-n">
        <Rect width="32" height="32" fill="white" />
        <Path d={N_PATH} fill="black" />
      </Mask>
      <Rect width="32" height="32" fill={color} mask="url(#nautilus-n)" />
    </Svg>
  );
}

const SIZES = {
  sm: { glyph: 18, name: 13, sub: 6.5, gap: 8, subGap: 2 },
  md: { glyph: 22, name: 16, sub: 8, gap: 10, subGap: 3 },
  lg: { glyph: 32, name: 22, sub: 10.5, gap: 12, subGap: 4 },
} as const;

export function LogoWordmark({
  size = "md",
  glyphColor,
  nameColor,
  subColor,
}: {
  size?: keyof typeof SIZES;
  glyphColor: string;
  nameColor: string;
  subColor: string;
}) {
  const s = SIZES[size];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: s.gap }}>
      <LogoMark size={s.glyph} color={glyphColor} />
      <View>
        <Text
          style={{
            fontFamily: font.displayBold, // 600 weight — never pair fontWeight with a brand face
            fontSize: s.name,
            letterSpacing: 0.5,
            lineHeight: s.name,
            color: nameColor,
          }}
        >
          Nautilus
        </Text>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignSelf: "stretch",
            marginTop: s.subGap,
          }}
        >
          {"INVENTORY".split("").map((c, i) => (
            <Text
              key={i}
              style={{
                fontFamily: font.mono,
                fontSize: s.sub,
                lineHeight: s.sub + 1,
                color: subColor,
              }}
            >
              {c}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}
