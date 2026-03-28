import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { AnimatedCounter, Skeleton, haptic } from "../lib/ui";
import { useWarehouse } from "../lib/warehouse";

const STATUS_BAR = Platform.OS === "ios" ? 54 : 36;
const HEADER_FULL = 280;
const HEADER_COMPACT = STATUS_BAR + 64;
const SCROLL_RANGE = 100;

type Tab = "overview" | "inventory" | "activity" | "operations";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "dashboard" },
  { key: "inventory", label: "Inventory", icon: "cubes" },
  { key: "activity", label: "Activity", icon: "bolt" },
  { key: "operations", label: "Operations", icon: "truck" },
];

const CATEGORY_LABELS: Record<string, string> = {
  hardwood: "Hardwood",
  laminate: "Laminate",
  vinyl_lvp: "Vinyl/LVP",
  tile: "Tile",
  carpet: "Carpet",
  underlayment: "Underlay",
  adhesive: "Adhesive",
  trim_molding: "Trim",
  tools: "Tools",
  accessories: "Accessories",
  other: "Other",
};
const ACTION_CONFIG: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  register: { label: "Registered", color: "#22C55E", icon: "plus-circle" },
  locate: { label: "Located", color: "#1565C0", icon: "search" },
  relocate: { label: "Relocated", color: "#F57C00", icon: "arrows" },
  pick: { label: "Picked", color: "#6A1B9A", icon: "hand-rock-o" },
  receive: { label: "Received", color: "#00838F", icon: "truck" },
  return: { label: "Returned", color: "#D32F2F", icon: "undo" },
  cycle_count: { label: "Counted", color: "#4E342E", icon: "check-square-o" },
  adjust: { label: "Adjusted", color: "#37474F", icon: "sliders" },
};

