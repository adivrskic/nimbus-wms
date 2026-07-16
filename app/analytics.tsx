import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader } from "../lib/nimbus/Header";
import { Icon, IconName } from "../lib/nimbus/Icon";
import { color, fontFamilyFor, layout, radius, space, type } from "../lib/nimbus/tokens";
import { usePermissions } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { AnimatedCounter, Skeleton, haptic } from "../lib/ui";
import { useWarehouse } from "../lib/warehouse";

type Tab = "overview" | "inventory" | "activity" | "operations";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "inventory", label: "Inventory" },
  { key: "activity", label: "Activity" },
  { key: "operations", label: "Operations" },
];

const ACTION_CONFIG: Record<
  string,
  { label: string; color: string; icon: IconName }
> = {
  // Nimbus palette only: semantic colors + gold family + grays.
  register: { label: "Registered", color: color.success, icon: "plus" },
  locate: { label: "Located", color: color.info, icon: "search" },
  relocate: { label: "Relocated", color: color.warning, icon: "move" },
  pick: { label: "Picked", color: color.accent, icon: "package" },
  receive: { label: "Received", color: color.accentBright, icon: "truck" },
  return: { label: "Returned", color: color.danger, icon: "rotate-ccw" },
  cycle_count: { label: "Counted", color: color.gray2, icon: "check" },
  adjust: { label: "Adjusted", color: color.gray3, icon: "sliders" },
};

/**
 * PostgREST silently caps any select at 1000 rows, which quietly truncated
 * every distribution on this screen for real-sized data. Page through with
 * .range() up to a hard cap instead.
 */
