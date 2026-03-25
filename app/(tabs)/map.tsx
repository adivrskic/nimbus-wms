import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../../lib/config";
import { supabase } from "../../lib/supabase";

export default function MapScreen() {
  const [sections, setSections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSection, setSelectedSection] = useState<any>(null);
  const [bayProducts, setBayProducts] = useState<any[]>([]);
  const [bayLoading, setBayLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadSections();
    }, [])
  );

  async function loadSections() {
    setLoading(true);
    const { data } = await supabase.from("sections").select("*").order("code");
    setSections(data || []);
    setLoading(false);
  }

  async function openBayView(section: any) {
    setSelectedSection(section);
    setBayLoading(true);
    const { data } = await supabase
      .from("locations")
      .select("*, products(name, barcode, category)")
      .eq("section_id", section.id)
      .order("bay")
      .order("level");
    setBayProducts(data || []);
    setBayLoading(false);
  }

  function closeBayView() {
    setSelectedSection(null);
    setBayProducts([]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={THEME.primary} />
      </View>
    );
  }

  const leftSections = sections.filter((_, i) => i % 2 === 0);
  const rightSections = sections.filter((_, i) => i % 2 === 1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Warehouse Floor Plan</Text>
      <Text style={styles.hint}>Tap a section to view bays</Text>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.mapGrid}>
          <View style={styles.column}>
            {leftSections.map((section) => (
              <TouchableOpacity
                key={section.id}
                style={[
                  styles.sectionBlock,
                  { backgroundColor: section.color || THEME.primary },
                ]}
                onPress={() => openBayView(section)}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionCode}>{section.code}</Text>
                <Text style={styles.sectionName}>{section.name}</Text>
                <Text style={styles.sectionMeta}>
                  {section.total_bays} bays {"\u2022"} {section.total_levels}{" "}
                  levels
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.aisle}>
            <View style={styles.aisleLine} />
            <Text style={styles.aisleText}>AISLE</Text>
            <View style={styles.aisleLine} />
          </View>

          <View style={styles.column}>
            {rightSections.map((section) => (
              <TouchableOpacity
                key={section.id}
                style={[
                  styles.sectionBlock,
                  { backgroundColor: section.color || THEME.secondary },
                ]}
                onPress={() => openBayView(section)}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionCode}>{section.code}</Text>
                <Text style={styles.sectionName}>{section.name}</Text>
                <Text style={styles.sectionMeta}>
                  {section.total_bays} bays {"\u2022"} {section.total_levels}{" "}
                  levels
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.dockDoor}>
          <FontAwesome name="truck" size={14} color={THEME.textSecondary} />
          <Text style={styles.dockText}>Loading Dock</Text>
        </View>

        <View style={styles.legend}>
          {sections.map((s) => (
            <View key={s.id} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <Text style={styles.legendText}>
                {s.code} {"\u2014"} {s.name}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      <Modal visible={!!selectedSection} animationType="slide">
        <View style={styles.bayContainer}>
          <View style={styles.bayHeader}>
            <TouchableOpacity onPress={closeBayView}>
              <FontAwesome name="arrow-left" size={20} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.bayTitle}>
              {"Section "}
              {selectedSection?.code}
              {" \u2014 "}
              {selectedSection?.name}
            </Text>
            <View style={{ width: 20 }} />
          </View>

          {bayLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={THEME.primary} />
            </View>
          ) : (
            <ScrollView style={styles.bayContent}>
              {Array.from(
                { length: selectedSection?.total_bays || 0 },
                (_, bayIndex) => {
                  const bayNum = bayIndex + 1;
                  const totalLevels = selectedSection?.total_levels || 3;

                  return (
                    <View key={bayNum} style={styles.bayCard}>
                      <Text style={styles.bayLabel}>Bay {bayNum}</Text>
                      <View>
                        {Array.from(
                          { length: totalLevels },
                          (_, levelIndex) => {
                            const levelNum = totalLevels - levelIndex;
                            const product = bayProducts.find(
                              (p) => p.bay === bayNum && p.level === levelNum
                            );

                            return (
                              <View key={levelNum} style={styles.shelfRow}>
                                <Text style={styles.levelLabel}>
                                  L{levelNum}
                                </Text>
                                <View
                                  style={[
                                    styles.shelf,
                                    product && styles.shelfOccupied,
                                  ]}
                                >
                                  {product ? (
                                    <View>
                                      <Text style={styles.productName}>
                                        {product.products?.name}
                                      </Text>
                                      <Text style={styles.productMeta}>
                                        {product.products?.category} {"\u2022"}{" "}
                                        Qty: {product.quantity}
                                      </Text>
                                    </View>
                                  ) : (
                                    <Text style={styles.emptyShelf}>Empty</Text>
                                  )}
                                </View>
                              </View>
                            );
                          }
                        )}
                      </View>
                    </View>
                  );
                }
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.background, paddingTop: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: THEME.textPrimary,
    paddingHorizontal: 20,
  },
  hint: {
    fontSize: 13,
    color: THEME.textSecondary,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  mapGrid: { flexDirection: "row", paddingHorizontal: 20 },
  column: { flex: 1 },
  sectionBlock: {
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    alignItems: "center",
    minHeight: 90,
    justifyContent: "center",
  },
  sectionCode: { fontSize: 26, fontWeight: "bold", color: "#FFF" },
  sectionName: { fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  sectionMeta: { fontSize: 10, color: "rgba(255,255,255,0.6)", marginTop: 4 },
  aisle: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  aisleLine: { flex: 1, width: 1, backgroundColor: "#CCC" },
  aisleText: {
    fontSize: 9,
    color: THEME.textSecondary,
    fontWeight: "600",
    marginVertical: 8,
    transform: [{ rotate: "-90deg" }],
    width: 40,
    textAlign: "center",
  },
  dockDoor: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginHorizontal: 20,
    marginTop: 4,
    borderTopWidth: 2,
    borderTopColor: THEME.borderInput,
    borderStyle: "dashed",
  },
  dockText: {
    fontSize: 12,
    color: THEME.textSecondary,
    marginLeft: 8,
    fontWeight: "600",
  },
  legend: { paddingHorizontal: 20, paddingTop: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  legendText: { fontSize: 13, color: "#666" },
  bayContainer: { flex: 1, backgroundColor: THEME.background },
  bayHeader: {
    backgroundColor: THEME.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  bayTitle: { color: "#FFF", fontSize: 17, fontWeight: "bold" },
  bayContent: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  bayCard: {
    backgroundColor: THEME.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  bayLabel: {
    fontSize: 15,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 10,
  },
  shelfRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  levelLabel: {
    width: 28,
    fontSize: 12,
    fontWeight: "600",
    color: THEME.textSecondary,
  },
  shelf: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderStyle: "dashed",
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 42,
    justifyContent: "center",
  },
  shelfOccupied: {
    backgroundColor: "#FDF0F3",
    borderColor: THEME.primary,
    borderStyle: "solid",
  },
  productName: { fontSize: 13, fontWeight: "600", color: THEME.textPrimary },
  productMeta: { fontSize: 11, color: THEME.textSecondary, marginTop: 2 },
  emptyShelf: { fontSize: 12, color: "#CCC", fontStyle: "italic" },
});