export default function AnalyticsScreen() {
  const T = useTheme();
  const router = useRouter();
  const { warehouseId, warehouseName } = useWarehouse();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Overview
  const [stats, setStats] = useState({
    products: 0,
    stock: 0,
    scans: 0,
    scansToday: 0,
    sections: 0,
    lowStock: 0,
  });
  const [categoryBreakdown, setCategoryBreakdown] = useState<
    { category: string; count: number }[]
  >([]);
  const [sectionStock, setSectionStock] = useState<
    {
      code: string;
      name: string;
      color: string;
      quantity: number;
      capacity: number;
    }[]
  >([]);
  const [actionBreakdown, setActionBreakdown] = useState<
    { action: string; count: number }[]
  >([]);

  // Inventory
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [reorderItems, setReorderItems] = useState<any[]>([]);

  // Activity
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [dailyActivity, setDailyActivity] = useState<
    { date: string; count: number }[]
  >([]);
  const [staffActivity, setStaffActivity] = useState<
    { name: string; count: number }[]
  >([]);

  // Operations
  const [ordersByStatus, setOrdersByStatus] = useState<
    { status: string; count: number }[]
  >([]);
  const [posByStatus, setPosByStatus] = useState<
    { status: string; count: number }[]
  >([]);
  const [returnStats, setReturnStats] = useState<{
    total: number;
    byDisposition: { disposition: string; count: number }[];
  }>({ total: 0, byDisposition: [] });

  useEffect(() => {
    if (warehouseId) loadAll();
  }, [warehouseId]);

  async function loadAll() {
    if (!warehouseId) return;
    if (!refreshing) setLoading(true);
    await Promise.all([
      loadOverview(),
      loadInventory(),
      loadActivity(),
      loadOperations(),
    ]);
    setLoading(false);
    setRefreshing(false);
  }

  async function loadOverview() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [
      { data: locs },
      { count: sectionCount },
      { count: totalScans },
      { count: scansToday },
      { data: scanActions },
      { data: sectionData },
    ] = await Promise.all([
      supabase
        .from("locations")
        .select("product_id, quantity, products(category)")
        .eq("warehouse_id", warehouseId),
      supabase
        .from("sections")
        .select("*", { count: "exact", head: true })
        .eq("warehouse_id", warehouseId),
      supabase
        .from("scan_history")
        .select("*", { count: "exact", head: true })
        .eq("warehouse_id", warehouseId),
      supabase
        .from("scan_history")
        .select("*", { count: "exact", head: true })
        .eq("warehouse_id", warehouseId)
        .gte("scanned_at", todayStart.toISOString()),
      supabase
        .from("scan_history")
        .select("action")
        .eq("warehouse_id", warehouseId),
      supabase
        .from("sections")
        .select("id, code, name, color, total_bays, total_levels")
        .eq("warehouse_id", warehouseId),
    ]);
    const allLocs = locs || [];
    const uniqueProducts = new Set(allLocs.map((l: any) => l.product_id)).size;
    const totalStock = allLocs.reduce(
      (sum: number, l: any) => sum + (l.quantity || 0),
      0
    );
    const lowCount = allLocs.filter(
      (l: any) => l.quantity <= 5 && l.quantity > 0
    ).length;

    setStats({
      products: uniqueProducts,
      stock: totalStock,
      scans: totalScans || 0,
      scansToday: scansToday || 0,
      sections: sectionCount || 0,
      lowStock: lowCount,
    });

    // Category breakdown
    const catMap: Record<string, number> = {};
    allLocs.forEach((l: any) => {
      const c = l.products?.category || "other";
      catMap[c] = (catMap[c] || 0) + 1;
    });
    setCategoryBreakdown(
      Object.entries(catMap)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
    );

    // Section stock with capacity
    const secMap: Record<string, any> = {};
    allLocs.forEach((l: any) => {
      // We'll match by section from sectionData
    });
    const sections = sectionData || [];
    const secStockMap: Record<
      string,
      {
        code: string;
        name: string;
        color: string;
        quantity: number;
        capacity: number;
      }
    > = {};
    sections.forEach((sec: any) => {
      secStockMap[sec.id] = {
        code: sec.code,
        name: sec.name,
        color: sec.color || "#999",
        quantity: 0,
        capacity: sec.total_bays * sec.total_levels,
      };
    });
    // Get location counts by section
    const { data: locBySec } = await supabase
      .from("locations")
      .select("section_id, quantity")
      .eq("warehouse_id", warehouseId);
    (locBySec || []).forEach((loc: any) => {
      if (secStockMap[loc.section_id])
        secStockMap[loc.section_id].quantity += loc.quantity || 0;
    });
    setSectionStock(
      Object.values(secStockMap).sort((a, b) => b.quantity - a.quantity)
    );

    // Action breakdown
    const actMap: Record<string, number> = {};
    (scanActions || []).forEach((sc: any) => {
      actMap[sc.action] = (actMap[sc.action] || 0) + 1;
    });
    setActionBreakdown(
      Object.entries(actMap)
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
    );
  }

  async function loadInventory() {
    const [{ data: lowStock }, { data: reorder }] = await Promise.all([
      supabase
        .from("locations")
        .select(
          "quantity, products(id, name, barcode, category, reorder_point)"
        )
        .eq("warehouse_id", warehouseId)
        .lte("quantity", 5)
        .gt("quantity", 0)
        .order("quantity", { ascending: true })
        .limit(20),
      supabase
        .from("locations")
        .select("quantity, products!inner(id, name, barcode, reorder_point)")
        .eq("warehouse_id", warehouseId),
    ]);
    setLowStockItems(lowStock || []);
    // Filter reorder: quantity <= reorder_point
    const reorderFiltered = (reorder || []).filter(
      (loc: any) =>
        loc.products?.reorder_point &&
        loc.quantity <= loc.products.reorder_point
    );
    setReorderItems(reorderFiltered);
  }

  async function loadActivity() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const [{ data: recent }, { data: dailyScans }, { data: staffScans }] =
      await Promise.all([
        supabase
          .from("scan_history")
          .select("*, products(name), profiles:scanned_by(full_name)")
          .eq("warehouse_id", warehouseId)
          .order("scanned_at", { ascending: false })
          .limit(25),
        supabase
          .from("scan_history")
          .select("scanned_at")
          .eq("warehouse_id", warehouseId)
          .gte("scanned_at", sevenDaysAgo.toISOString()),
        supabase
          .from("scan_history")
          .select("scanned_by, profiles:scanned_by(full_name)")
          .eq("warehouse_id", warehouseId),
      ]);
    setRecentActivity(recent || []);

    // Daily activity for last 7 days
    const dayMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayMap[d.toLocaleDateString([], { weekday: "short" })] = 0;
    }
    (dailyScans || []).forEach((s: any) => {
      const day = new Date(s.scanned_at).toLocaleDateString([], {
        weekday: "short",
      });
      if (dayMap[day] !== undefined) dayMap[day]++;
    });
    setDailyActivity(
      Object.entries(dayMap).map(([date, count]) => ({ date, count }))
    );

    // Staff productivity
    const staffMap: Record<string, { name: string; count: number }> = {};
    (staffScans || []).forEach((s: any) => {
      const id = s.scanned_by || "unknown";
      if (!staffMap[id])
        staffMap[id] = {
          name: (s.profiles as any)?.full_name || "Unknown",
          count: 0,
        };
      staffMap[id].count++;
    });
    setStaffActivity(Object.values(staffMap).sort((a, b) => b.count - a.count));
  }

  async function loadOperations() {
    const [{ data: orders }, { data: pos }, { data: returns }] =
      await Promise.all([
        supabase
          .from("orders")
          .select("status")
          .eq("warehouse_id", warehouseId),
        supabase
          .from("purchase_orders")
          .select("status")
          .eq("warehouse_id", warehouseId),
        supabase
          .from("returns")
          .select("disposition")
          .eq("warehouse_id", warehouseId),
      ]);
    // Orders by status
    const orderMap: Record<string, number> = {};
    (orders || []).forEach((o: any) => {
      orderMap[o.status] = (orderMap[o.status] || 0) + 1;
    });
    setOrdersByStatus(
      Object.entries(orderMap)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count)
    );

    // POs by status
    const poMap: Record<string, number> = {};
    (pos || []).forEach((p: any) => {
      poMap[p.status] = (poMap[p.status] || 0) + 1;
    });
    setPosByStatus(
      Object.entries(poMap)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count)
    );

    // Returns
    const retMap: Record<string, number> = {};
    (returns || []).forEach((r: any) => {
      retMap[r.disposition] = (retMap[r.disposition] || 0) + 1;
    });
    setReturnStats({
      total: (returns || []).length,
      byDisposition: Object.entries(retMap)
        .map(([disposition, count]) => ({ disposition, count }))
        .sort((a, b) => b.count - a.count),
    });
  }

  const totalActions = actionBreakdown.reduce((sum, a) => sum + a.count, 0);
  const maxDailyCount = Math.max(...dailyActivity.map((d) => d.count), 1);

  // Header animations
  const headerHeight = scrollY.interpolate({
    inputRange: [0, SCROLL_RANGE],
    outputRange: [HEADER_FULL, HEADER_COMPACT],
    extrapolate: "clamp",
  });
  const detailsOpacity = scrollY.interpolate({
    inputRange: [0, SCROLL_RANGE * 0.3],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const statsOpacity = scrollY.interpolate({
    inputRange: [0, SCROLL_RANGE * 0.5],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const nameFontSize = scrollY.interpolate({
    inputRange: [0, SCROLL_RANGE],
    outputRange: [24, 17],
    extrapolate: "clamp",
  });

  return (
    <View style={[s.screen, { backgroundColor: T.background }]}>
      <Animated.View style={[s.headerWrap, { height: headerHeight }]}>
        <LinearGradient
          colors={T.headerGradient}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={s.headerGradient}
        >
          <View style={s.headerTop}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <FontAwesome name="arrow-left" size={16} color="#FFF" />
            </TouchableOpacity>
            <Animated.Text style={[s.headerTitle, { fontSize: nameFontSize }]}>
              Reports
            </Animated.Text>
            <View style={{ width: 36 }} />
          </View>
          <Animated.View style={{ opacity: detailsOpacity }}>
            <Text style={s.headerSub}>{warehouseName}</Text>
          </Animated.View>
          {!loading && (
            <Animated.View style={{ opacity: statsOpacity }}>
              <View style={s.statGrid}>
                <StatCard icon="cube" label="Products" value={stats.products} />
                <StatCard icon="archive" label="Stock" value={stats.stock} />
                <StatCard icon="bolt" label="Today" value={stats.scansToday} />
                <StatCard
                  icon="exclamation-triangle"
                  label="Low"
                  value={stats.lowStock}
                />
              </View>
            </Animated.View>
          )}
        </LinearGradient>
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: HEADER_FULL, paddingBottom: 120 }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              haptic.light();
              loadAll();
            }}
            tintColor="#FFF"
          />
        }
      >
        <View style={s.body}>
          {/* Tab bar */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.tabBar}
            contentContainerStyle={{ paddingRight: 20 }}
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={s.tab}
                  onPress={() => {
                    setActiveTab(tab.key);
                    haptic.selection();
                  }}
                  activeOpacity={0.7}
                >
                  {active ? (
                    <LinearGradient
                      colors={T.headerGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={s.tabActive}
                    >
                      <FontAwesome
                        name={tab.icon as any}
                        size={11}
                        color="#FFF"
                        style={{ marginRight: 5 }}
                      />
                      <Text style={s.tabTextActive}>{tab.label}</Text>
                    </LinearGradient>
                  ) : (
                    <View
                      style={[
                        s.tabInactive,
                        { backgroundColor: T.surface, borderColor: T.border },
                      ]}
                    >
                      <Text style={[s.tabText, { color: T.textSecondary }]}>
                        {tab.label}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {loading ? (
            <View style={{ paddingTop: 8 }}>
              {[1, 2, 3].map((i) => (
                <Skeleton
                  key={i}
                  width="100%"
                  height={80}
                  borderRadius={14}
                  style={{ marginBottom: 12 }}
                />
              ))}
            </View>
          ) : activeTab === "overview" ? (
            <OverviewTab
              T={T}
              categoryBreakdown={categoryBreakdown}
              sectionStock={sectionStock}
              actionBreakdown={actionBreakdown}
              totalActions={totalActions}
              stats={stats}
            />
          ) : activeTab === "inventory" ? (
            <InventoryTab
              T={T}
              lowStockItems={lowStockItems}
              reorderItems={reorderItems}
              sectionStock={sectionStock}
              router={router}
            />
          ) : activeTab === "activity" ? (
            <ActivityTab
              T={T}
              recentActivity={recentActivity}
              dailyActivity={dailyActivity}
              staffActivity={staffActivity}
              maxDailyCount={maxDailyCount}
              router={router}
            />
          ) : (
            <OperationsTab
              T={T}
              ordersByStatus={ordersByStatus}
              posByStatus={posByStatus}
              returnStats={returnStats}
            />
          )}
        </View>
      </Animated.ScrollView>
    </View>
  );
}

// ============================================================
// OVERVIEW TAB
// ============================================================
function OverviewTab({
  T,
  categoryBreakdown,
  sectionStock,
  actionBreakdown,
  totalActions,
  stats,
}: any) {
  const maxCat = Math.max(...categoryBreakdown.map((c: any) => c.count), 1);
  return (
    <>
      <SectionTitle T={T}>Stock by category</SectionTitle>
      <Card T={T}>
        {categoryBreakdown.length === 0 ? (
          <EmptyText T={T}>No product data yet</EmptyText>
        ) : (
          categoryBreakdown.map((item: any, i: number) => (
            <BarRow
              key={item.category}
              label={CATEGORY_LABELS[item.category] || item.category}
              value={item.count}
              max={maxCat}
              color={T.primary}
              T={T}
            />
          ))
        )}
      </Card>

      <SectionTitle T={T}>Stock by section</SectionTitle>
      <Card T={T}>
        {sectionStock.length === 0 ? (
          <EmptyText T={T}>No sections yet</EmptyText>
        ) : (
          sectionStock.map((sec: any) => (
            <View key={sec.code} style={s.sectionRow}>
              <View style={[s.sectionDot, { backgroundColor: sec.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[s.sectionCode, { color: T.textPrimary }]}>
                  {sec.code} {"\u2014"} {sec.name}
                </Text>
                <View style={s.fillBarBg}>
                  <View
                    style={[
                      s.fillBarFill,
                      {
                        backgroundColor: sec.color,
                        width:
                          sec.capacity > 0
                            ? `${Math.min(
                                100,
                                Math.round((sec.quantity / sec.capacity) * 100)
                              )}%`
                            : "0%",
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[s.sectionQty, { color: T.textPrimary }]}>
                  {sec.quantity}
                </Text>
                <Text style={[s.sectionCap, { color: T.textSecondary }]}>
                  {sec.capacity} slots
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>

      {actionBreakdown.length > 0 && (
        <>
          <SectionTitle T={T}>Activity breakdown</SectionTitle>
          <Card T={T}>
            <View style={s.proportionBar}>
              {actionBreakdown.map((item: any) => {
                const cfg = ACTION_CONFIG[item.action] || { color: "#999" };
                const pct =
                  totalActions > 0 ? (item.count / totalActions) * 100 : 0;
                return (
                  <View
                    key={item.action}
                    style={[
                      s.proportionSeg,
                      { width: `${pct}%`, backgroundColor: cfg.color },
                    ]}
                  />
                );
              })}
            </View>
            {actionBreakdown.map((item: any) => {
              const cfg = ACTION_CONFIG[item.action] || {
                label: item.action,
                color: "#999",
                icon: "circle",
              };
              const pct =
                totalActions > 0
                  ? Math.round((item.count / totalActions) * 100)
                  : 0;
              return (
                <View
                  key={item.action}
                  style={[s.breakdownRow, { borderBottomColor: T.border }]}
                >
                  <View
                    style={[s.breakdownDot, { backgroundColor: cfg.color }]}
                  >
                    <FontAwesome name={cfg.icon as any} size={8} color="#FFF" />
                  </View>
                  <Text style={[s.breakdownLabel, { color: T.textPrimary }]}>
                    {cfg.label}
                  </Text>
                  <Text style={[s.breakdownCount, { color: T.textPrimary }]}>
                    {item.count}
                  </Text>
                  <Text style={[s.breakdownPct, { color: T.textSecondary }]}>
                    {pct}%
                  </Text>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </>
  );
}

// ============================================================
// INVENTORY TAB
// ============================================================
function InventoryTab({
  T,
  lowStockItems,
  reorderItems,
  sectionStock,
  router,
}: any) {
  return (
    <>
      <SectionTitle T={T}>
        Low stock alerts ({lowStockItems.length})
      </SectionTitle>
      {lowStockItems.length === 0 ? (
        <Card T={T}>
          <EmptyText T={T}>All stock levels healthy</EmptyText>
        </Card>
      ) : (
        <Card T={T}>
          {lowStockItems.map((item: any, i: number) => (
            <TouchableOpacity
              key={i}
              style={[
                s.listRow,
                i < lowStockItems.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: T.border,
                },
              ]}
              onPress={() => {
                if (item.products?.id) {
                  haptic.light();
                  router.push(`/product/${item.products.id}`);
                }
              }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  s.alertDot,
                  {
                    backgroundColor: item.quantity <= 2 ? T.danger : T.warning,
                  },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[s.listTitle, { color: T.textPrimary }]}
                  numberOfLines={1}
                >
                  {item.products?.name || "Unknown"}
                </Text>
                <Text style={[s.listSub, { color: T.textSecondary }]}>
                  {item.products?.category?.replace("_", "/").toUpperCase()}{" "}
                  {"\u2022"} {item.products?.barcode}
                </Text>
              </View>
              <View
                style={[
                  s.qtyBadge,
                  {
                    backgroundColor:
                      item.quantity <= 2 ? T.danger + "12" : T.warning + "12",
                  },
                ]}
              >
                <Text
                  style={[
                    s.qtyBadgeText,
                    { color: item.quantity <= 2 ? T.danger : T.warning },
                  ]}
                >
                  {item.quantity}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </Card>
      )}

      <SectionTitle T={T}>Reorder needed ({reorderItems.length})</SectionTitle>
      {reorderItems.length === 0 ? (
        <Card T={T}>
          <EmptyText T={T}>No products below reorder point</EmptyText>
        </Card>
      ) : (
        <Card T={T}>
          {reorderItems.map((item: any, i: number) => (
            <TouchableOpacity
              key={i}
              style={[
                s.listRow,
                i < reorderItems.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: T.border,
                },
              ]}
              onPress={() => {
                if (item.products?.id) {
                  haptic.light();
                  router.push(`/product/${item.products.id}`);
                }
              }}
              activeOpacity={0.7}
            >
              <FontAwesome
                name="exclamation-circle"
                size={14}
                color={T.danger}
                style={{ marginRight: 12 }}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[s.listTitle, { color: T.textPrimary }]}
                  numberOfLines={1}
                >
                  {item.products?.name}
                </Text>
                <Text style={[s.listSub, { color: T.textSecondary }]}>
                  Current: {item.quantity} {"\u2022"} Reorder at:{" "}
                  {item.products?.reorder_point}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </Card>
      )}

      <SectionTitle T={T}>Section fill rate</SectionTitle>
      {sectionStock.length === 0 ? (
        <Card T={T}>
          <EmptyText T={T}>No sections</EmptyText>
        </Card>
      ) : (
        <Card T={T}>
          {sectionStock.map((sec: any, i: number) => {
            const occupied = Math.min(sec.quantity, sec.capacity);
            const pct =
              sec.capacity > 0
                ? Math.round((occupied / sec.capacity) * 100)
                : 0;
            return (
              <View
                key={sec.code}
                style={[
                  s.listRow,
                  i < sectionStock.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: T.border,
                  },
                ]}
              >
                <View style={[s.sectionDot, { backgroundColor: sec.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.listTitle, { color: T.textPrimary }]}>
                    {sec.code} {"\u2014"} {sec.name}
                  </Text>
                  <View style={[s.fillBarBg, { marginTop: 6 }]}>
                    <View
                      style={[
                        s.fillBarFill,
                        {
                          backgroundColor:
                            pct > 85
                              ? T.danger
                              : pct > 60
                              ? T.warning
                              : sec.color,
                          width: `${pct}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text
                  style={[
                    s.fillPct,
                    { color: pct > 85 ? T.danger : T.textPrimary },
                  ]}
                >
                  {pct}%
                </Text>
              </View>
            );
          })}
        </Card>
      )}
    </>
  );
}

// ============================================================
// ACTIVITY TAB
// ============================================================
function ActivityTab({
  T,
  recentActivity,
  dailyActivity,
  staffActivity,
  maxDailyCount,
  router,
}: any) {
  return (
    <>
      <SectionTitle T={T}>Last 7 days</SectionTitle>
      <Card T={T}>
        {dailyActivity.length === 0 ? (
          <EmptyText T={T}>No activity data</EmptyText>
        ) : (
          <View style={s.chartArea}>
            {dailyActivity.map((day: any) => (
              <View key={day.date} style={s.chartCol}>
                <View style={s.chartBarWrap}>
                  <View
                    style={[
                      s.chartBar,
                      {
                        backgroundColor: T.primary,
                        height:
                          maxDailyCount > 0
                            ? `${Math.max(
                                4,
                                (day.count / maxDailyCount) * 100
                              )}%`
                            : "4%",
                      },
                    ]}
                  />
                </View>
                <Text style={[s.chartLabel, { color: T.textSecondary }]}>
                  {day.date}
                </Text>
                <Text style={[s.chartValue, { color: T.textPrimary }]}>
                  {day.count}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <SectionTitle T={T}>Staff productivity</SectionTitle>
      {staffActivity.length === 0 ? (
        <Card T={T}>
          <EmptyText T={T}>No staff data</EmptyText>
        </Card>
      ) : (
        <Card T={T}>
          {staffActivity.map((staff: any, i: number) => {
            const maxStaff = staffActivity[0]?.count || 1;
            return (
              <View
                key={i}
                style={[
                  s.listRow,
                  i < staffActivity.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: T.border,
                  },
                ]}
              >
                <View
                  style={[s.staffAvatar, { backgroundColor: T.primary + "12" }]}
                >
                  <FontAwesome name="user" size={12} color={T.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.listTitle, { color: T.textPrimary }]}>
                    {staff.name}
                  </Text>
                  <View style={[s.fillBarBg, { marginTop: 4 }]}>
                    <View
                      style={[
                        s.fillBarFill,
                        {
                          backgroundColor: T.primary,
                          width: `${(staff.count / maxStaff) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text style={[s.staffCount, { color: T.textPrimary }]}>
                  {staff.count}
                </Text>
              </View>
            );
          })}
        </Card>
      )}

      <SectionTitle T={T}>Audit trail</SectionTitle>
      {recentActivity.length === 0 ? (
        <Card T={T}>
          <EmptyText T={T}>No activity</EmptyText>
        </Card>
      ) : (
        <Card T={T}>
          {recentActivity.map((item: any, index: number) => {
            const cfg = ACTION_CONFIG[item.action] || {
              label: item.action,
              color: "#999",
              icon: "circle",
            };
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
              <View key={item.id} style={s.auditRow}>
                <View style={s.auditTrack}>
                  <View style={[s.auditDot, { backgroundColor: cfg.color }]}>
                    <FontAwesome name={cfg.icon as any} size={8} color="#FFF" />
                  </View>
                  {!isLast && (
                    <View
                      style={[s.auditLine, { backgroundColor: T.border }]}
                    />
                  )}
                </View>
                <TouchableOpacity
                  style={[s.auditBody, isLast && { paddingBottom: 0 }]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (item.product_id) {
                      haptic.light();
                      router.push(`/product/${item.product_id}`);
                    }
                  }}
                >
                  <Text style={[s.auditProduct, { color: T.textPrimary }]}>
                    {item.products?.name || "Unknown"}
                  </Text>
                  <View style={s.auditMeta}>
                    <View
                      style={[
                        s.auditChip,
                        { backgroundColor: cfg.color + "15" },
                      ]}
                    >
                      <Text style={[s.auditChipText, { color: cfg.color }]}>
                        {cfg.label}
                      </Text>
                    </View>
                    <Text style={[s.auditUser, { color: T.textSecondary }]}>
                      {(item.profiles as any)?.full_name || ""}
                    </Text>
                  </View>
                  <Text style={[s.auditTime, { color: T.textSecondary }]}>
                    {dateStr} {"\u2022"} {timeStr}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </Card>
      )}
    </>
  );
}

// ============================================================
// OPERATIONS TAB
// ============================================================
function OperationsTab({ T, ordersByStatus, posByStatus, returnStats }: any) {
  const STATUS_COLORS: Record<string, string> = {
    created: "#64748B",
    pending: "#F59E0B",
    assigned: "#3B82F6",
    in_progress: "#8B5CF6",
    picked: "#6366F1",
    packed: "#0EA5E9",
    shipped: "#22C55E",
    delivered: "#16A34A",
    cancelled: "#EF4444",
    draft: "#94A3B8",
    submitted: "#3B82F6",
    partial: "#F59E0B",
    received: "#22C55E",
    closed: "#64748B",
    restock: "#22C55E",
    discount: "#F59E0B",
    dispose: "#EF4444",
    return_to_supplier: "#3B82F6",
  };

  const totalOrders = ordersByStatus.reduce(
    (s: number, o: any) => s + o.count,
    0
  );
  const totalPOs = posByStatus.reduce((s: number, p: any) => s + p.count, 0);

  return (
    <>
      <SectionTitle T={T}>Orders ({totalOrders})</SectionTitle>
      {ordersByStatus.length === 0 ? (
        <Card T={T}>
          <EmptyText T={T}>No orders yet</EmptyText>
        </Card>
      ) : (
        <Card T={T}>
          {ordersByStatus.map((item: any, i: number) => (
            <View
              key={item.status}
              style={[
                s.listRow,
                i < ordersByStatus.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: T.border,
                },
              ]}
            >
              <View
                style={[
                  s.statusDot,
                  { backgroundColor: STATUS_COLORS[item.status] || "#999" },
                ]}
              />
              <Text
                style={[
                  s.listTitle,
                  {
                    color: T.textPrimary,
                    flex: 1,
                    textTransform: "capitalize",
                  },
                ]}
              >
                {item.status.replace(/_/g, " ")}
              </Text>
              <Text style={[s.breakdownCount, { color: T.textPrimary }]}>
                {item.count}
              </Text>
              <Text style={[s.breakdownPct, { color: T.textSecondary }]}>
                {totalOrders > 0
                  ? Math.round((item.count / totalOrders) * 100)
                  : 0}
                %
              </Text>
            </View>
          ))}
        </Card>
      )}

      <SectionTitle T={T}>Purchase orders ({totalPOs})</SectionTitle>
      {posByStatus.length === 0 ? (
        <Card T={T}>
          <EmptyText T={T}>No purchase orders yet</EmptyText>
        </Card>
      ) : (
        <Card T={T}>
          {posByStatus.map((item: any, i: number) => (
            <View
              key={item.status}
              style={[
                s.listRow,
                i < posByStatus.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: T.border,
                },
              ]}
            >
              <View
                style={[
                  s.statusDot,
                  { backgroundColor: STATUS_COLORS[item.status] || "#999" },
                ]}
              />
              <Text
                style={[
                  s.listTitle,
                  {
                    color: T.textPrimary,
                    flex: 1,
                    textTransform: "capitalize",
                  },
                ]}
              >
                {item.status.replace(/_/g, " ")}
              </Text>
              <Text style={[s.breakdownCount, { color: T.textPrimary }]}>
                {item.count}
              </Text>
              <Text style={[s.breakdownPct, { color: T.textSecondary }]}>
                {totalPOs > 0 ? Math.round((item.count / totalPOs) * 100) : 0}%
              </Text>
            </View>
          ))}
        </Card>
      )}

      <SectionTitle T={T}>Returns ({returnStats.total})</SectionTitle>
      {returnStats.total === 0 ? (
        <Card T={T}>
          <EmptyText T={T}>No returns recorded</EmptyText>
        </Card>
      ) : (
        <Card T={T}>
          {returnStats.byDisposition.map((item: any, i: number) => (
            <View
              key={item.disposition}
              style={[
                s.listRow,
                i < returnStats.byDisposition.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: T.border,
                },
              ]}
            >
              <View
                style={[
                  s.statusDot,
                  {
                    backgroundColor: STATUS_COLORS[item.disposition] || "#999",
                  },
                ]}
              />
              <Text
                style={[
                  s.listTitle,
                  {
                    color: T.textPrimary,
                    flex: 1,
                    textTransform: "capitalize",
                  },
                ]}
              >
                {item.disposition.replace(/_/g, " ")}
              </Text>
              <Text style={[s.breakdownCount, { color: T.textPrimary }]}>
                {item.count}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

// ============================================================
// SHARED COMPONENTS
// ============================================================
function Card({ T, children }: { T: any; children: React.ReactNode }) {
  return (
    <View
      style={[s.card, { backgroundColor: T.surface, borderColor: T.border }]}
    >
      {children}
    </View>
  );
}
function SectionTitle({ T, children }: { T: any; children: React.ReactNode }) {
  return (
    <Text style={[s.sectionLabel, { color: T.textPrimary }]}>{children}</Text>
  );
}
function EmptyText({ T, children }: { T: any; children: React.ReactNode }) {
  return (
    <Text style={[s.emptyText, { color: T.textSecondary }]}>{children}</Text>
  );
}
function StatCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number;
}) {
  return (
    <View style={s.statCard}>
      <FontAwesome name={icon as any} size={14} color="rgba(255,255,255,0.7)" />
      <AnimatedCounter value={value} style={s.statValue} />
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}
function BarRow({
  label,
  value,
  max,
  color,
  T,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  T: any;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={s.barRow}>
      <Text style={[s.barLabel, { color: T.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[s.barBg, { backgroundColor: T.border }]}>
        <View
          style={[s.barFill, { backgroundColor: color, width: `${pct}%` }]}
        />
      </View>
      <Text style={[s.barValue, { color: T.textPrimary }]}>{value}</Text>
    </View>
  );
}

// ============================================================
// STYLES
// ============================================================
const s = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  headerGradient: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: STATUS_BAR,
    marginBottom: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontWeight: "bold", color: "#FFF" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 10 },
  statGrid: { flexDirection: "row", gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  statValue: { fontSize: 20, fontWeight: "bold", color: "#FFF", marginTop: 4 },
  statLabel: { fontSize: 9, color: "rgba(255,255,255,0.5)", marginTop: 2 },
  body: { paddingHorizontal: 20, paddingTop: 12 },
  tabBar: { maxHeight: 40, marginBottom: 16 },
  tab: { marginRight: 8 },
  tabActive: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
  },
  tabTextActive: { fontSize: 13, color: "#FFF", fontWeight: "600" },
  tabInactive: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  tabText: { fontSize: 13 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 8,
    marginLeft: 2,
    marginTop: 4,
  },
  emptyText: { fontSize: 13, textAlign: "center", paddingVertical: 12 },

  // Bar chart rows
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  barLabel: { width: 70, fontSize: 12, marginRight: 8 },
  barBg: { flex: 1, height: 20, borderRadius: 10, overflow: "hidden" },
  barFill: { height: 20, borderRadius: 10 },
  barValue: {
    width: 32,
    textAlign: "right",
    fontSize: 14,
    fontWeight: "bold",
    marginLeft: 8,
  },

  // Section stock rows
  sectionRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  sectionDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  sectionCode: { fontSize: 13, fontWeight: "600", marginBottom: 4 },
  sectionQty: { fontSize: 16, fontWeight: "bold" },
  sectionCap: { fontSize: 10, marginTop: 1 },
  fillBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(0,0,0,0.06)",
    overflow: "hidden",
  },
  fillBarFill: { height: 6, borderRadius: 3 },
  fillPct: {
    fontSize: 15,
    fontWeight: "bold",
    marginLeft: 12,
    width: 40,
    textAlign: "right",
  },

  // Proportion bar
  proportionBar: {
    flexDirection: "row",
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    marginBottom: 16,
  },
  proportionSeg: { height: 10 },

  // Breakdown rows
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  breakdownDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  breakdownLabel: { fontSize: 14, flex: 1 },
  breakdownCount: { fontSize: 15, fontWeight: "bold", marginRight: 8 },
  breakdownPct: { fontSize: 12, width: 32 },

  // List rows
  listRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  listTitle: { fontSize: 14, fontWeight: "600" },
  listSub: { fontSize: 11, marginTop: 2 },
  alertDot: { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  qtyBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  qtyBadgeText: { fontSize: 16, fontWeight: "bold" },

  // Daily chart
  chartArea: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
  },
  chartCol: { alignItems: "center", flex: 1 },
  chartBarWrap: {
    height: 100,
    width: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.04)",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  chartBar: { width: 24, borderRadius: 12, minHeight: 4 },
  chartLabel: { fontSize: 10, marginTop: 6 },
  chartValue: { fontSize: 12, fontWeight: "bold", marginTop: 2 },

  // Staff
  staffAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  staffCount: { fontSize: 16, fontWeight: "bold", marginLeft: 12 },

  // Audit trail
  auditRow: { flexDirection: "row", minHeight: 56 },
  auditTrack: { width: 28, alignItems: "center" },
  auditDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  auditLine: { flex: 1, width: 1, marginTop: -1 },
  auditBody: { flex: 1, paddingLeft: 12, paddingBottom: 16 },
  auditProduct: { fontSize: 14, fontWeight: "600" },
  auditMeta: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  auditChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
  },
  auditChipText: { fontSize: 10, fontWeight: "bold" },
  auditUser: { fontSize: 11 },
  auditTime: { fontSize: 11, marginTop: 2 },
});