async function fetchAllPages<T = any>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
  maxPages = 10
): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await make(p * pageSize, (p + 1) * pageSize - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

export default function AnalyticsScreen() {
  const T = useTheme();
  const router = useRouter();
  const { warehouseId, warehouseName } = useWarehouse();
  const perms = usePermissions();
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
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [locsAll, sectionsRes, totalScansRes, scansTodayRes, scanActions] =
      await Promise.all([
        fetchAllPages((from, to) =>
          supabase
            .from("locations")
            .select(
              "product_id, section_id, quantity, is_active, products(reorder_point, categories(name))"
            )
            .eq("warehouse_id", warehouseId)
            .order("id")
            .range(from, to)
        ),
        supabase
          .from("sections")
          .select("id, code, name, color, total_bays, total_levels")
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
        // Action mix over the last 30 days — the all-time version both
        // truncated at 1000 rows and stopped meaning anything.
        fetchAllPages((from, to) =>
          supabase
            .from("scan_history")
            .select("action")
            .eq("warehouse_id", warehouseId)
            .gte("scanned_at", thirtyDaysAgo)
            .order("scanned_at", { ascending: false })
            .range(from, to)
        ),
      ]);
    // Desk parity: soft-deleted slots don't count as on-hand.
    const allLocs = locsAll.filter((l: any) => l.is_active !== false);
    const uniqueProducts = new Set(allLocs.map((l: any) => l.product_id)).size;
    const totalStock = allLocs.reduce(
      (sum: number, l: any) => sum + (l.quantity || 0),
      0
    );
    // Low = product TOTAL at/below its own reorder point (the old per-slot
    // "quantity <= 5" disagreed with the Inventory tab and the Home KPI).
    const perProduct: Record<string, { total: number; reorder: number }> = {};
    allLocs.forEach((l: any) => {
      const id = l.product_id;
      if (!perProduct[id])
        perProduct[id] = { total: 0, reorder: l.products?.reorder_point ?? 0 };
      perProduct[id].total += l.quantity || 0;
    });
    const lowCount = Object.values(perProduct).filter(
      (p) => p.reorder > 0 && p.total > 0 && p.total <= p.reorder
    ).length;

    setStats({
      products: uniqueProducts,
      stock: totalStock,
      scans: totalScansRes.count || 0,
      scansToday: scansTodayRes.count || 0,
      sections: (sectionsRes.data || []).length,
      lowStock: lowCount,
    });

    // Category breakdown
    const catMap: Record<string, number> = {};
    allLocs.forEach((l: any) => {
      const c = l.products?.categories?.name || "Other";
      catMap[c] = (catMap[c] || 0) + 1;
    });
    setCategoryBreakdown(
      Object.entries(catMap)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
    );

    // Section stock with capacity — reuses the rows above instead of a second
    // full locations fetch.
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
    (sectionsRes.data || []).forEach((sec: any) => {
      secStockMap[sec.id] = {
        code: sec.code,
        name: sec.name,
        color: sec.color || color.gray3,
        quantity: 0,
        capacity: sec.total_bays * sec.total_levels,
      };
    });
    allLocs.forEach((loc: any) => {
      if (secStockMap[loc.section_id])
        secStockMap[loc.section_id].quantity += loc.quantity || 0;
    });
    setSectionStock(
      Object.values(secStockMap).sort((a, b) => b.quantity - a.quantity)
    );

    // Action breakdown (last 30d)
    const actMap: Record<string, number> = {};
    scanActions.forEach((sc: any) => {
      actMap[sc.action] = (actMap[sc.action] || 0) + 1;
    });
    setActionBreakdown(
      Object.entries(actMap)
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
    );
  }

  async function loadInventory() {
    // Per-PRODUCT totals: comparing a single slot's qty against the product's
    // reorder point flagged multi-slot products that were actually healthy.
    const rows = await fetchAllPages((from, to) =>
      supabase
        .from("locations")
        .select(
          "quantity, is_active, products!inner(id, name, barcode, reorder_point, categories(name))"
        )
        .eq("warehouse_id", warehouseId)
        .order("id")
        .range(from, to)
    );
    const byProduct: Record<string, { quantity: number; products: any }> = {};
    rows
      .filter((l: any) => l.is_active !== false)
      .forEach((l: any) => {
        const p = l.products;
        if (!p?.id) return;
        if (!byProduct[p.id]) byProduct[p.id] = { quantity: 0, products: p };
        byProduct[p.id].quantity += l.quantity || 0;
      });
    const totals = Object.values(byProduct);
    setLowStockItems(
      totals
        .filter(
          (t) =>
            (t.products.reorder_point ?? 0) > 0 &&
            t.quantity > 0 &&
            t.quantity <= t.products.reorder_point
        )
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 20)
    );
    setReorderItems(
      totals
        .filter(
          (t) =>
            (t.products.reorder_point ?? 0) > 0 &&
            t.quantity <= t.products.reorder_point
        )
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 50)
    );
  }

  async function loadActivity() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    // NOTE: no `profiles:scanned_by(...)` embed here — scan_history.scanned_by
    // FKs to auth.users, so PostgREST can't resolve that relationship and the
    // whole query errored (this tab used to render permanently empty). Names
    // are joined client-side from app.profiles below.
    const [{ data: recent }, dailyScans, staffScans] = await Promise.all([
      supabase
        .from("scan_history")
        .select("*, products(name)")
        .eq("warehouse_id", warehouseId)
        .order("scanned_at", { ascending: false })
        .limit(25),
      fetchAllPages((from, to) =>
        supabase
          .from("scan_history")
          .select("scanned_at")
          .eq("warehouse_id", warehouseId)
          .gte("scanned_at", sevenDaysAgo.toISOString())
          .order("scanned_at", { ascending: false })
          .range(from, to)
      ),
      // Last 30 days — all-time truncated at 1000 rows anyway.
      fetchAllPages((from, to) =>
        supabase
          .from("scan_history")
          .select("scanned_by")
          .eq("warehouse_id", warehouseId)
          .gte("scanned_at", thirtyDaysAgo)
          .order("scanned_at", { ascending: false })
          .range(from, to)
      ),
    ]);

    // Client-side profile join for scanner names.
    const userIds = Array.from(
      new Set(
        [
          ...(recent || []).map((s: any) => s.scanned_by),
          ...staffScans.map((s: any) => s.scanned_by),
        ].filter(Boolean)
      )
    );
    const nameById: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      (profs || []).forEach((p: any) => {
        if (p.full_name) nameById[p.id] = p.full_name;
      });
    }
    setRecentActivity(
      (recent || []).map((s: any) => ({
        ...s,
        profiles: { full_name: nameById[s.scanned_by] ?? null },
      }))
    );

    // Daily activity for last 7 days
    const dayMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayMap[d.toLocaleDateString([], { weekday: "short" })] = 0;
    }
    dailyScans.forEach((s: any) => {
      const day = new Date(s.scanned_at).toLocaleDateString([], {
        weekday: "short",
      });
      if (dayMap[day] !== undefined) dayMap[day]++;
    });
    setDailyActivity(
      Object.entries(dayMap).map(([date, count]) => ({ date, count }))
    );

    // Staff productivity (last 30d)
    const staffMap: Record<string, { name: string; count: number }> = {};
    staffScans.forEach((s: any) => {
      const id = s.scanned_by || "unknown";
      if (!staffMap[id])
        staffMap[id] = { name: nameById[id] || "Unknown", count: 0 };
      staffMap[id].count++;
    });
    setStaffActivity(Object.values(staffMap).sort((a, b) => b.count - a.count));
  }

  async function loadOperations() {
    const [orders, pos, returns] = await Promise.all([
      fetchAllPages((from, to) =>
        supabase
          .from("orders")
          .select("status")
          .eq("warehouse_id", warehouseId)
          .order("id")
          .range(from, to)
      ),
      fetchAllPages((from, to) =>
        supabase
          .from("purchase_orders")
          .select("status")
          .eq("warehouse_id", warehouseId)
          .order("id")
          .range(from, to)
      ),
      fetchAllPages((from, to) =>
        supabase
          .from("returns")
          .select("disposition")
          .eq("warehouse_id", warehouseId)
          .order("id")
          .range(from, to)
      ),
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

  const insets = useSafeAreaInsets();

  if (!perms.canViewReports) {
    return (
      <View style={[s.screen, { backgroundColor: T.bg }]}>
        <ScreenHeader
          title="Reports"
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
        <View style={s.noAccess}>
          <Icon name="bar-chart-3" size={28} color={T.textDim} />
          <Text
            style={[type.body, { color: T.textMuted, textAlign: "center" }]}
          >
            Reports are available to managers. Ask an admin for access, or view
            them on the desktop dashboard.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={warehouseName ? `Facility · ${warehouseName}` : undefined}
        title="Reports"
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

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: space.s40 + insets.bottom }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              haptic.light();
              loadAll();
            }}
            tintColor={T.accent}
          />
        }
      >
        {/* KPI strip */}
        {!loading && (
          <View style={[s.kpiStrip, { borderColor: T.borderSubtle }]}>
            <KpiCell T={T} label="Products" value={stats.products} />
            <View style={[s.kpiDivider, { backgroundColor: T.borderSubtle }]} />
            <KpiCell T={T} label="Stock" value={stats.stock} />
            <View style={[s.kpiDivider, { backgroundColor: T.borderSubtle }]} />
            <KpiCell T={T} label="Today" value={stats.scansToday} />
            <View style={[s.kpiDivider, { backgroundColor: T.borderSubtle }]} />
            <KpiCell
              T={T}
              label="Low"
              value={stats.lowStock}
              tint={stats.lowStock > 0 ? T.warning : undefined}
            />
          </View>
        )}

        <View style={s.body}>
          {/* Tab bar */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.tabBar}
            contentContainerStyle={{ paddingRight: space.s20 }}
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => {
                    setActiveTab(tab.key);
                    haptic.selection();
                  }}
                  activeOpacity={0.7}
                  style={[
                    s.tab,
                    {
                      backgroundColor: active ? T.accent : "transparent",
                      borderColor: active ? T.accent : T.borderSubtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      type.label,
                      { color: active ? color.black : T.textMuted },
                    ]}
                  >
                    {tab.label}
                  </Text>
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
                  borderRadius={0}
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
      </ScrollView>
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
              label={item.category}
              value={item.count}
              max={maxCat}
              color={T.accent}
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
                <Text style={[s.sectionCode, { color: T.text }]}>
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
                <Text style={[s.sectionQty, { color: T.text }]}>
                  {sec.quantity}
                </Text>
                <Text style={[s.sectionCap, { color: T.textMuted }]}>
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
                const cfg = ACTION_CONFIG[item.action] || { color: color.gray3 };
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
                color: color.gray3,
                icon: "circle",
              };
              const pct =
                totalActions > 0
                  ? Math.round((item.count / totalActions) * 100)
                  : 0;
              return (
                <View
                  key={item.action}
                  style={[
                    s.breakdownRow,
                    { borderBottomColor: T.borderSubtle },
                  ]}
                >
                  <View
                    style={[s.breakdownDot, { backgroundColor: cfg.color }]}
                  >
                    <Icon
                      name={cfg.icon as IconName}
                      size={11}
                      color={color.white}
                    />
                  </View>
                  <Text style={[s.breakdownLabel, { color: T.text }]}>
                    {cfg.label}
                  </Text>
                  <Text style={[s.breakdownCount, { color: T.text }]}>
                    {item.count}
                  </Text>
                  <Text style={[s.breakdownPct, { color: T.textMuted }]}>
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
                  borderBottomColor: T.borderSubtle,
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
                  style={[s.listTitle, { color: T.text }]}
                  numberOfLines={1}
                >
                  {item.products?.name || "Unknown"}
                </Text>
                <Text style={[s.listSub, { color: T.textMuted }]}>
                  {item.products?.categories?.name?.toUpperCase()}{" "}
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
                  borderBottomColor: T.borderSubtle,
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
              <View style={{ marginRight: 12 }}>
                <Icon name="alert-circle" size={16} color={T.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[s.listTitle, { color: T.text }]}
                  numberOfLines={1}
                >
                  {item.products?.name}
                </Text>
                <Text style={[s.listSub, { color: T.textMuted }]}>
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
                    borderBottomColor: T.borderSubtle,
                  },
                ]}
              >
                <View style={[s.sectionDot, { backgroundColor: sec.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.listTitle, { color: T.text }]}>
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
                  style={[s.fillPct, { color: pct > 85 ? T.danger : T.text }]}
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
                        backgroundColor: T.accent,
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
                <Text style={[s.chartLabel, { color: T.textMuted }]}>
                  {day.date}
                </Text>
                <Text style={[s.chartValue, { color: T.text }]}>
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
                    borderBottomColor: T.borderSubtle,
                  },
                ]}
              >
                <View style={[s.staffAvatar, { backgroundColor: T.accentDim }]}>
                  <Icon name="user" size={14} color={T.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.listTitle, { color: T.text }]}>
                    {staff.name}
                  </Text>
                  <View style={[s.fillBarBg, { marginTop: 4 }]}>
                    <View
                      style={[
                        s.fillBarFill,
                        {
                          backgroundColor: T.accent,
                          width: `${(staff.count / maxStaff) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text style={[s.staffCount, { color: T.text }]}>
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
              color: color.gray3,
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
                    <Icon
                      name={cfg.icon as IconName}
                      size={11}
                      color={color.white}
                    />
                  </View>
                  {!isLast && (
                    <View
                      style={[s.auditLine, { backgroundColor: T.borderSubtle }]}
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
                  <Text style={[s.auditProduct, { color: T.text }]}>
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
                    <Text style={[s.auditUser, { color: T.textMuted }]}>
                      {(item.profiles as any)?.full_name || ""}
                    </Text>
                  </View>
                  <Text style={[s.auditTime, { color: T.textMuted }]}>
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
  // Nimbus palette only — status dots use the same badge tones as desktop:
  // gray (neutral), warning, info, gold (active), success, danger.
  const STATUS_COLORS: Record<string, string> = {
    created: color.gray3,
    pending: color.warning,
    assigned: color.info,
    in_progress: color.accent,
    picked: color.accentBright,
    packed: color.info,
    shipped: color.success,
    delivered: color.success,
    cancelled: color.danger,
    draft: color.gray2,
    submitted: color.info,
    partial: color.warning,
    received: color.success,
    closed: color.gray3,
    restock: color.success,
    discount: color.warning,
    dispose: color.danger,
    return_to_supplier: color.info,
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
                  borderBottomColor: T.borderSubtle,
                },
              ]}
            >
              <View
                style={[
                  s.statusDot,
                  { backgroundColor: STATUS_COLORS[item.status] || color.gray3 },
                ]}
              />
              <Text
                style={[
                  s.listTitle,
                  {
                    color: T.text,
                    flex: 1,
                    textTransform: "capitalize",
                  },
                ]}
              >
                {item.status.replace(/_/g, " ")}
              </Text>
              <Text style={[s.breakdownCount, { color: T.text }]}>
                {item.count}
              </Text>
              <Text style={[s.breakdownPct, { color: T.textMuted }]}>
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
                  borderBottomColor: T.borderSubtle,
                },
              ]}
            >
              <View
                style={[
                  s.statusDot,
                  { backgroundColor: STATUS_COLORS[item.status] || color.gray3 },
                ]}
              />
              <Text
                style={[
                  s.listTitle,
                  {
                    color: T.text,
                    flex: 1,
                    textTransform: "capitalize",
                  },
                ]}
              >
                {item.status.replace(/_/g, " ")}
              </Text>
              <Text style={[s.breakdownCount, { color: T.text }]}>
                {item.count}
              </Text>
              <Text style={[s.breakdownPct, { color: T.textMuted }]}>
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
                  borderBottomColor: T.borderSubtle,
                },
              ]}
            >
              <View
                style={[
                  s.statusDot,
                  {
                    backgroundColor: STATUS_COLORS[item.disposition] || color.gray3,
                  },
                ]}
              />
              <Text
                style={[
                  s.listTitle,
                  {
                    color: T.text,
                    flex: 1,
                    textTransform: "capitalize",
                  },
                ]}
              >
                {item.disposition.replace(/_/g, " ")}
              </Text>
              <Text style={[s.breakdownCount, { color: T.text }]}>
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
      style={[
        s.card,
        { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
      ]}
    >
      {children}
    </View>
  );
}
function SectionTitle({ T, children }: { T: any; children: React.ReactNode }) {
  return <Text style={[s.sectionLabel, { color: T.text }]}>{children}</Text>;
}
function EmptyText({ T, children }: { T: any; children: React.ReactNode }) {
  return <Text style={[s.emptyText, { color: T.textMuted }]}>{children}</Text>;
}
function KpiCell({
  T,
  label,
  value,
  tint,
}: {
  T: any;
  label: string;
  value: number;
  tint?: string;
}) {
  return (
    <View style={s.kpiCell}>
      <AnimatedCounter
        value={value}
        style={[s.kpiValue, { color: tint || T.text }]}
      />
      <Text style={[s.kpiLabel, { color: T.textMuted }]}>{label}</Text>
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
      <Text style={[s.barLabel, { color: T.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[s.barBg, { backgroundColor: T.borderSubtle }]}>
        <View
          style={[s.barFill, { backgroundColor: color, width: `${pct}%` }]}
        />
      </View>
      <Text style={[s.barValue, { color: T.text }]}>{value}</Text>
    </View>
  );
}

// ============================================================
// STYLES
// ============================================================
const s = StyleSheet.create({
  screen: { flex: 1 },

  noAccess: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.s16,
    paddingHorizontal: space.s40,
  },

  // KPI strip — flat, hairline-bordered, mono numerals
  kpiStrip: {
    flexDirection: "row",
    borderTopWidth: layout.hairlineWidth,
    borderBottomWidth: layout.hairlineWidth,
  },
  kpiDivider: { width: layout.hairlineWidth },
  kpiCell: {
    flex: 1,
    paddingVertical: space.s16,
    paddingHorizontal: space.s12,
    alignItems: "flex-start",
  },
  kpiValue: {
    ...type.monoBody,
    fontSize: 20,
    lineHeight: 24,
    fontFamily: fontFamilyFor("mono", "700"),
  },
  kpiLabel: { ...type.labelSm, marginTop: 4 },

  body: { paddingHorizontal: layout.contentPaddingH, paddingTop: space.s16 },

  // Tabs — label-only, sharp, accent when active
  tabBar: { maxHeight: 44, marginBottom: space.s16 },
  tab: {
    marginRight: space.s8,
    paddingHorizontal: space.s16,
    paddingVertical: 9,
    borderWidth: layout.hairlineWidth,
    justifyContent: "center",
  },

  card: {
    borderWidth: layout.hairlineWidth,
    padding: space.s16,
    marginBottom: space.s16,
  },
  sectionLabel: {
    ...type.label,
    marginBottom: space.s8,
    marginLeft: 2,
    marginTop: 4,
  },
  emptyText: { ...type.body, textAlign: "center", paddingVertical: space.s12 },

  // Bar chart rows
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: space.s12,
  },
  barLabel: { ...type.monoSm, width: 70, marginRight: space.s8 },
  barBg: { flex: 1, height: 20, overflow: "hidden" },
  barFill: { height: 20 },
  barValue: {
    ...type.monoBody,
    width: 32,
    textAlign: "right",
    marginLeft: space.s8,
  },

  // Section stock rows
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: space.s12,
  },
  sectionDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    marginRight: space.s12,
  },
  sectionCode: { ...type.bodySm, fontFamily: fontFamilyFor("display", "600"), marginBottom: 4 },
  sectionQty: { ...type.monoBody, fontSize: 16 },
  sectionCap: { ...type.labelSm, marginTop: 1 },
  fillBarBg: {
    height: 6,
    backgroundColor: color.whiteAlpha.a1,
    overflow: "hidden",
  },
  fillBarFill: { height: 6 },
  fillPct: {
    ...type.monoBody,
    marginLeft: space.s12,
    width: 40,
    textAlign: "right",
  },

  // Proportion bar
  proportionBar: {
    flexDirection: "row",
    height: 10,
    overflow: "hidden",
    marginBottom: space.s16,
  },
  proportionSeg: { height: 10 },

  // Breakdown rows
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.s12,
    borderBottomWidth: layout.hairlineWidth,
  },
  breakdownDot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    marginRight: space.s12,
  },
  breakdownLabel: { ...type.body, flex: 1 },
  breakdownCount: { ...type.monoBody, marginRight: space.s8 },
  breakdownPct: { ...type.monoSm, width: 32 },

  // List rows
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.s12,
  },
  listTitle: { ...type.body, fontFamily: fontFamilyFor("display", "600") },
  listSub: { ...type.monoSm, marginTop: 2 },
  alertDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    marginRight: space.s12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    marginRight: space.s12,
  },
  qtyBadge: { paddingHorizontal: space.s8, paddingVertical: 4 },
  qtyBadgeText: { ...type.monoBody, fontSize: 16 },

  // Daily chart
  chartArea: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: space.s8,
  },
  chartCol: { alignItems: "center", flex: 1 },
  chartBarWrap: {
    height: 100,
    width: 24,
    backgroundColor: color.whiteAlpha.a1,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  chartBar: { width: 24, minHeight: 4 },
  chartLabel: { ...type.labelSm, marginTop: 6 },
  chartValue: { ...type.monoSm, marginTop: 2 },

  // Staff
  staffAvatar: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    marginRight: space.s12,
  },
  staffCount: { ...type.monoBody, fontSize: 16, marginLeft: space.s12 },

  // Audit trail
  auditRow: { flexDirection: "row", minHeight: 56 },
  auditTrack: { width: 28, alignItems: "center" },
  auditDot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  auditLine: { flex: 1, width: 1, marginTop: -1 },
  auditBody: { flex: 1, paddingLeft: space.s12, paddingBottom: space.s16 },
  auditProduct: { ...type.body, fontFamily: fontFamilyFor("display", "600") },
  auditMeta: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  auditChip: {
    paddingHorizontal: space.s8,
    paddingVertical: 2,
    marginRight: space.s8,
  },
  auditChipText: { ...type.labelSm },
  auditUser: { ...type.monoSm },
  auditTime: { ...type.monoSm, marginTop: 2 },
});
