/**
 * Inventory — Nimbus rebuild.
 *
 * Phase 2 reference migration. Establishes the pattern every other screen
 * follows: read from `lib/theme.tsx` (Nimbus tokens), header from
 * `lib/nimbus/Header.tsx`, icons from `lib/nimbus/Icon.tsx`, design tokens
 * from `lib/nimbus/tokens.ts`. Existing data plumbing (warehouse, offline,
 * cache, supabase, permissions) preserved verbatim.
 *
 * Visual deltas from the old file:
 *   - 240px collapsing header → static 56px ScreenHeader
 *   - Rounded gradient search pill → hairline field-shell, sharp corners
 *   - Rounded category pills → mono caps tab strip with 2px gold underline
 *     (§7.13)
 *   - Rounded gradient product cards → hairline-divided rows with
 *     mono SKU + display name + mono location + tabular qty (§9.1, §9.2)
 *   - Skeleton with rounded corners → flat hairline skeleton bars
 *   - FontAwesome icons → Lucide via `lib/nimbus/Icon.tsx`
 *   - Sort menu was a custom popover → full-width bottom sheet (§8.4
 *     mobile modals are sheets, not centered dialogs)
 *
 * Data-fetch shape unchanged: queries products with an inner join on
 * locations (warehouse-scoped). Client-side filter + sort + paginate
 * because seed data is sparse (3 rows). When a warehouse exceeds ~500
 * products, swap the client filter for the `search_products(term, wh)` RPC
 * we migrated to nimbus-wms — same column shape, server-side trigram.
 */

import { useFocusEffect, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getCache, setCache } from "../../lib/cache";
import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon } from "../../lib/nimbus/Icon";
import { layout, space, type } from "../../lib/nimbus/tokens";
import { useOffline } from "../../lib/offline";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useCategories } from "../../lib/categories";
import { useWarehouse } from "../../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES — mirror the actual nimbus-wms schema (not types/db.ts, which is stale)
// ─────────────────────────────────────────────────────────────────────────────

interface SectionRef {
  code: string | null;
  name: string | null;
  color: string | null;
}

interface LocationRow {
  quantity: number | null;
  bay: number | null;
  level: number | null;
  warehouse_id: string | null;
  sections: SectionRef | null;
}

interface Product {
  id: string;
  name: string;
  barcode: string;
  internal_sku: string | null;
  category_id: string | null;
  categories: { name: string | null } | null;
  reorder_point: number | null;
  photo_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  locations: LocationRow[];
}

type SortOption =
  | "newest"
  | "oldest"
  | "name_asc"
  | "name_desc"
  | "qty_low"
  | "qty_high";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name · A → Z" },
  { value: "name_desc", label: "Name · Z → A" },
  { value: "qty_low", label: "Quantity · low → high" },
  { value: "qty_high", label: "Quantity · high → low" },
];

const PAGE_SIZE = 30;
const LOW_STOCK_THRESHOLD = 5; // matches existing behavior

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function totalQuantity(p: Product): number {
  return (p.locations ?? []).reduce((sum, l) => sum + (l.quantity ?? 0), 0);
}

/** §9.2 location callout — "A · Bay 3 · L2" from the first location row. */
function primaryLocation(p: Product): string | null {
  const first = p.locations?.[0];
  if (!first) return null;
  const code = first.sections?.code?.trim() || "?";
  return `${code} · Bay ${first.bay ?? "?"} · L${first.level ?? "?"}`;
}

function categoryLabel(p: Product): string {
  return p.categories?.name?.toUpperCase() ?? "";
}

