/**
 * Map — Nimbus rebuild against the floor_* schema.
 *
 * Drop-in replacement for app/(tabs)/map.tsx. Reads facility geometry
 * straight from the columns the desktop builder writes:
 *   - warehouses.floor_canvas_width / floor_canvas_height / floor_unit
 *   - sections.floor_x / floor_y / floor_width / floor_height / rotation
 *
 * No more position_json parsing, no more 90° rotation hack. The same
 * coordinates the desktop persists render here. (position_json is still
 * in the schema — keeping it around as a safety net during transition.
 * Once desktop write paths are confirmed against floor_*, drop it.)
 *
 * Tap a section → bottom sheet with the section's bay × level layout, the
 * product/stock summary aggregated from locations, and a placeholder for
 * a future bay-detail drill-down.
 *
 * Per §9.4 "Route/path display": top-down (no rotation by default —
 * sections rotate individually if their `rotation` column says so),
 * 1px hairline rack rectangles with the section's stored color as both
 * fill (15% opacity) and stroke. Section labels are mono caps.
 *
 * Per §8.4 mobile rules: the bottom sheet is a full-width slide-up,
 * not a centered modal.
 *
 * NOT yet implemented (TODO for follow-up):
 *   - Pinch-to-zoom + pan. Current view fits the canvas to the
 *     available width. Add gesture-handler + reanimated when needed.
 *   - Bay-level drill-down screen. Tapping "View bays" is currently a
 *     no-op with a TODO marker.
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { G, Rect, Text as SvgText } from "react-native-svg";

import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon } from "../../lib/nimbus/Icon";
import { layout, space, type } from "../../lib/nimbus/tokens";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface WarehouseRow {
  id: string;
  name: string;
  floor_canvas_width: number;
  floor_canvas_height: number;
  floor_unit: string;
}

interface SectionRow {
  id: string;
  code: string;
  name: string;
  color: string | null;
  floor_x: number;
  floor_y: number;
  floor_width: number;
  floor_height: number;
  rotation: number;
  total_bays: number;
  total_levels: number;
}

interface SectionStats {
  distinct_products: number;
  total_stock: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const T = useTheme();
  const router = useRouter();
  const { warehouseId, warehouseName } = useWarehouse();

  const [warehouse, setWarehouse] = useState<WarehouseRow | null>(null);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [stats, setStats] = useState<Map<string, SectionStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);

    const [wh, secs, locs] = await Promise.all([
      supabase
        .from("warehouses")
        .select("id, name, floor_canvas_width, floor_canvas_height, floor_unit")
        .eq("id", warehouseId)
        .maybeSingle(),
      supabase
        .from("sections")
        .select(
          "id, code, name, color, floor_x, floor_y, floor_width, floor_height, rotation, total_bays, total_levels"
        )
        .eq("warehouse_id", warehouseId)
        .order("sort_order"),
      supabase
        .from("locations")
        .select("section_id, product_id, quantity")
        .eq("warehouse_id", warehouseId)
        .eq("is_active", true),
    ]);

    if (wh.data) setWarehouse(wh.data as WarehouseRow);
    if (secs.data) setSections(secs.data as SectionRow[]);

    // Build per-section stats map from the locations rows
    const s = new Map<string, SectionStats>();
    if (locs.data) {
      const seenPerSection = new Map<string, Set<string>>();
      for (const row of locs.data as Array<{
        section_id: string | null;
        product_id: string | null;
        quantity: number | null;
      }>) {
        if (!row.section_id) continue;
        const prev = s.get(row.section_id) ?? {
          distinct_products: 0,
          total_stock: 0,
        };
        prev.total_stock += row.quantity ?? 0;
        if (row.product_id) {
          const seen = seenPerSection.get(row.section_id) ?? new Set();
          seen.add(row.product_id);
          seenPerSection.set(row.section_id, seen);
          prev.distinct_products = seen.size;
        }
        s.set(row.section_id, prev);
      }
    }
    setStats(s);

    setLoading(false);
  }, [warehouseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const selected = useMemo(
    () => sections.find((s) => s.id === selectedId) ?? null,
    [sections, selectedId]
  );

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={warehouseName ? `Facility · ${warehouseName}` : undefined}
        title="Map"
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={18} color={T.text} />
          </Pressable>
        }
      />

      {loading || !warehouse ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}>
            NO SECTIONS · 00
          </Text>
          <Text
            style={[
              type.bodyLg,
              {
                color: T.text,
                marginTop: space.s8,
                textAlign: "center",
                fontSize: 16,
              },
            ]}
          >
            No layout for this facility yet
          </Text>
          <Text
            style={[
              type.bodySm,
              {
                color: T.textMuted,
                marginTop: space.s8,
                textAlign: "center",
                maxWidth: 280,
                lineHeight: 20,
              },
            ]}
          >
            Use the facility builder on the desktop dashboard to lay out
            sections.
          </Text>
        </View>
      ) : (
        <FloorView
          warehouse={warehouse}
          sections={sections}
          stats={stats}
          onSelectSection={(id) => {
            haptic.light();
            setSelectedId(id);
          }}
          theme={T}
        />
      )}

      {selected ? (
        <SectionSheet
          open={!!selected}
          section={selected}
          stats={stats.get(selected.id) ?? null}
          onClose={() => setSelectedId(null)}
          theme={T}
        />
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOOR VIEW — SVG canvas
// ─────────────────────────────────────────────────────────────────────────────

function FloorView({
  warehouse,
  sections,
  stats,
  onSelectSection,
  theme: T,
}: {
  warehouse: WarehouseRow;
  sections: SectionRow[];
  stats: Map<string, SectionStats>;
  onSelectSection: (id: string) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const horizontalPadding = layout.contentPaddingH * 2;
  const verticalPadding = 240; // header + safe area + breathing room
  const availableW = screenW - horizontalPadding;
  const availableH = screenH - verticalPadding - insets.bottom;

  const scaleX = availableW / warehouse.floor_canvas_width;
  const scaleY = availableH / warehouse.floor_canvas_height;
  const scale = Math.min(scaleX, scaleY);

  const renderW = warehouse.floor_canvas_width * scale;
  const renderH = warehouse.floor_canvas_height * scale;

  return (
    <ScrollView
      contentContainerStyle={styles.floorWrap}
      showsVerticalScrollIndicator={false}
    >
      {/* Caption strip — §11.6 wording: "facility" not "warehouse" */}
      <View style={styles.captionRow}>
        <Text
          style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}
        >
          {sections.length} SECTIONS
        </Text>
        <Text style={[type.labelSm, { color: T.textDim, letterSpacing: 1.5 }]}>
          {warehouse.floor_canvas_width.toFixed(0)} ×{" "}
          {warehouse.floor_canvas_height.toFixed(0)}{" "}
          {warehouse.floor_unit.toUpperCase()}
        </Text>
      </View>

      {/* Canvas */}
      <View
        style={[
          styles.canvas,
          { borderColor: T.borderSubtle, width: renderW, height: renderH },
        ]}
      >
        <Svg width={renderW} height={renderH}>
          {/* Sections */}
          {sections.map((s) => {
            const x = s.floor_x * scale;
            const y = s.floor_y * scale;
            const w = s.floor_width * scale;
            const h = s.floor_height * scale;
            const cx = x + w / 2;
            const cy = y + h / 2;
            const fill = s.color ?? "#d4a853";
            const rotateAttr = s.rotation
              ? `rotate(${s.rotation}, ${cx}, ${cy})`
              : undefined;

            // Label scales with section size but clamps to a readable range
            const fontSize = Math.max(11, Math.min(22, w / 6));

            return (
              <G
                key={s.id}
                transform={rotateAttr}
                onPress={() => onSelectSection(s.id)}
              >
                <Rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={fill}
                  fillOpacity={0.15}
                  stroke={fill}
                  strokeWidth={1.5}
                />
                <SvgText
                  x={cx}
                  y={cy}
                  fill="#ffffff"
                  fontSize={fontSize}
                  fontWeight="500"
                  textAnchor="middle"
                  // RN-svg doesn't reliably honor alignmentBaseline; nudge dy.
                  dy={fontSize / 3}
                  letterSpacing={1}
                >
                  {s.code.trim()}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>

      {/* Legend — list of sections with their color swatch */}
      <Text
        style={[
          type.label,
          {
            color: T.textMuted,
            letterSpacing: 2,
            marginTop: space.s32,
            marginBottom: space.s12,
          },
        ]}
      >
        SECTIONS
      </Text>
      <View style={[styles.legendList, { borderColor: T.borderSubtle }]}>
        {sections.map((s, i) => {
          const isLast = i === sections.length - 1;
          const stat = stats.get(s.id);
          return (
            <Pressable
              key={s.id}
              onPress={() => onSelectSection(s.id)}
              style={({ pressed }) => [
                styles.legendRow,
                {
                  backgroundColor: pressed ? T.surface2 : "transparent",
                  borderBottomColor: T.borderFaint,
                  borderBottomWidth: isLast ? 0 : layout.hairlineWidth,
                },
              ]}
            >
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: s.color ?? T.accent },
                ]}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.legendTitleRow}>
                  <Text
                    style={[type.monoBody, { color: T.text, fontSize: 14 }]}
                  >
                    {s.code.trim()}
                  </Text>
                  <Text
                    style={[
                      type.labelSm,
                      { color: T.textMuted, letterSpacing: 1.5 },
                    ]}
                  >
                    {s.name.toUpperCase()}
                  </Text>
                </View>
                <Text style={[type.monoSm, { color: T.textDim, marginTop: 2 }]}>
                  {s.total_bays} bays · {s.total_levels} levels
                  {stat
                    ? `  ·  ${stat.total_stock.toLocaleString()} units`
                    : ""}
                </Text>
              </View>
              <Icon name="chevron-right" size={14} color={T.textDim} />
            </Pressable>
          );
        })}
      </View>

      <View style={{ height: space.s120 }} />
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION SHEET — bottom slide-up with section detail
// ─────────────────────────────────────────────────────────────────────────────

