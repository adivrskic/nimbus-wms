import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../../lib/config";
import { supabase } from "../../lib/supabase";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "hardwood", label: "Hardwood" },
  { value: "laminate", label: "Laminate" },
  { value: "vinyl_lvp", label: "Vinyl/LVP" },
  { value: "tile", label: "Tile" },
  { value: "carpet", label: "Carpet" },
  { value: "underlayment", label: "Underlayment" },
  { value: "adhesive", label: "Adhesive" },
  { value: "trim_molding", label: "Trim/Molding" },
  { value: "tools", label: "Tools" },
  { value: "accessories", label: "Accessories" },
  { value: "other", label: "Other" },
];

export default function InventoryScreen() {
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [])
  );

  async function loadProducts() {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*, locations(quantity, bay, level, sections(code, name))")
      .order("created_at", { ascending: false });
    if (!error && data) setProducts(data);
    setLoading(false);
  }

  const filtered = products.filter((p) => {
    const matchesSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      activeCategory === "all" || p.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  function getProductLocation(product: any) {
    const loc = product.locations?.[0];
    if (!loc) return "No location";
    return `${loc.sections?.code || "?"}-Bay${loc.bay}-L${loc.level}`;
  }

  function getProductQuantity(product: any) {
    return (product.locations || []).reduce(
      (sum: number, loc: any) => sum + (loc.quantity || 0),
      0
    );
  }

  function renderProduct({ item }: { item: any }) {
    const qty = getProductQuantity(item);
    const location = getProductLocation(item);

    return (
      <TouchableOpacity
        style={styles.productCard}
        onPress={() => router.push(`/product/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.productLeft}>
          <Text style={styles.productName}>{item.name}</Text>
          <Text style={styles.productDetail}>
            {item.category.replace("_", "/").toUpperCase()} {"\u2022"}{" "}
            {item.barcode}
          </Text>
          <View style={styles.locationRow}>
            <FontAwesome name="map-marker" size={12} color={THEME.primary} />
            <Text style={styles.locationText}>{location}</Text>
          </View>
        </View>
        <View style={styles.productRight}>
          <Text style={styles.qtyValue}>{qty}</Text>
          <Text style={styles.qtyLabel}>units</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <FontAwesome
          name="search"
          size={14}
          color={THEME.textSecondary}
          style={{ marginRight: 8 }}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or barcode..."
          placeholderTextColor={THEME.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <FontAwesome
              name="times-circle"
              size={16}
              color={THEME.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATEGORIES}
        keyExtractor={(c) => c.value}
        style={styles.pillRow}
        renderItem={({ item: c }) => (
          <TouchableOpacity
            style={[
              styles.pill,
              activeCategory === c.value && styles.pillActive,
            ]}
            onPress={() => setActiveCategory(c.value)}
          >
            <Text
              style={[
                styles.pillText,
                activeCategory === c.value && styles.pillTextActive,
              ]}
            >
              {c.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      <Text style={styles.countText}>
        {filtered.length} {"product"}
        {filtered.length !== 1 ? "s" : ""}
      </Text>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <FontAwesome name="inbox" size={40} color="#CCC" />
          <Text style={styles.emptyText}>No products found</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderProduct}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
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
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
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
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    color: THEME.textPrimary,
  },
  pillRow: { maxHeight: 40, marginBottom: 12 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.borderInput,
    marginRight: 8,
  },
  pillActive: { backgroundColor: THEME.primary, borderColor: THEME.primary },
  pillText: { fontSize: 13, color: "#666" },
  pillTextActive: { color: "#FFF", fontWeight: "600" },
  countText: { fontSize: 13, color: THEME.textSecondary, marginBottom: 10 },
  productCard: {
    flexDirection: "row",
    backgroundColor: THEME.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  productLeft: { flex: 1 },
  productName: { fontSize: 15, fontWeight: "bold", color: THEME.textPrimary },
  productDetail: { fontSize: 12, color: THEME.textSecondary, marginTop: 3 },
  locationRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  locationText: {
    fontSize: 12,
    color: THEME.primary,
    marginLeft: 5,
    fontWeight: "600",
  },
  productRight: {
    justifyContent: "center",
    alignItems: "center",
    paddingLeft: 16,
  },
  qtyValue: { fontSize: 22, fontWeight: "bold", color: THEME.textPrimary },
  qtyLabel: { fontSize: 11, color: THEME.textSecondary },
  emptyText: { fontSize: 15, color: THEME.textSecondary, marginTop: 12 },
});