function applySort(rows: Product[], sortBy: SortOption): Product[] {
  const copy = rows.slice();
  switch (sortBy) {
    case "newest":
      return copy.sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? "")
      );
    case "oldest":
      return copy.sort((a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? "")
      );
    case "name_asc":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "name_desc":
      return copy.sort((a, b) => b.name.localeCompare(a.name));
    case "qty_low":
      return copy.sort((a, b) => totalQuantity(a) - totalQuantity(b));
    case "qty_high":
      return copy.sort((a, b) => totalQuantity(b) - totalQuantity(a));
    default:
      return copy;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function InventoryScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();
  const { isOnline } = useOffline();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { categories } = useCategories();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  // Org-defined category tabs (app.categories) — "ALL" first.
  const categoryTabs = useMemo(
    () => [
      { value: "all", label: "ALL" },
      ...categories.map((c) => ({ value: c.id, label: c.name.toUpperCase() })),
    ],
    [categories]
  );
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [page, setPage] = useState(1);

  // ── Data fetch ──
  const loadProducts = useCallback(async () => {
    if (!wh.warehouseId) return;
    if (!refreshing) setLoading(true);

    const { data, error } = await supabase
      .from("products")
      .select(
        "id, name, barcode, internal_sku, category_id, categories(name), reorder_point, photo_url, created_at, updated_at, " +
          "locations!inner(quantity, bay, level, warehouse_id, sections(code, name, color))"
      )
      .eq("locations.warehouse_id", wh.warehouseId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setProducts(data as unknown as Product[]);
      setCache("inventory", data, wh.warehouseId);
    }
    setPage(1);
    setLoading(false);
    setRefreshing(false);
  }, [wh.warehouseId, refreshing]);

  // Refetch on warehouse switch / focus.
  useFocusEffect(
    useCallback(() => {
      if (wh.warehouseId) loadProducts();
    }, [wh.warehouseId, loadProducts])
  );

  // Offline fallback.
  useEffect(() => {
    if (!wh.warehouseId) return;
    if (isOnline) {
      loadProducts();
    } else {
      getCache<Product[]>("inventory", wh.warehouseId).then((cached) => {
        if (cached) {
          setProducts(cached);
          setLoading(false);
        }
      });
    }
  }, [wh.warehouseId, isOnline, loadProducts]);

  // ── Derived: filter + sort + paginate ──
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = products.filter((p) => {
      const matchesSearch =
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.barcode.toLowerCase().includes(term) ||
        (p.internal_sku ?? "").toLowerCase().includes(term);
      const matchesCategory =
        activeCategory === "all" || p.category_id === activeCategory;
      return matchesSearch && matchesCategory;
    });
    return applySort(list, sortBy);
  }, [products, search, activeCategory, sortBy]);

  const paginated = useMemo(
    () => filtered.slice(0, page * PAGE_SIZE),
    [filtered, page]
  );

  const hasMore = paginated.length < filtered.length;

  return (
    <View style={[styles.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={
          wh.warehouseName ? `Facility · ${wh.warehouseName}` : undefined
        }
        title="Inventory"
        trailing={
          <Pressable
            onPress={() => {
              haptic.light();
              setSortSheetOpen(true);
            }}
            hitSlop={10}
            accessibilityLabel="Sort"
          >
            <Icon name="bar-chart-3" size={18} color={T.textMuted} />
          </Pressable>
        }
      />

      {/* Search field — §7.4 field-shell pattern, hairline, sharp corners */}
      <View style={[styles.searchWrap, { borderBottomColor: T.borderSubtle }]}>
        <View
          style={[
            styles.search,
            { borderColor: T.borderSubtle, backgroundColor: T.bgElevated },
          ]}
        >
          <Icon name="search" size={14} color={T.textDim} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, barcode, or SKU…"
            placeholderTextColor={T.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, type.body, { color: T.text }]}
          />
          {search.length > 0 ? (
            <Pressable
              onPress={() => setSearch("")}
              hitSlop={10}
              accessibilityLabel="Clear search"
            >
              <Icon name="x" size={14} color={T.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Category tabs — §7.13, mono caps, 2px gold underline on active */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
        style={{ borderBottomWidth: 1, borderBottomColor: T.borderSubtle }}
      >
        {categoryTabs.map((c) => {
          const isActive = activeCategory === c.value;
          const count =
            c.value === "all"
              ? products.length
              : products.filter((p) => p.category_id === c.value).length;
          return (
            <Pressable
              key={c.value}
              onPress={() => {
                haptic.selection();
                setActiveCategory(c.value);
                setPage(1);
              }}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <View style={styles.tabInner}>
                <Text
                  style={[
                    type.label,
                    {
                      color: isActive ? T.accent : T.textMuted,
                      letterSpacing: 2,
                    },
                  ]}
                >
                  {c.label}
                </Text>
                <Text
                  style={[
                    type.labelSm,
                    {
                      color: isActive ? T.accent : T.textDim,
                      marginLeft: 6,
                    },
                  ]}
                >
                  {count}
                </Text>
              </View>
              {isActive ? (
                <View
                  style={[styles.tabRule, { backgroundColor: T.accent }]}
                  pointerEvents="none"
                />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Sort + count meta row */}
      <View style={[styles.metaRow, { borderBottomColor: T.borderSubtle }]}>
        <Text style={[type.labelSm, { color: T.textMuted }]}>
          Showing <Text style={{ color: T.text }}>{paginated.length}</Text> of{" "}
          {filtered.length}
        </Text>
        <Pressable
          onPress={() => {
            haptic.light();
            setSortSheetOpen(true);
          }}
          style={styles.sortBtn}
          accessibilityLabel="Change sort order"
        >
          <Text style={[type.labelSm, { color: T.textMuted }]}>SORT · </Text>
          <Text style={[type.labelSm, { color: T.accent }]}>
            {SORT_OPTIONS.find((s) => s.value === sortBy)?.label.toUpperCase()}
          </Text>
        </Pressable>
      </View>

      {/* Content */}
      {loading ? (
        <SkeletonList theme={T} />
      ) : filtered.length === 0 ? (
        <EmptyState
          theme={T}
          hasFilter={!!search || activeCategory !== "all"}
          searchTerm={search}
        />
      ) : (
        <FlatList
          data={paginated}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              theme={T}
              onPress={() => {
                haptic.light();
                router.push(`/product/${item.id}` as any);
              }}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 140 }}
          onEndReached={() => {
            if (hasMore) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            hasMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={T.accent} size="small" />
              </View>
            ) : filtered.length > PAGE_SIZE ? (
              <View style={styles.footer}>
                <Text style={[type.labelSm, { color: T.textDim }]}>
                  END · {filtered.length} TOTAL
                </Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={T.accent}
              onRefresh={() => {
                setRefreshing(true);
                haptic.light();
                loadProducts();
              }}
            />
          }
        />
      )}

      {/* Sort sheet — §8.4 mobile modals are sheets, not centered dialogs */}
      <SortSheet
        open={sortSheetOpen}
        current={sortBy}
        onSelect={(value) => {
          haptic.selection();
          setSortBy(value);
          setSortSheetOpen(false);
        }}
        onClose={() => setSortSheetOpen(false)}
        theme={T}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT ROW
// ─────────────────────────────────────────────────────────────────────────────

function ProductRow({
  product,
  theme: T,
  onPress,
}: {
  product: Product;
  theme: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  const qty = totalQuantity(product);
  const loc = primaryLocation(product);
  const reorder = product.reorder_point ?? 0;
  const isLow =
    reorder > 0 ? qty <= reorder : qty <= LOW_STOCK_THRESHOLD && qty > 0;
  const isOut = qty === 0;

  // §9.5 alert escalation: 4px left border in warning/danger when stock is low
  const leftBorderColor = isOut ? T.danger : isLow ? T.warning : "transparent";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? T.surface2 : "transparent",
          borderBottomColor: T.borderFaint,
          borderLeftColor: leftBorderColor,
          borderLeftWidth: 4,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${qty} units${
        loc ? ` at ${loc}` : ""
      }`}
    >
      <View style={styles.rowMain}>
        {/* Top line: product name + qty */}
        <View style={styles.rowTop}>
          <Text
            style={[type.bodyLg, { color: T.text, flex: 1, fontSize: 15 }]}
            numberOfLines={1}
          >
            {product.name}
          </Text>

          <View style={styles.qtyWrap}>
            <Text
              style={[
                type.displayXs,
                {
                  color: isOut ? T.danger : isLow ? T.warning : T.text,
                  fontFamily: type.monoBody.fontFamily,
                  fontSize: 18,
                },
              ]}
            >
              {qty.toLocaleString()}
            </Text>
            <Text
              style={[type.labelSm, { color: T.textDim, letterSpacing: 1.5 }]}
            >
              UNITS
            </Text>
          </View>
        </View>

        {/* Bottom line: SKU · location · category — all mono */}
        <View style={styles.rowBottom}>
          <Text
            style={[type.monoSm, { color: T.textMuted, letterSpacing: 0.5 }]}
            numberOfLines={1}
          >
            {product.internal_sku ?? product.barcode}
            {loc ? <Text style={{ color: T.textDim }}> · </Text> : null}
            {loc ? <Text style={{ color: T.textMuted }}>{loc}</Text> : null}
            {categoryLabel(product) ? (
              <>
                <Text style={{ color: T.textDim }}> · </Text>
                <Text style={{ color: T.textDim }}>
                  {categoryLabel(product)}
                </Text>
              </>
            ) : null}
          </Text>
        </View>
      </View>

      <Icon name="chevron-right" size={14} color={T.textDim} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON / EMPTY
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonList({ theme: T }: { theme: ReturnType<typeof useTheme> }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={[styles.skelRow, { borderBottomColor: T.borderFaint }]}
        >
          <View style={{ flex: 1 }}>
            <Animated.View
              style={[
                styles.skelBar,
                { backgroundColor: T.surface2, width: "55%", opacity },
              ]}
            />
            <Animated.View
              style={[
                styles.skelBar,
                {
                  backgroundColor: T.surface2,
                  width: "35%",
                  height: 10,
                  marginTop: 8,
                  opacity,
                },
              ]}
            />
          </View>
          <Animated.View
            style={[
              styles.skelBar,
              { backgroundColor: T.surface2, width: 36, height: 22, opacity },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

function EmptyState({
  theme: T,
  hasFilter,
  searchTerm,
}: {
  theme: ReturnType<typeof useTheme>;
  hasFilter: boolean;
  searchTerm: string;
}) {
  return (
    <View style={styles.empty}>
      <Text style={[type.label, { color: T.textMuted, letterSpacing: 2.5 }]}>
        {hasFilter ? "NO MATCHES · 00" : "NO PRODUCTS · 00"}
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
        {hasFilter
          ? `Nothing found${searchTerm ? ` for "${searchTerm}"` : ""}.`
          : "No products in this facility yet."}
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
        {hasFilter
          ? "Try a different search term or clear the category filter."
          : "Register your first product by tapping the scan button."}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SORT SHEET — §8.4 full-width bottom sheet, not centered modal
// ─────────────────────────────────────────────────────────────────────────────

function SortSheet({
  open,
  current,
  onSelect,
  onClose,
  theme: T,
}: {
  open: boolean;
  current: SortOption;
  onSelect: (v: SortOption) => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();

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
          onPress={() => {}} // swallow taps inside the sheet
          style={[
            styles.sheet,
            {
              backgroundColor: T.bgElevated,
              borderTopColor: T.borderSubtle,
              paddingBottom: insets.bottom + space.s16,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[type.label, { color: T.textMuted }]}>SORT BY</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="x" size={16} color={T.textMuted} />
            </Pressable>
          </View>

          {SORT_OPTIONS.map((opt, i) => {
            const isActive = opt.value === current;
            return (
              <Pressable
                key={opt.value}
                onPress={() => onSelect(opt.value)}
                style={({ pressed }) => [
                  styles.sheetRow,
                  {
                    backgroundColor: pressed ? T.surface2 : "transparent",
                    borderBottomColor: T.borderFaint,
                    borderBottomWidth: i === SORT_OPTIONS.length - 1 ? 0 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    type.bodyLg,
                    { color: isActive ? T.accent : T.text, fontSize: 15 },
                  ]}
                >
                  {opt.label}
                </Text>
                {isActive ? (
                  <Icon name="check" size={16} color={T.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  // Search row
  searchWrap: {
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s12,
    borderBottomWidth: 1,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.s12,
    paddingVertical: space.s8,
    borderWidth: layout.hairlineWidth,
    gap: space.s8,
  },
  searchInput: {
    flex: 1,
    padding: 0,
  },

  // Category tab strip
  tabsRow: {
    paddingHorizontal: layout.contentPaddingH,
    height: 44,
    alignItems: "stretch",
  },
  tab: {
    paddingHorizontal: space.s12,
    justifyContent: "center",
  },
  tabInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  tabRule: {
    position: "absolute",
    bottom: 0,
    left: space.s12,
    right: space.s12,
    height: 2,
  },

  // Meta row (count + sort)
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s12,
    borderBottomWidth: 1,
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
  },

  // Product row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.s12,
    paddingRight: layout.contentPaddingH,
    paddingLeft: layout.contentPaddingH - 4, // adjust for the 4px left border
    borderBottomWidth: layout.hairlineWidth,
    gap: space.s12,
  },
  rowMain: {
    flex: 1,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s12,
  },
  rowBottom: {
    marginTop: 4,
  },
  qtyWrap: {
    alignItems: "flex-end",
    minWidth: 50,
  },

  // Skeleton
  skelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s16,
    borderBottomWidth: layout.hairlineWidth,
    gap: space.s12,
  },
  skelBar: {
    height: 14,
    // SHARP corners — no borderRadius per §1.1
  },

  // Empty state
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: layout.contentPaddingH,
    paddingBottom: space.s64,
  },

  // Footer
  footer: {
    paddingVertical: space.s20,
    alignItems: "center",
  },

  // Sort sheet
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopWidth: layout.hairlineWidth,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: space.s12,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.s16,
  },
});
