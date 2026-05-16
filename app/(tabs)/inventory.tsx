import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ScreenHeader, useHeaderScroll } from "../../lib/Header";
import { getCache, setCache } from "../../lib/cache";
import { useOffline } from "../../lib/offline";
import { OfflineBanner } from "../../lib/offlineUI";
import { usePermissions } from "../../lib/permissions";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { Skeleton, haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

const CATEGORIES = [
  { value: "all", label: "All", icon: "th-large" },
  { value: "hardwood", label: "Hardwood", icon: "tree" },
  { value: "laminate", label: "Laminate", icon: "clone" },
  { value: "vinyl_lvp", label: "Vinyl/LVP", icon: "square" },
  { value: "tile", label: "Tile", icon: "th" },
  { value: "carpet", label: "Carpet", icon: "ellipsis-h" },
  { value: "underlayment", label: "Underlay", icon: "minus" },
  { value: "adhesive", label: "Adhesive", icon: "tint" },
  { value: "trim_molding", label: "Trim", icon: "minus" },
  { value: "tools", label: "Tools", icon: "wrench" },
  { value: "accessories", label: "Accessories", icon: "puzzle-piece" },
  { value: "other", label: "Other", icon: "ellipsis-h" },
];

const PAGE_SIZE = 30;

type SortOption =
  | "newest"
  | "oldest"
  | "name_asc"
  | "name_desc"
  | "qty_low"
  | "qty_high";
const SORT_OPTIONS: { value: SortOption; label: string; icon: string }[] = [
  { value: "newest", label: "Newest", icon: "clock-o" },
  { value: "oldest", label: "Oldest", icon: "clock-o" },
  { value: "name_asc", label: "A → Z", icon: "sort-alpha-asc" },
  { value: "name_desc", label: "Z → A", icon: "sort-alpha-desc" },
  { value: "qty_low", label: "Qty ↑", icon: "sort-amount-asc" },
  { value: "qty_high", label: "Qty ↓", icon: "sort-amount-desc" },
];

export default function InventoryScreen() {
  const wh = useWarehouse();
  const perms = usePermissions();
  const { isOnline } = useOffline();
  const router = useRouter();
  const T = useTheme();

  const { scrollY, onScroll } = useHeaderScroll();

  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [page, setPage] = useState(1);

  useFocusEffect(
    useCallback(() => {
      if (wh.warehouseId) loadProducts();
    }, [wh.warehouseId])
  );

  useEffect(() => {
    if (wh.warehouseId) {
      if (isOnline) {
        loadProducts();
      } else {
        getCache<any[]>("inventory", wh.warehouseId).then((cached) => {
          if (cached) {
            setProducts(cached);
            setLoading(false);
          }
        });
      }
    }
  }, [wh.warehouseId, isOnline]);

  async function loadProducts() {
    if (!wh.warehouseId) return;
    if (!refreshing) setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select(
        "*, locations!inner(quantity, bay, level, warehouse_id, sections(code, name, color))"
      )
      .eq("locations.warehouse_id", wh.warehouseId)
      .order("created_at", { ascending: false });
    if (!error && data) {
      setProducts(data);
      setCache("inventory", data, wh.warehouseId);
    }
    setPage(1);
    setLoading(false);
    setRefreshing(false);
  }

  function getProductQuantity(product: any) {
    return (product.locations || []).reduce(
      (sum: number, loc: any) => sum + (loc.quantity || 0),
      0
    );
  }

  const filtered = products
    .filter((p) => {
      const matchesSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.barcode.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        activeCategory === "all" || p.category === activeCategory;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        case "oldest":
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        case "name_asc":
          return a.name.localeCompare(b.name);
        case "name_desc":
          return b.name.localeCompare(a.name);
        case "qty_low":
          return getProductQuantity(a) - getProductQuantity(b);
        case "qty_high":
          return getProductQuantity(b) - getProductQuantity(a);
        default:
          return 0;
      }
    });

  const paginated = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = paginated.length < filtered.length;

  function loadMore() {
    if (hasMore) setPage((p) => p + 1);
  }

  function getCategoryCount(cat: string) {
    if (cat === "all") return products.length;
    return products.filter((p) => p.category === cat).length;
  }

  const totalStock = products.reduce(
    (sum, p) => sum + getProductQuantity(p),
    0
  );

  async function handleExport() {
    haptic.medium();
    let csv = "Name,Barcode,Category,Section,Bay,Level,Quantity\n";
    filtered.forEach((p: any) => {
      (p.locations || []).forEach((loc: any) => {
        csv += `"${p.name}","${p.barcode}","${p.category}","${
          loc.sections?.code || ""
        }",${loc.bay || ""},${loc.level || ""},${loc.quantity || 0}\n`;
      });
    });
    await Share.share({
      message: csv,
      title: `${wh.warehouseName} Inventory Export`,
    });
  }

  function renderProduct({ item }: { item: any }) {
    return (
      <ProductCard
        item={item}
        T={T}
        onPress={() => {
          haptic.light();
          router.push(`/product/${item.id}`);
        }}
      />
    );
  }

  return (
    <View style={[s.screen, { backgroundColor: T.background }]}>
      <ScreenHeader {...wh} scrollY={scrollY} />
      <View style={s.content}>
        <OfflineBanner />
        {!loading && (
          <View
            style={[
              s.summaryRow,
              { backgroundColor: T.surface, borderColor: T.border },
            ]}
          >
            <View style={s.summaryItem}>
              <Text style={[s.summaryNum, { color: T.textPrimary }]}>
                {products.length}
              </Text>
              <Text style={[s.summaryLabel, { color: T.textSecondary }]}>
                Products
              </Text>
            </View>
            <View style={[s.summaryDivider, { backgroundColor: T.border }]} />
            <View style={s.summaryItem}>
              <Text style={[s.summaryNum, { color: T.textPrimary }]}>
                {totalStock}
              </Text>
              <Text style={[s.summaryLabel, { color: T.textSecondary }]}>
                Total Units
              </Text>
            </View>
            <View style={[s.summaryDivider, { backgroundColor: T.border }]} />
            <View style={s.summaryItem}>
              <Text style={[s.summaryNum, { color: T.textPrimary }]}>
                {filtered.length}
              </Text>
              <Text style={[s.summaryLabel, { color: T.textSecondary }]}>
                Showing
              </Text>
            </View>
          </View>
        )}

        <View
          style={[
            s.searchRow,
            { backgroundColor: T.surface, borderColor: T.border },
          ]}
        >
          <FontAwesome
            name="search"
            size={14}
            color={T.textSecondary}
            style={{ marginRight: 10 }}
          />
          <TextInput
            style={[s.searchInput, { color: T.textPrimary }]}
            placeholder="Search by name or barcode..."
            placeholderTextColor={T.textSecondary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <FontAwesome
                name="times-circle"
                size={16}
                color={T.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Sort + Export row */}
        <View style={s.sortExportRow}>
          <TouchableOpacity
            style={[
              s.sortBtn,
              { backgroundColor: T.surface, borderColor: T.border },
            ]}
            onPress={() => {
              haptic.light();
              setShowSortMenu(!showSortMenu);
            }}
            activeOpacity={0.7}
          >
            <FontAwesome
              name="sort"
              size={12}
              color={T.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={[s.sortBtnText, { color: T.textPrimary }]}>
              {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
            </Text>
            <FontAwesome
              name="chevron-down"
              size={9}
              color={T.textSecondary}
              style={{ marginLeft: 4 }}
            />
          </TouchableOpacity>
          {perms.canExportInventory && (
            <TouchableOpacity
              style={[
                s.exportBtn,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
              onPress={handleExport}
              activeOpacity={0.7}
            >
              <FontAwesome
                name="download"
                size={12}
                color={T.primary}
                style={{ marginRight: 6 }}
              />
              <Text style={[s.exportBtnText, { color: T.primary }]}>
                Export
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {showSortMenu && (
          <View
            style={[
              s.sortMenu,
              { backgroundColor: T.surface, borderColor: T.border },
            ]}
          >
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  s.sortMenuItem,
                  { borderBottomColor: T.border },
                  sortBy === opt.value && { backgroundColor: T.primary + "08" },
                ]}
                onPress={() => {
                  setSortBy(opt.value);
                  setShowSortMenu(false);
                  setPage(1);
                  haptic.selection();
                }}
              >
                <FontAwesome
                  name={opt.icon as any}
                  size={13}
                  color={sortBy === opt.value ? T.primary : T.textSecondary}
                  style={{ width: 24 }}
                />
                <Text
                  style={[
                    s.sortMenuText,
                    { color: T.textPrimary },
                    sortBy === opt.value && {
                      color: T.primary,
                      fontWeight: "600",
                    },
                  ]}
                >
                  {opt.label}
                </Text>
                {sortBy === opt.value && (
                  <FontAwesome
                    name="check"
                    size={12}
                    color={T.primary}
                    style={{ marginLeft: "auto" }}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORIES}
          keyExtractor={(c) => c.value}
          style={s.pillRow}
          contentContainerStyle={{ paddingRight: 20 }}
          renderItem={({ item: c }) => {
            const isActive = activeCategory === c.value;
            const count = getCategoryCount(c.value);
            return (
              <TouchableOpacity
                style={s.pill}
                onPress={() => {
                  setActiveCategory(c.value);
                  haptic.selection();
                }}
                activeOpacity={0.7}
              >
                {isActive ? (
                  <LinearGradient
                    colors={T.headerGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={s.pillGradient}
                  >
                    <FontAwesome
                      name={c.icon as any}
                      size={11}
                      color="#FFF"
                      style={{ marginRight: 5 }}
                    />
                    <Text style={s.pillTextActive}>{c.label}</Text>
                    <View style={s.pillCount}>
                      <Text style={s.pillCountText}>{count}</Text>
                    </View>
                  </LinearGradient>
                ) : (
                  <View
                    style={[
                      s.pillInner,
                      { backgroundColor: T.surface, borderColor: T.border },
                    ]}
                  >
                    <Text style={[s.pillText, { color: T.textSecondary }]}>
                      {c.label}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />

        {loading ? (
          <View style={{ paddingTop: 8 }}>
            {[1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={[
                  s.skeletonCard,
                  { backgroundColor: T.surface, borderColor: T.border },
                ]}
              >
                <Skeleton
                  width={40}
                  height={40}
                  borderRadius={10}
                  style={{ marginRight: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Skeleton
                    width="70%"
                    height={15}
                    style={{ marginBottom: 6 }}
                  />
                  <Skeleton
                    width="50%"
                    height={12}
                    style={{ marginBottom: 6 }}
                  />
                  <Skeleton width="35%" height={10} />
                </View>
                <Skeleton width={30} height={24} borderRadius={6} />
              </View>
            ))}
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.emptyWrap}>
            <View
              style={[
                s.emptyCircle,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              <FontAwesome name="inbox" size={32} color={T.textSecondary} />
            </View>
            <Text style={[s.emptyTitle, { color: T.textPrimary }]}>
              No products found
            </Text>
            <Text style={[s.emptySub, { color: T.textSecondary }]}>
              {search
                ? `No results for "${search}"`
                : "Try changing the category filter"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={paginated}
            keyExtractor={(item) => item.id}
            renderItem={renderProduct}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120, paddingTop: 4 }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              hasMore ? (
                <View style={{ paddingVertical: 20, alignItems: "center" }}>
                  <ActivityIndicator color={T.primary} />
                  <Text
                    style={{
                      color: T.textSecondary,
                      fontSize: 12,
                      marginTop: 6,
                    }}
                  >
                    {paginated.length} of {filtered.length} products
                  </Text>
                </View>
              ) : filtered.length > PAGE_SIZE ? (
                <Text
                  style={{
                    color: T.textSecondary,
                    fontSize: 12,
                    textAlign: "center",
                    paddingVertical: 16,
                  }}
                >
                  All {filtered.length} products loaded
                </Text>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  haptic.light();
                  loadProducts();
                }}
                tintColor={T.primary}
              />
            }
          />
        )}
      </View>
    </View>
  );
}

function ProductCard({
  item,
  T,
  onPress,
}: {
  item: any;
  T: any;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const loc = item.locations?.[0];
  const locData = loc
    ? {
        label: `${loc.sections?.code || "?"}-Bay${loc.bay}-L${loc.level}`,
        color: loc.sections?.color || T.primary,
        section: loc.sections?.code || "?",
      }
    : null;
  const qty = (item.locations || []).reduce(
    (sum: number, l: any) => sum + (l.quantity || 0),
    0
  );
  const isLowStock = qty <= 5 && qty > 0;

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={() =>
        Animated.spring(scale, {
          toValue: 0.97,
          useNativeDriver: true,
          speed: 50,
          bounciness: 4,
        }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 50,
          bounciness: 4,
        }).start()
      }
    >
      <Animated.View
        style={[
          s.productCard,
          {
            backgroundColor: T.surface,
            borderColor: T.border,
            transform: [{ scale }],
          },
        ]}
      >
        {item.photo_url ? (
          <Image
            source={{ uri: item.photo_url }}
            style={s.productThumb}
            resizeMode="cover"
          />
        ) : (
          <View
            style={[
              s.sectionAccent,
              { backgroundColor: locData?.color || T.textSecondary },
            ]}
          >
            <Text style={s.sectionAccentText}>{locData?.section || "?"}</Text>
          </View>
        )}
        <View style={s.productBody}>
          <View style={s.productTop}>
            <View style={{ flex: 1 }}>
              <Text
                style={[s.productName, { color: T.textPrimary }]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              <Text style={[s.productMeta, { color: T.textSecondary }]}>
                {item.category.replace("_", "/").toUpperCase()} {"\u2022"}{" "}
                {item.barcode}
              </Text>
            </View>
            <View style={s.qtyWrap}>
              <Text
                style={[
                  s.qtyValue,
                  { color: isLowStock ? T.danger : T.textPrimary },
                ]}
              >
                {qty}
              </Text>
              <Text style={[s.qtyLabel, { color: T.textSecondary }]}>
                units
              </Text>
            </View>
          </View>
          <View style={s.productBottom}>
            {locData ? (
              <View
                style={[s.locationChip, { backgroundColor: T.primary + "10" }]}
              >
                <FontAwesome name="map-marker" size={10} color={T.primary} />
                <Text style={[s.locationText, { color: T.primary }]}>
                  {locData.label}
                </Text>
              </View>
            ) : (
              <View
                style={[
                  s.noLocationChip,
                  { backgroundColor: T.textSecondary + "15" },
                ]}
              >
                <Text style={[s.noLocationText, { color: T.textSecondary }]}>
                  No location
                </Text>
              </View>
            )}
            {isLowStock && (
              <View
                style={[s.lowStockChip, { backgroundColor: T.danger + "10" }]}
              >
                <FontAwesome
                  name="exclamation-triangle"
                  size={9}
                  color={T.danger}
                />
                <Text style={[s.lowStockText, { color: T.danger }]}>
                  Low stock
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            <FontAwesome
              name="chevron-right"
              size={11}
              color={T.textSecondary}
            />
          </View>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  summaryRow: {
    flexDirection: "row",
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryNum: { fontSize: 18, fontWeight: "bold" },
  summaryLabel: { fontSize: 10, marginTop: 2 },
  summaryDivider: { width: 1 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15 },
  pillRow: { maxHeight: 38, marginBottom: 14 },
  pill: { marginRight: 8, borderRadius: 20, overflow: "hidden" },
  pillGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pillInner: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: { fontSize: 13 },
  pillTextActive: { fontSize: 13, color: "#FFF", fontWeight: "600" },
  pillCount: {
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  pillCountText: { fontSize: 11, color: "#FFF", fontWeight: "bold" },
  productCard: {
    flexDirection: "row",
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionAccent: { width: 40, justifyContent: "center", alignItems: "center" },
  productThumb: {
    width: 40,
    alignSelf: "stretch",
    borderTopLeftRadius: 13,
    borderBottomLeftRadius: 13,
  },
  sectionAccentText: { color: "#FFF", fontSize: 14, fontWeight: "bold" },
  productBody: { flex: 1, padding: 14 },
  productTop: { flexDirection: "row", alignItems: "flex-start" },
  productName: { fontSize: 15, fontWeight: "bold" },
  productMeta: { fontSize: 11, marginTop: 3 },
  qtyWrap: { alignItems: "center", marginLeft: 12 },
  qtyValue: { fontSize: 22, fontWeight: "bold" },
  qtyLabel: { fontSize: 10, marginTop: -2 },
  productBottom: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  locationChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
  },
  locationText: { fontSize: 11, fontWeight: "600", marginLeft: 4 },
  noLocationChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
  },
  noLocationText: { fontSize: 11 },
  lowStockChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lowStockText: { fontSize: 10, fontWeight: "600", marginLeft: 4 },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 60,
  },
  emptyCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: "bold" },
  emptySub: { fontSize: 13, marginTop: 4, textAlign: "center" },
  sortExportRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  sortBtnText: { fontSize: 13, fontWeight: "500" },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    marginLeft: "auto",
  },
  exportBtnText: { fontSize: 13, fontWeight: "600" },
  sortMenu: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  sortMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  sortMenuText: { fontSize: 14, marginLeft: 4 },
});
