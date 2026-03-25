import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../../lib/config";
import { supabase } from "../../lib/supabase";

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showRelocate, setShowRelocate] = useState(false);
  const [sections, setSections] = useState<any[]>([]);
  const [selectedSection, setSelectedSection] = useState<any>(null);
  const [selectedBay, setSelectedBay] = useState(1);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [relocating, setRelocating] = useState(false);

  useEffect(() => {
    loadProduct();
  }, [id]);

  async function loadProduct() {
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select("*, locations(*, sections(code, name, total_bays, total_levels))")
      .eq("id", id)
      .single();
    setProduct(data);
    setLoading(false);
  }

  async function openRelocate() {
    const { data: secs } = await supabase
      .from("sections")
      .select("id, code, name, total_bays, total_levels")
      .order("code");
    setSections(secs || []);
    const currentLoc = product?.locations?.[0];
    if (currentLoc && secs) {
      const current = secs.find((s: any) => s.id === currentLoc.section_id);
      setSelectedSection(current || secs[0]);
      setSelectedBay(currentLoc.bay);
      setSelectedLevel(currentLoc.level);
    } else if (secs && secs.length > 0) {
      setSelectedSection(secs[0]);
    }
    setShowRelocate(true);
  }

  async function handleRelocate() {
    if (!selectedSection) return;
    const currentLoc = product?.locations?.[0];
    if (!currentLoc) {
      Alert.alert("Error", "No current location found.");
      return;
    }

    setRelocating(true);
    const fromStr = `${currentLoc.sections?.code}-Bay${currentLoc.bay}-L${currentLoc.level}`;
    const toStr = `${selectedSection.code}-Bay${selectedBay}-L${selectedLevel}`;

    const { error } = await supabase
      .from("locations")
      .update({
        section_id: selectedSection.id,
        bay: selectedBay,
        level: selectedLevel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentLoc.id);

    if (error) {
      Alert.alert("Error", error.message);
      setRelocating(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("scan_history").insert({
      product_id: product.id,
      scanned_by: user?.id,
      action: "relocate",
      from_location: fromStr,
      to_location: toStr,
    });

    Alert.alert(
      "Relocated",
      `Moved to Section ${selectedSection.code}, Bay ${selectedBay}, Level ${selectedLevel}.`
    );
    setShowRelocate(false);
    setRelocating(false);
    loadProduct();
  }

  if (loading)
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={THEME.primary} />
      </View>
    );
  if (!product)
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Product not found.</Text>
      </View>
    );

  const location = product.locations?.[0];
  const categoryLabel = (product.category || "")
    .replace("_", "/")
    .toUpperCase();

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{categoryLabel}</Text>
          </View>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.barcode}>
            <FontAwesome name="barcode" size={13} color={THEME.textSecondary} />{" "}
            {product.barcode}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Location</Text>
          {location ? (
            <View>
              <View style={styles.locationRow}>
                <View style={styles.locationItem}>
                  <Text style={styles.locationLabel}>Section</Text>
                  <Text style={styles.locationValue}>
                    {location.sections?.code} {"\u2014"}{" "}
                    {location.sections?.name}
                  </Text>
                </View>
              </View>
              <View style={styles.locationRow}>
                <View style={styles.locationItem}>
                  <Text style={styles.locationLabel}>Bay</Text>
                  <Text style={styles.locationValue}>{location.bay}</Text>
                </View>
                <View style={styles.locationItem}>
                  <Text style={styles.locationLabel}>Level</Text>
                  <Text style={styles.locationValue}>{location.level}</Text>
                </View>
                <View style={styles.locationItem}>
                  <Text style={styles.locationLabel}>Quantity</Text>
                  <Text style={styles.locationValue}>{location.quantity}</Text>
                </View>
              </View>
            </View>
          ) : (
            <Text style={styles.noLocation}>No location assigned</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Details</Text>
          <DetailRow label="Weight" value={product.weight || "\u2014"} />
          <DetailRow
            label="Dimensions"
            value={product.dimensions || "\u2014"}
          />
          <DetailRow
            label="Manufacturer"
            value={product.manufacturer || "\u2014"}
          />
          <DetailRow
            label="Internal SKU"
            value={product.internal_sku || "\u2014"}
          />
          <DetailRow
            label="Reorder Point"
            value={product.reorder_point?.toString() || "\u2014"}
          />
          {product.notes ? (
            <DetailRow label="Notes" value={product.notes} />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>History</Text>
          <DetailRow
            label="Added"
            value={new Date(product.created_at).toLocaleDateString()}
          />
          <DetailRow
            label="Updated"
            value={new Date(product.updated_at).toLocaleDateString()}
          />
        </View>

        <TouchableOpacity style={styles.relocateButton} onPress={openRelocate}>
          <FontAwesome name="arrows" size={16} color="#FFF" />
          <Text style={styles.relocateButtonText}>Relocate Product</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={showRelocate} animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowRelocate(false)}>
              <FontAwesome name="times" size={20} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Relocate Product</Text>
            <View style={{ width: 20 }} />
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalProductName}>{product.name}</Text>

            <Text style={styles.fieldLabel}>Section</Text>
            {sections.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[
                  styles.sectionOption,
                  selectedSection?.id === s.id && styles.sectionOptionActive,
                ]}
                onPress={() => {
                  setSelectedSection(s);
                  setSelectedBay(1);
                  setSelectedLevel(1);
                }}
              >
                <View
                  style={[
                    styles.sectionDot,
                    { backgroundColor: s.color || THEME.primary },
                  ]}
                />
                <Text
                  style={[
                    styles.sectionOptionText,
                    selectedSection?.id === s.id &&
                      styles.sectionOptionTextActive,
                  ]}
                >
                  {s.code} {"\u2014"} {s.name}
                </Text>
                {selectedSection?.id === s.id && (
                  <FontAwesome name="check" size={14} color={THEME.primary} />
                )}
              </TouchableOpacity>
            ))}

            <Text style={styles.fieldLabel}>Bay</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.numberRow}
            >
              {Array.from(
                { length: selectedSection?.total_bays || 5 },
                (_, i) => {
                  const num = i + 1;
                  return (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.numberButton,
                        selectedBay === num && styles.numberButtonActive,
                      ]}
                      onPress={() => setSelectedBay(num)}
                    >
                      <Text
                        style={[
                          styles.numberButtonText,
                          selectedBay === num && styles.numberButtonTextActive,
                        ]}
                      >
                        {num}
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )}
            </ScrollView>

            <Text style={styles.fieldLabel}>Level</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.numberRow}
            >
              {Array.from(
                { length: selectedSection?.total_levels || 3 },
                (_, i) => {
                  const num = i + 1;
                  return (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.numberButton,
                        selectedLevel === num && styles.numberButtonActive,
                      ]}
                      onPress={() => setSelectedLevel(num)}
                    >
                      <Text
                        style={[
                          styles.numberButtonText,
                          selectedLevel === num &&
                            styles.numberButtonTextActive,
                        ]}
                      >
                        {num}
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleRelocate}
              disabled={relocating}
            >
              {relocating ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.confirmButtonText}>
                  {"Move to "}
                  {selectedSection?.code}
                  {"-Bay"}
                  {selectedBay}
                  {"-L"}
                  {selectedLevel}
                </Text>
              )}
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
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
  errorText: { fontSize: 16, color: THEME.textSecondary },
  headerCard: {
    backgroundColor: THEME.surface,
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  categoryBadge: {
    backgroundColor: THEME.primary,
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  categoryBadgeText: { color: "#FFF", fontSize: 11, fontWeight: "bold" },
  productName: {
    fontSize: 22,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 6,
  },
  barcode: { fontSize: 14, color: THEME.textSecondary },
  card: {
    backgroundColor: THEME.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: THEME.primary,
    marginBottom: 12,
  },
  locationRow: { flexDirection: "row", marginBottom: 8 },
  locationItem: { flex: 1 },
  locationLabel: { fontSize: 11, color: THEME.textSecondary, marginBottom: 2 },
  locationValue: { fontSize: 16, fontWeight: "600", color: THEME.textPrimary },
  noLocation: { fontSize: 14, color: THEME.textSecondary, fontStyle: "italic" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F5",
  },
  detailLabel: { fontSize: 14, color: THEME.textSecondary },
  detailValue: {
    fontSize: 14,
    color: THEME.textPrimary,
    fontWeight: "500",
    flex: 1,
    textAlign: "right",
  },
  relocateButton: {
    backgroundColor: THEME.secondary,
    borderRadius: 10,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  relocateButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 10,
  },
  modalContainer: { flex: 1, backgroundColor: THEME.background },
  modalHeader: {
    backgroundColor: THEME.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  modalTitle: { color: "#FFF", fontSize: 17, fontWeight: "bold" },
  modalContent: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  modalProductName: {
    fontSize: 18,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.textPrimary,
    marginBottom: 8,
    marginTop: 16,
  },
  sectionOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  sectionOptionActive: {
    borderColor: THEME.primary,
    backgroundColor: "#FDF0F3",
  },
  sectionDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  sectionOptionText: { flex: 1, fontSize: 15, color: THEME.textPrimary },
  sectionOptionTextActive: { fontWeight: "600", color: THEME.primary },
  numberRow: { flexDirection: "row", maxHeight: 48 },
  numberButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.borderInput,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  numberButtonActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary,
  },
  numberButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: THEME.textPrimary,
  },
  numberButtonTextActive: { color: "#FFF" },
  confirmButton: {
    backgroundColor: THEME.primary,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 24,
  },
  confirmButtonText: { color: "#FFF", fontSize: 15, fontWeight: "bold" },
});
