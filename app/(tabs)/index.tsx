import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ScreenHeader } from "../../lib/Header";
import { getCache, setCache } from "../../lib/cache";
import { useOffline } from "../../lib/offline";
import { OfflineBanner } from "../../lib/offlineUI";
import { usePermissions } from "../../lib/permissions";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { AnimatedCounter, Skeleton, haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

let dashboardCache: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000;

export default function DashboardScreen() {
  const router = useRouter();
  const T = useTheme();
  const wh = useWarehouse();
  const { isOnline } = useOffline();
  const { warehouseId, greeting, userName, warehouseName, warehouseAddress } =
    wh;
  const perms = usePermissions();

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [productCount, setProductCount] = useState(0);
  const [sectionCount, setSectionCount] = useState(0);
  const [totalStock, setTotalStock] = useState(0);
  const [scansToday, setScansToday] = useState(0);
  const [registeredToday, setRegisteredToday] = useState(0);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle("light-content");
      const now = Date.now();
      if (
        dashboardCache &&
        dashboardCache._warehouseId === warehouseId &&
        now - cacheTimestamp < CACHE_TTL &&
        dashboardCache.productCount > 0
      ) {
        applyCachedData(dashboardCache);
        setLoading(false);
      } else {
        loadDashboard(false);
      }
    }, [warehouseId])
  );

  useEffect(() => {
    if (warehouseId) {
      dashboardCache = null;
      if (isOnline) {
        loadDashboard(false);
      } else {
        // Offline — try persistent cache
        getCache<any>("dashboard", warehouseId).then((cached) => {
          if (cached) {
            applyCachedData(cached);
            setLoading(false);
          }
        });
      }
    }
  }, [warehouseId, isOnline]);

  function applyCachedData(c: any) {
    setProductCount(c.productCount);
    setSectionCount(c.sectionCount);
    setTotalStock(c.totalStock);
    setScansToday(c.scansToday);
    setRegisteredToday(c.registeredToday);
    setLowStockItems(c.lowStockItems);
    setRecentActivity(c.recentActivity);
  }

  async function loadDashboard(isRefresh: boolean) {
    if (!warehouseId) return;
    if (!isRefresh) setLoading(true);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [
      { data: whLocations },
      { count: sections },
      { count: todayScans },
      { count: todayRegistered },
      { data: lowStock },
      { data: recent },
    ] = await Promise.all([
      supabase
        .from("locations")
        .select("product_id, quantity")
        .eq("warehouse_id", warehouseId),
      supabase
        .from("sections")
        .select("*", { count: "exact", head: true })
        .eq("warehouse_id", warehouseId),
      supabase
        .from("scan_history")
        .select("*", { count: "exact", head: true })
        .eq("warehouse_id", warehouseId)
        .gte("scanned_at", todayStart.toISOString()),
      supabase
        .from("scan_history")
        .select("*", { count: "exact", head: true })
        .eq("warehouse_id", warehouseId)
        .eq("action", "register")
        .gte("scanned_at", todayStart.toISOString()),
      supabase
        .from("locations")
        .select("quantity, products(id, name, barcode, category)")
        .eq("warehouse_id", warehouseId)
        .lte("quantity", 5)
        .order("quantity", { ascending: true })
        .limit(5),
      supabase
        .from("scan_history")
        .select("*, products(name)")
        .eq("warehouse_id", warehouseId)
        .order("scanned_at", { ascending: false })
        .limit(8),
    ]);
    const locs = whLocations || [];
    const uniqueProducts = new Set(locs.map((l: any) => l.product_id)).size;
    const stock = locs.reduce(
      (sum: number, r: any) => sum + (r.quantity || 0),
      0
    );
    const cached = {
      _warehouseId: warehouseId,
      productCount: uniqueProducts,
      sectionCount: sections || 0,
      totalStock: stock,
      scansToday: todayScans || 0,
      registeredToday: todayRegistered || 0,
      lowStockItems: lowStock || [],
      recentActivity: recent || [],
    };
    dashboardCache = cached;
    cacheTimestamp = Date.now();
    applyCachedData(cached);
    setCache("dashboard", cached, warehouseId!);
    setLoading(false);
    setRefreshing(false);
  }

  async function handleSearch(text: string) {
    setSearch(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (text.trim().length === 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    if (text.trim().length < 2) return;
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      const { data } = await supabase
        .from("products")
        .select(
          "id, name, barcode, category, locations!inner(quantity, bay, level, sections(code))"
        )
        .eq("locations.warehouse_id", warehouseId)
        .or(`name.ilike.%${text.trim()}%,barcode.ilike.%${text.trim()}%`)
        .limit(10);
      setSearchResults(data || []);
      setSearching(false);
    }, 300);
  }

  async function handleExportCSV() {
    haptic.medium();
    const { data } = await supabase
      .from("products")
      .select(
        "name, barcode, category, locations!inner(quantity, bay, level, sections(code))"
      )
      .eq("locations.warehouse_id", warehouseId);
    if (!data || data.length === 0) return;
    let csv = "Name,Barcode,Category,Section,Bay,Level,Quantity\n";
    data.forEach((p: any) => {
      const loc = p.locations?.[0];
      csv += `"${p.name}","${p.barcode}","${p.category}","${
        loc?.sections?.code || ""
      }",${loc?.bay || ""},${loc?.level || ""},${loc?.quantity || 0}\n`;
    });
    await Share.share({ message: csv, title: "Inventory Export" });
  }

  function getQuantity(product: any) {
    return (product.locations || []).reduce(
      (sum: number, loc: any) => sum + (loc.quantity || 0),
      0
    );
  }

  const ACTION_LABELS: Record<string, string> = {
    register: "Registered",
    locate: "Located",
    relocate: "Relocated",
    pick: "Picked",
    receive: "Received",
    return: "Returned",
    cycle_count: "Counted",
    adjust: "Adjusted",
  };
  const ACTION_ICONS: Record<string, string> = {
    register: "plus-circle",
    locate: "search",
    relocate: "arrows",
    pick: "hand-rock-o",
    receive: "truck",
    return: "undo",
    cycle_count: "check-square-o",
    adjust: "sliders",
  };

  return (
    <View style={[s.screen, { backgroundColor: T.background }]}>
      <StatusBar barStyle="light-content" />

      <ScreenHeader
        {...wh}
        contractedStats={
          loading
            ? undefined
            : {
                products: productCount,
                sections: sectionCount,
                stock: totalStock,
              }
        }
        loading={loading}
        onWarehouseSwitch={() => {
          dashboardCache = null;
          loadDashboard(false);
        }}
      />

      <View style={[s.contentWrap, { backgroundColor: T.background }]}>
        <OfflineBanner />
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                haptic.light();
                loadDashboard(true);
              }}
              tintColor={T.primary}
            />
          }
        >
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
              placeholder="Search products..."
              placeholderTextColor={T.textSecondary}
              value={search}
              onChangeText={handleSearch}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearch("");
                  setSearchResults([]);
                }}
              >
                <FontAwesome
                  name="times-circle"
                  size={16}
                  color={T.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>

          {search.length >= 2 && (
            <View style={{ marginBottom: 16 }}>
              {searching ? (
                <Text style={[s.muted, { color: T.textSecondary }]}>
                  Searching...
                </Text>
              ) : searchResults.length === 0 ? (
                <Text style={[s.muted, { color: T.textSecondary }]}>
                  No results for "{search}"
                </Text>
              ) : (
                searchResults.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      s.searchCard,
                      { backgroundColor: T.surface, borderColor: T.border },
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      haptic.light();
                      router.push(`/product/${item.id}`);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.searchName, { color: T.textPrimary }]}>
                        {item.name}
                      </Text>
                      <Text style={[s.searchSub, { color: T.textSecondary }]}>
                        {item.category.replace("_", "/").toUpperCase()}{" "}
                        {"\u2022"} {item.barcode}
                      </Text>
                    </View>
                    <Text style={[s.searchQty, { color: T.textPrimary }]}>
                      {getQuantity(item)}
                    </Text>
                    <FontAwesome
                      name="chevron-right"
                      size={11}
                      color={T.textSecondary}
                      style={{ marginLeft: 8 }}
                    />
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {search.length < 2 && !loading && (
            <>
              <View style={s.bentoGrid}>
                <View style={s.bentoRow}>
                  <View style={s.bentoHalf}>
                    <View
                      style={[
                        s.bentoCard,
                        { backgroundColor: T.surface, borderColor: T.border },
                      ]}
                    >
                      <View
                        style={[
                          s.bentoIcon,
                          { backgroundColor: T.primary + "12" },
                        ]}
                      >
                        <FontAwesome
                          name="barcode"
                          size={14}
                          color={T.primary}
                        />
                      </View>
                      <AnimatedCounter
                        value={scansToday}
                        style={[s.bentoNum, { color: T.textPrimary }]}
                      />
                      <Text style={[s.bentoLabel, { color: T.textSecondary }]}>
                        Scans today
                      </Text>
                    </View>
                  </View>
                  <View style={s.bentoHalf}>
                    <View
                      style={[
                        s.bentoCard,
                        { backgroundColor: T.surface, borderColor: T.border },
                      ]}
                    >
                      <View
                        style={[
                          s.bentoIcon,
                          { backgroundColor: T.secondary + "12" },
                        ]}
                      >
                        <FontAwesome
                          name="plus-circle"
                          size={14}
                          color={T.secondary}
                        />
                      </View>
                      <AnimatedCounter
                        value={registeredToday}
                        style={[s.bentoNum, { color: T.textPrimary }]}
                      />
                      <Text style={[s.bentoLabel, { color: T.textSecondary }]}>
                        Registered
                      </Text>
                    </View>
                  </View>
                </View>

                {lowStockItems.length > 0 && (
                  <View
                    style={[
                      s.bentoCard,
                      {
                        backgroundColor: T.surface,
                        borderColor: T.border,
                        marginBottom: 10,
                      },
                    ]}
                  >
                    <View style={s.bentoCardHeader}>
                      <Text
                        style={[s.bentoCardTitle, { color: T.textPrimary }]}
                      >
                        Low stock
                      </Text>
                      <View
                        style={[
                          s.bentoBadge,
                          { backgroundColor: T.primary + "12" },
                        ]}
                      >
                        <Text style={[s.bentoBadgeText, { color: T.primary }]}>
                          {lowStockItems.length}
                        </Text>
                      </View>
                    </View>
                    <View style={s.lowStockRow}>
                      {lowStockItems.slice(0, 3).map((item, i) => (
                        <TouchableOpacity
                          key={i}
                          style={[
                            s.lowStockChip,
                            {
                              backgroundColor: T.danger + "08",
                              borderColor: T.danger + "15",
                            },
                          ]}
                          activeOpacity={0.7}
                          onPress={() => {
                            if (item.products?.id) {
                              haptic.light();
                              router.push(`/product/${item.products.id}`);
                            }
                          }}
                        >
                          <Text
                            style={[s.lowStockName, { color: T.textPrimary }]}
                            numberOfLines={1}
                          >
                            {item.products?.name || "Unknown"}
                          </Text>
                          <Text style={[s.lowStockQty, { color: T.danger }]}>
                            {item.quantity}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                <Text style={[s.sectionTitle, { color: T.textPrimary }]}>
                  Suggested for you
                </Text>
                <View style={s.bentoRow}>
                  <View style={s.bentoHalf}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => {
                        haptic.light();
                        router.push("/(tabs)/scanner");
                      }}
                    >
                      <View
                        style={[
                          s.bentoCard,
                          {
                            backgroundColor: T.secondary,
                            borderColor: "transparent",
                          },
                        ]}
                      >
                        <FontAwesome
                          name="barcode"
                          size={18}
                          color="rgba(255,255,255,0.6)"
                        />
                        <Text style={s.bentoDarkTitle}>Scan product</Text>
                        <Text style={s.bentoDarkSub}>Register or find</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                  <View style={s.bentoHalf}>
                    {perms.canViewReports ? (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                          haptic.light();
                          router.push("/analytics");
                        }}
                      >
                        <View
                          style={[
                            s.bentoCard,
                            {
                              backgroundColor: T.surface,
                              borderColor: T.border,
                            },
                          ]}
                        >
                          <FontAwesome
                            name="line-chart"
                            size={18}
                            color={T.primary}
                          />
                          <Text
                            style={[
                              s.bentoLightTitle,
                              { color: T.textPrimary },
                            ]}
                          >
                            Analytics
                          </Text>
                          <Text
                            style={[
                              s.bentoLightSub,
                              { color: T.textSecondary },
                            ]}
                          >
                            View reports
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                          haptic.light();
                          router.push("/(tabs)/scanner");
                        }}
                      >
                        <View
                          style={[
                            s.bentoCard,
                            {
                              backgroundColor: T.surface,
                              borderColor: T.border,
                            },
                          ]}
                        >
                          <FontAwesome
                            name="check-square-o"
                            size={18}
                            color={T.primary}
                          />
                          <Text
                            style={[
                              s.bentoLightTitle,
                              { color: T.textPrimary },
                            ]}
                          >
                            Cycle count
                          </Text>
                          <Text
                            style={[
                              s.bentoLightSub,
                              { color: T.textSecondary },
                            ]}
                          >
                            Verify stock
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                {perms.canExportInventory && (
                  <View style={s.bentoRow}>
                    <View style={s.bentoHalf}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={handleExportCSV}
                      >
                        <View
                          style={[
                            s.bentoCard,
                            {
                              backgroundColor: T.surface,
                              borderColor: T.border,
                            },
                          ]}
                        >
                          <FontAwesome
                            name="download"
                            size={18}
                            color={T.secondary}
                          />
                          <Text
                            style={[
                              s.bentoLightTitle,
                              { color: T.textPrimary },
                            ]}
                          >
                            Export CSV
                          </Text>
                          <Text
                            style={[
                              s.bentoLightSub,
                              { color: T.textSecondary },
                            ]}
                          >
                            Share inventory
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                    <View style={s.bentoHalf}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                          haptic.light();
                          router.push("/(tabs)/scanner");
                        }}
                      >
                        <View
                          style={[
                            s.bentoCard,
                            {
                              backgroundColor: T.surface,
                              borderColor: T.border,
                            },
                          ]}
                        >
                          <FontAwesome
                            name="check-square-o"
                            size={18}
                            color={T.primary}
                          />
                          <Text
                            style={[
                              s.bentoLightTitle,
                              { color: T.textPrimary },
                            ]}
                          >
                            Cycle count
                          </Text>
                          <Text
                            style={[
                              s.bentoLightSub,
                              { color: T.textSecondary },
                            ]}
                          >
                            Verify stock
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              <Text style={[s.sectionTitle, { color: T.textPrimary }]}>
                Recent activity
              </Text>
              {recentActivity.length === 0 ? (
                <View
                  style={[
                    s.emptyBox,
                    { backgroundColor: T.surface, borderColor: T.border },
                  ]}
                >
                  <FontAwesome
                    name="clock-o"
                    size={22}
                    color={T.textSecondary}
                  />
                  <Text style={[s.emptyTxt, { color: T.textSecondary }]}>
                    No activity yet
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    s.activityCard,
                    { backgroundColor: T.surface, borderColor: T.border },
                  ]}
                >
                  {recentActivity.map((item, index) => {
                    const time = new Date(item.scanned_at);
                    const timeStr = time.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const dateStr = time.toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    });
                    const isLast = index === recentActivity.length - 1;
                    return (
                      <View key={item.id} style={s.tlItem}>
                        <View style={s.tlTrack}>
                          <View
                            style={[
                              s.tlDot,
                              { backgroundColor: T.primary + "12" },
                            ]}
                          >
                            <FontAwesome
                              name={
                                (ACTION_ICONS[item.action] || "circle") as any
                              }
                              size={9}
                              color={T.primary}
                            />
                          </View>
                          {!isLast && (
                            <View
                              style={[s.tlLine, { backgroundColor: T.border }]}
                            />
                          )}
                        </View>
                        <View
                          style={[s.tlBody, isLast && { paddingBottom: 0 }]}
                        >
                          <Text style={[s.tlAction, { color: T.primary }]}>
                            {ACTION_LABELS[item.action] || item.action}
                          </Text>
                          <Text style={[s.tlProduct, { color: T.textPrimary }]}>
                            {item.products?.name || "Unknown"}
                          </Text>
                          <Text style={[s.tlTime, { color: T.textSecondary }]}>
                            {dateStr} {"\u2022"} {timeStr}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {loading && search.length < 2 && (
            <View>
              <View style={s.bentoRow}>
                {[1, 2].map((i) => (
                  <View
                    key={i}
                    style={[
                      s.bentoHalf,
                      s.bentoCard,
                      { backgroundColor: T.surface, borderColor: T.border },
                    ]}
                  >
                    <Skeleton
                      width={36}
                      height={36}
                      borderRadius={10}
                      style={{ marginBottom: 8 }}
                    />
                    <Skeleton
                      width={28}
                      height={20}
                      style={{ marginBottom: 4 }}
                    />
                    <Skeleton width={60} height={11} />
                  </View>
                ))}
              </View>
            </View>
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
      </View>
    </View>
  );
}

// Only content styles — header styles live in Header.tsx
const s = StyleSheet.create({
  screen: { flex: 1 },
  contentWrap: { flex: 1, marginTop: 16, paddingTop: 4, paddingHorizontal: 16 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  searchInput: { flex: 1, paddingVertical: 13, fontSize: 15 },
  muted: { fontSize: 13, textAlign: "center", paddingVertical: 16 },
  searchCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  searchName: { fontSize: 14, fontWeight: "bold" },
  searchSub: { fontSize: 11, marginTop: 1 },
  searchQty: { fontSize: 18, fontWeight: "bold", marginLeft: 8 },
  bentoGrid: { marginBottom: 8 },
  bentoRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  bentoHalf: { flex: 1 },
  bentoCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  bentoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  bentoNum: { fontSize: 28, fontWeight: "bold" },
  bentoLabel: { fontSize: 11, marginTop: 2 },
  bentoCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  bentoCardTitle: { fontSize: 14, fontWeight: "bold" },
  bentoBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  bentoBadgeText: { fontSize: 12, fontWeight: "bold" },
  lowStockRow: { flexDirection: "row", gap: 8 },
  lowStockChip: { flex: 1, borderRadius: 10, padding: 10, borderWidth: 1 },
  lowStockName: { fontSize: 11, fontWeight: "600", marginBottom: 4 },
  lowStockQty: { fontSize: 20, fontWeight: "bold" },
  bentoDarkTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFF",
    marginTop: 10,
  },
  bentoDarkSub: { fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 },
  bentoLightTitle: { fontSize: 14, fontWeight: "600", marginTop: 10 },
  bentoLightSub: { fontSize: 11, marginTop: 2 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 10,
    marginTop: 6,
    marginLeft: 2,
  },
  activityCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  tlItem: { flexDirection: "row", minHeight: 56 },
  tlTrack: { width: 28, alignItems: "center" },
  tlDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  tlLine: { flex: 1, width: 1, marginTop: -1 },
  tlBody: { flex: 1, paddingLeft: 12, paddingBottom: 18 },
  tlAction: {
    fontSize: 11,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tlProduct: { fontSize: 14, fontWeight: "500", marginTop: 2 },
  tlTime: { fontSize: 11, marginTop: 2 },
  emptyBox: {
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    marginBottom: 16,
  },
  emptyTxt: { fontSize: 13, marginTop: 10 },
});
