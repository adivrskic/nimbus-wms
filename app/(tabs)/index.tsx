import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../../lib/config";
import { supabase } from "../../lib/supabase";

export default function DashboardScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [warehouseName, setWarehouseName] = useState("");
  const [productCount, setProductCount] = useState(0);
  const [sectionCount, setSectionCount] = useState(0);
  const [totalStock, setTotalStock] = useState(0);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [])
  );

  async function loadStats() {
    setLoading(true);

    const { data: warehouse } = await supabase
      .from("warehouses")
      .select("name")
      .limit(1)
      .single();

    const { count: products } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true });

    const { count: sections } = await supabase
      .from("sections")
      .select("*", { count: "exact", head: true });

    const { data: stockData } = await supabase
      .from("locations")
      .select("quantity");

    const stock = (stockData || []).reduce(
      (sum, row) => sum + (row.quantity || 0),
      0
    );

    setWarehouseName(warehouse?.name || "Warehouse");
    setProductCount(products || 0);
    setSectionCount(sections || 0);
    setTotalStock(stock);
    setLoading(false);
  }

  async function handleSearch(text: string) {
    setSearch(text);

    if (text.trim().length === 0) {
      setSearchResults([]);
      return;
    }

    if (text.trim().length < 2) return;

    setSearching(true);

    const { data } = await supabase
      .from("products")
      .select(
        "id, name, barcode, category, locations(quantity, bay, level, sections(code))"
      )
      .or(`name.ilike.%${text.trim()}%,barcode.ilike.%${text.trim()}%`)
      .limit(10);

    setSearchResults(data || []);
    setSearching(false);
  }

  function getLocation(product: any) {
    const loc = product.locations?.[0];
    if (!loc) return "No location";
    return `${loc.sections?.code || "?"}-Bay${loc.bay}-L${loc.level}`;
  }

  function getQuantity(product: any) {
    return (product.locations || []).reduce(
      (sum: number, loc: any) => sum + (loc.quantity || 0),
      0
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={THEME.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.warehouse}>{warehouseName}</Text>

        <View style={styles.searchRow}>
          <FontAwesome
            name="search"
            size={16}
            color={THEME.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products by name or barcode..."
            placeholderTextColor={THEME.textSecondary}
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
                color={THEME.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>

        {search.length >= 2 && (
          <View style={styles.resultsContainer}>
            {searching ? (
              <ActivityIndicator
                color={THEME.primary}
                style={{ marginVertical: 12 }}
              />
            ) : searchResults.length === 0 ? (
              <Text style={styles.noResults}>
                No products found for "{search}"
              </Text>
            ) : (
              searchResults.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.resultCard}
                  onPress={() => router.push(`/product/${item.id}`)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultName}>{item.name}</Text>
                    <Text style={styles.resultDetail}>
                      {item.category.replace("_", "/").toUpperCase()} {"\u2022"}{" "}
                      {item.barcode}
                    </Text>
                    <View style={styles.resultLocationRow}>
                      <FontAwesome
                        name="map-marker"
                        size={11}
                        color={THEME.primary}
                      />
                      <Text style={styles.resultLocation}>
                        {getLocation(item)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.resultRight}>
                    <Text style={styles.resultQty}>{getQuantity(item)}</Text>
                    <Text style={styles.resultQtyLabel}>units</Text>
                  </View>
                  <FontAwesome
                    name="chevron-right"
                    size={12}
                    color="#CCC"
                    style={{ marginLeft: 8 }}
                  />
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {search.length < 2 && (
          <>
            <View style={styles.statsRow}>
              <StatCard label="Products" value={productCount} icon="cube" />
              <StatCard label="Sections" value={sectionCount} icon="th-large" />
              <StatCard label="Total Stock" value={totalStock} icon="archive" />
            </View>

            <Text style={styles.sectionTitle}>Quick Actions</Text>

            <View style={styles.actionsRow}>
              <ActionButton
                icon="barcode"
                label="Scan"
                onPress={() => router.push("/(tabs)/scanner")}
              />
              <ActionButton
                icon="map"
                label="Map"
                onPress={() => router.push("/(tabs)/map")}
              />
              <ActionButton
                icon="list"
                label="Inventory"
                onPress={() => router.push("/(tabs)/inventory")}
              />
              <ActionButton
                icon="line-chart"
                label="Analytics"
                onPress={() => router.push("/analytics")}
              />
            </View>

            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <View style={styles.emptyActivity}>
              <FontAwesome name="clock-o" size={24} color="#CCC" />
              <Text style={styles.emptyText}>
                Scan and register products to see activity here
              </Text>
            </View>
          </>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: string;
}) {
  return (
    <View style={styles.statCard}>
      <FontAwesome name={icon as any} size={20} color={THEME.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <FontAwesome name={icon as any} size={22} color={THEME.secondary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: THEME.background,
  },
  warehouse: {
    fontSize: 22,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 16,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.borderInput,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: THEME.textPrimary,
  },
  resultsContainer: {
    marginBottom: 16,
  },
  noResults: {
    fontSize: 14,
    color: THEME.textSecondary,
    textAlign: "center",
    paddingVertical: 16,
  },
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  resultName: {
    fontSize: 15,
    fontWeight: "bold",
    color: THEME.textPrimary,
  },
  resultDetail: {
    fontSize: 11,
    color: THEME.textSecondary,
    marginTop: 2,
  },
  resultLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  resultLocation: {
    fontSize: 11,
    color: THEME.primary,
    fontWeight: "600",
    marginLeft: 4,
  },
  resultRight: {
    alignItems: "center",
    paddingLeft: 12,
  },
  resultQty: {
    fontSize: 18,
    fontWeight: "bold",
    color: THEME.textPrimary,
  },
  resultQtyLabel: {
    fontSize: 10,
    color: THEME.textSecondary,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  statCard: {
    flex: 1,
    backgroundColor: THEME.surface,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginTop: 6,
  },
  statLabel: {
    fontSize: 12,
    color: THEME.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  actionButton: {
    flex: 1,
    backgroundColor: THEME.surface,
    borderRadius: 10,
    paddingVertical: 18,
    alignItems: "center",
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  actionLabel: {
    fontSize: 12,
    color: THEME.textPrimary,
    marginTop: 6,
    fontWeight: "600",
  },
  emptyActivity: {
    backgroundColor: THEME.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 13,
    color: THEME.textSecondary,
    marginTop: 10,
    textAlign: "center",
  },
});
