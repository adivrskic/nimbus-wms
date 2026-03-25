import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { THEME } from "../lib/config";
import { supabase } from "../lib/supabase";

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
  register: { label: "Registered", color: THEME.success, icon: "plus-circle" },
  locate: { label: "Located", color: "#1565C0", icon: "search" },
  relocate: { label: "Relocated", color: THEME.warning, icon: "arrows" },
  pick: { label: "Picked", color: "#6A1B9A", icon: "hand-rock-o" },
  receive: { label: "Received", color: "#00838F", icon: "truck" },
  return: { label: "Returned", color: THEME.danger, icon: "undo" },
  cycle_count: { label: "Counted", color: "#4E342E", icon: "check-square-o" },
  adjust: { label: "Adjusted", color: "#37474F", icon: "sliders" },
};

export default function AnalyticsScreen() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalStock: 0,
    totalScans: 0,
    scansToday: 0,
  });
  const [categoryBreakdown, setCategoryBreakdown] = useState<
    { category: string; count: number }[]
  >([]);
  const [sectionStock, setSectionStock] = useState<
    { code: string; name: string; color: string; quantity: number }[]
  >([]);
  const [actionBreakdown, setActionBreakdown] = useState<
    { action: string; count: number }[]
  >([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    setLoading(true);

    const { count: totalProducts } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true });
    const { data: stockData } = await supabase
      .from("locations")
      .select("quantity");
    const totalStock = (stockData || []).reduce(
      (sum, r) => sum + (r.quantity || 0),
      0
    );
    const { count: totalScans } = await supabase
      .from("scan_history")
      .select("*", { count: "exact", head: true });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: scansToday } = await supabase
      .from("scan_history")
      .select("*", { count: "exact", head: true })
      .gte("scanned_at", todayStart.toISOString());

    setStats({
      totalProducts: totalProducts || 0,
      totalStock,
      totalScans: totalScans || 0,
      scansToday: scansToday || 0,
    });

    const { data: products } = await supabase
      .from("products")
      .select("category");
    const catMap: Record<string, number> = {};
    (products || []).forEach((p) => {
      catMap[p.category] = (catMap[p.category] || 0) + 1;
    });
    setCategoryBreakdown(
      Object.entries(catMap)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
    );

    const { data: locData } = await supabase
      .from("locations")
      .select("quantity, sections(code, name, color)");
    const secMap: Record<
      string,
      { code: string; name: string; color: string; quantity: number }
    > = {};
    (locData || []).forEach((loc: any) => {
      const code = loc.sections?.code || "?";
      if (!secMap[code])
        secMap[code] = {
          code,
          name: loc.sections?.name || "",
          color: loc.sections?.color || "#999",
          quantity: 0,
        };
      secMap[code].quantity += loc.quantity || 0;
    });
    setSectionStock(
      Object.values(secMap).sort((a, b) => b.quantity - a.quantity)
    );

    const { data: scans } = await supabase
      .from("scan_history")
      .select("action");
    const actMap: Record<string, number> = {};
    (scans || []).forEach((s) => {
      actMap[s.action] = (actMap[s.action] || 0) + 1;
    });
    setActionBreakdown(
      Object.entries(actMap)
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
    );

    const { data: recent } = await supabase
      .from("scan_history")
      .select("*, products(name)")
      .order("scanned_at", { ascending: false })
      .limit(10);
    setRecentActivity(recent || []);

    setLoading(false);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={THEME.primary} />
      </View>
    );
  }

  const maxCatCount = Math.max(...categoryBreakdown.map((c) => c.count), 1);
  const maxSecStock = Math.max(...sectionStock.map((s) => s.quantity), 1);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Overview</Text>
      <View style={styles.overviewGrid}>
        <OverviewCard
          icon="cube"
          label="Products"
          value={stats.totalProducts}
          color={THEME.primary}
        />
        <OverviewCard
          icon="archive"
          label="Total Stock"
          value={stats.totalStock}
          color={THEME.secondary}
        />
        <OverviewCard
          icon="barcode"
          label="All Scans"
          value={stats.totalScans}
          color={THEME.success}
        />
        <OverviewCard
          icon="bolt"
          label="Today"
          value={stats.scansToday}
          color={THEME.warning}
        />
      </View>

      {categoryBreakdown.length > 0 && (
        <>
          <Text style={styles.heading}>Products by Category</Text>
          <View style={styles.card}>
            {categoryBreakdown.map((item) => (
              <View key={item.category} style={styles.barRow}>
                <Text style={styles.barLabel}>
                  {CATEGORY_LABELS[item.category] || item.category}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${(item.count / maxCatCount) * 100}%`,
                        backgroundColor: THEME.primary,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.barValue}>{item.count}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {sectionStock.length > 0 && (
        <>
          <Text style={styles.heading}>Stock by Section</Text>
          <View style={styles.card}>
            {sectionStock.map((item) => (
              <View key={item.code} style={styles.barRow}>
                <Text style={styles.barLabel}>
                  {item.code} {"\u2014"} {item.name}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${(item.quantity / maxSecStock) * 100}%`,
                        backgroundColor: item.color,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.barValue}>{item.quantity}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {actionBreakdown.length > 0 && (
        <>
          <Text style={styles.heading}>Activity Breakdown</Text>
          <View style={styles.card}>
            {actionBreakdown.map((item) => {
              const config = ACTION_CONFIG[item.action] || {
                label: item.action,
                color: "#999",
                icon: "circle",
              };
              return (
                <View key={item.action} style={styles.actionRow}>
                  <View
                    style={[
                      styles.actionDot,
                      { backgroundColor: config.color },
                    ]}
                  >
                    <FontAwesome
                      name={config.icon as any}
                      size={10}
                      color="#FFF"
                    />
                  </View>
                  <Text style={styles.actionLabel}>{config.label}</Text>
                  <Text style={styles.actionCount}>{item.count}</Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.heading}>Recent Activity</Text>
      {recentActivity.length === 0 ? (
        <View style={styles.emptyCard}>
          <FontAwesome name="clock-o" size={24} color="#CCC" />
          <Text style={styles.emptyText}>No activity yet</Text>
        </View>
      ) : (
        <View style={styles.card}>
          {recentActivity.map((item) => {
            const config = ACTION_CONFIG[item.action] || {
              label: item.action,
              color: "#999",
              icon: "circle",
            };
            const time = new Date(item.scanned_at);
            const timeStr = `${time.toLocaleDateString()} ${time.toLocaleTimeString(
              [],
              { hour: "2-digit", minute: "2-digit" }
            )}`;
            return (
              <View key={item.id} style={styles.activityRow}>
                <View
                  style={[
                    styles.activityDot,
                    { backgroundColor: config.color },
                  ]}
                >
                  <FontAwesome
                    name={config.icon as any}
                    size={11}
                    color="#FFF"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityProduct}>
                    {item.products?.name || "Unknown product"}
                  </Text>
                  <Text style={styles.activityMeta}>
                    {config.label} {"\u2022"} {timeStr}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

function OverviewCard({
  icon,
  label,
  value,
  color,
}: {
  icon: string;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={styles.overviewCard}>
      <FontAwesome name={icon as any} size={18} color={color} />
      <Text style={[styles.overviewValue, { color }]}>{value}</Text>
      <Text style={styles.overviewLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: THEME.background,
  },
  heading: {
    fontSize: 16,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 10,
    marginTop: 8,
  },
  overviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  overviewCard: {
    width: "48%",
    backgroundColor: THEME.surface,
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  overviewValue: { fontSize: 26, fontWeight: "bold", marginTop: 6 },
  overviewLabel: { fontSize: 12, color: THEME.textSecondary, marginTop: 2 },
  card: {
    backgroundColor: THEME.surface,
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  barLabel: {
    width: 80,
    fontSize: 12,
    color: THEME.textPrimary,
    fontWeight: "500",
  },
  barTrack: {
    flex: 1,
    height: 16,
    backgroundColor: "#F0F0F0",
    borderRadius: 8,
    marginHorizontal: 8,
    overflow: "hidden",
  },
  barFill: { height: 16, borderRadius: 8 },
  barValue: {
    width: 30,
    fontSize: 13,
    fontWeight: "bold",
    color: THEME.textPrimary,
    textAlign: "right",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F5",
  },
  actionDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  actionLabel: { flex: 1, fontSize: 14, color: THEME.textPrimary },
  actionCount: { fontSize: 16, fontWeight: "bold", color: THEME.textPrimary },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F5",
  },
  activityDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  activityProduct: {
    fontSize: 14,
    fontWeight: "600",
    color: THEME.textPrimary,
  },
  activityMeta: { fontSize: 12, color: THEME.textSecondary, marginTop: 2 },
  emptyCard: {
    backgroundColor: THEME.surface,
    borderRadius: 10,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: 16,
  },
  emptyText: { fontSize: 13, color: THEME.textSecondary, marginTop: 10 },
});