function SectionSheet({
  open,
  section,
  stats,
  onClose,
  theme: T,
}: {
  open: boolean;
  section: SectionRow;
  stats: SectionStats | null;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();
  const swatch = section.color ?? T.accent;

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={[styles.backdrop, { backgroundColor: T.modalBackdrop }]}
      >
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: T.bgElevated,
              borderTopColor: T.borderSubtle,
              paddingBottom: insets.bottom + space.s24,
            },
          ]}
        >
          {/* Header with code + close */}
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderLeft}>
              <View style={[styles.sheetSwatch, { backgroundColor: swatch }]} />
              <View>
                <Text
                  style={[
                    type.displayLg,
                    {
                      color: T.text,
                      fontFamily: type.monoBody.fontFamily,
                      fontSize: 28,
                      letterSpacing: -0.5,
                    },
                  ]}
                >
                  {section.code.trim()}
                </Text>
                <Text
                  style={[
                    type.labelSm,
                    { color: T.textMuted, letterSpacing: 1.5 },
                  ]}
                >
                  {section.name.toUpperCase()}
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="x" size={16} color={T.textMuted} />
            </Pressable>
          </View>

          {/* KPI strip — 3 across, same anatomy as Product detail */}
          <View style={[styles.sheetKpiStrip, { borderColor: T.borderSubtle }]}>
            <SheetKpi
              theme={T}
              label="BAYS"
              value={String(section.total_bays)}
            />
            <View
              style={[
                styles.sheetKpiDivider,
                { backgroundColor: T.borderSubtle },
              ]}
            />
            <SheetKpi
              theme={T}
              label="LEVELS"
              value={String(section.total_levels)}
            />
            <View
              style={[
                styles.sheetKpiDivider,
                { backgroundColor: T.borderSubtle },
              ]}
            />
            <SheetKpi
              theme={T}
              label="ON HAND"
              value={(stats?.total_stock ?? 0).toLocaleString()}
              unit="units"
            />
          </View>

          {/* Bay × level grid preview — §9.3-ish miniature */}
          <Text
            style={[
              type.label,
              { color: T.textMuted, letterSpacing: 2, marginTop: space.s24 },
            ]}
          >
            LAYOUT · {section.total_bays} × {section.total_levels}
          </Text>
          <View style={styles.bayGrid}>
            {Array.from({ length: section.total_levels }).map((_, levelIdx) => {
              // Render top-most level first (visually highest rack level on top)
              const levelNum = section.total_levels - levelIdx;
              return (
                <View key={levelNum} style={styles.bayRow}>
                  <Text
                    style={[
                      type.labelSm,
                      {
                        color: T.textDim,
                        width: 24,
                        letterSpacing: 1,
                      },
                    ]}
                  >
                    L{levelNum}
                  </Text>
                  <View style={styles.bayCells}>
                    {Array.from({ length: section.total_bays }).map(
                      (_, bayIdx) => (
                        <View
                          key={bayIdx}
                          style={[
                            styles.bayCell,
                            {
                              borderColor: T.borderSubtle,
                            },
                          ]}
                        />
                      )
                    )}
                  </View>
                </View>
              );
            })}
            <View style={[styles.bayRow, { marginTop: space.s4 }]}>
              <View style={{ width: 24 }} />
              <View style={styles.bayCells}>
                {Array.from({ length: section.total_bays }).map((_, bayIdx) => (
                  <Text
                    key={bayIdx}
                    style={[
                      type.labelSm,
                      {
                        flex: 1,
                        color: T.textDim,
                        textAlign: "center",
                        letterSpacing: 1,
                      },
                    ]}
                  >
                    {bayIdx + 1}
                  </Text>
                ))}
              </View>
            </View>
          </View>

          {/* Footer action */}
          <Pressable
            onPress={() => {
              haptic.light();
              // TODO(phase-2.5): route to a section/bay detail screen
              // showing product positions inside this section.
            }}
            style={({ pressed }) => [
              styles.sheetAction,
              {
                borderColor: T.borderSubtle,
                backgroundColor: pressed ? T.surface2 : "transparent",
                marginTop: space.s24,
              },
            ]}
          >
            <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
              VIEW BAYS
            </Text>
            <Icon name="chevron-right" size={14} color={T.accent} />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetKpi({
  theme: T,
  label,
  value,
  unit,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.sheetKpi}>
      <Text style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}>
        {label}
      </Text>
      <Text
        style={[
          type.displayLg,
          {
            color: T.text,
            fontFamily: type.monoBody.fontFamily,
            fontSize: 24,
            marginTop: 4,
          },
        ]}
      >
        {value}
      </Text>
      {unit ? (
        <Text
          style={[
            type.labelSm,
            { color: T.textDim, marginTop: 2, letterSpacing: 1.5 },
          ]}
        >
          {unit.toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: layout.contentPaddingH,
  },

  // Floor canvas
  floorWrap: {
    padding: layout.contentPaddingH,
    paddingTop: space.s16,
  },
  captionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.s12,
  },
  canvas: {
    alignSelf: "center",
    borderWidth: layout.hairlineWidth,
    // No background fill — sits on bg so it reads as a schematic
  },

  // Legend
  legendList: {
    borderWidth: layout.hairlineWidth,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
    minHeight: 56,
  },
  legendSwatch: {
    width: 6,
    alignSelf: "stretch",
  },
  legendTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
  },

  // Sheet
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopWidth: layout.hairlineWidth,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s20,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.s20,
  },
  sheetHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s16,
  },
  sheetSwatch: {
    width: 6,
    height: 36,
  },

  // KPI strip inside sheet
  sheetKpiStrip: {
    flexDirection: "row",
    borderWidth: layout.hairlineWidth,
  },
  sheetKpi: {
    flex: 1,
    paddingVertical: space.s16,
    paddingHorizontal: space.s12,
    alignItems: "flex-start",
  },
  sheetKpiDivider: {
    width: layout.hairlineWidth,
  },

  // Bay × level grid
  bayGrid: {
    marginTop: space.s12,
  },
  bayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    marginTop: 4,
  },
  bayCells: {
    flex: 1,
    flexDirection: "row",
    gap: 3,
  },
  bayCell: {
    flex: 1,
    height: 18,
    borderWidth: layout.hairlineWidth,
  },

  // Footer action
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s16,
    paddingVertical: space.s16,
    borderWidth: layout.hairlineWidth,
  },
});
