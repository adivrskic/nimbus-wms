import FontAwesome from "@expo/vector-icons/FontAwesome";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../../lib/config";
import { supabase } from "../../lib/supabase";

const CATEGORIES = [
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

export default function ScannerScreen() {
  const [barcode, setBarcode] = useState("");
  const [lookupDone, setLookupDone] = useState(false);
  const [existingProduct, setExistingProduct] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("hardwood");
  const [weight, setWeight] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [showCategories, setShowCategories] = useState(false);

  const [sections, setSections] = useState<any[]>([]);
  const [selectedSection, setSelectedSection] = useState<any>(null);
  const [bay, setBay] = useState("1");
  const [level, setLevel] = useState("1");
  const [showSections, setShowSections] = useState(false);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);
    setBarcode(data);
    handleLookupWithBarcode(data);
  }

  async function handleLookupWithBarcode(code: string) {
    if (!code.trim()) return;
    setLoading(true);

    const { data: product } = await supabase
      .from("products")
      .select("*, locations(*, sections(code, name))")
      .eq("barcode", code.trim())
      .maybeSingle();

    if (product) {
      setExistingProduct(product);
      setLookupDone(true);
    } else {
      setExistingProduct(null);
      setLookupDone(true);
      const { data: secs } = await supabase
        .from("sections")
        .select("id, code, name")
        .order("code");
      setSections(secs || []);
      if (secs && secs.length > 0) setSelectedSection(secs[0]);
    }

    setLoading(false);
  }

  async function handleLookup() {
    if (!barcode.trim()) {
      Alert.alert("Error", "Enter a barcode first.");
      return;
    }
    setScanned(true);
    handleLookupWithBarcode(barcode);
  }

  async function handleRegister() {
    if (!name.trim()) {
      Alert.alert("Error", "Product name is required.");
      return;
    }
    if (!selectedSection) {
      Alert.alert("Error", "Select a section.");
      return;
    }

    setLoading(true);

    const { data: warehouse } = await supabase
      .from("warehouses")
      .select("id")
      .limit(1)
      .single();

    if (!warehouse) {
      Alert.alert("Error", "No warehouse found.");
      setLoading(false);
      return;
    }

    const { data: product, error: productErr } = await supabase
      .from("products")
      .insert({
        barcode: barcode.trim(),
        name: name.trim(),
        category,
        weight: weight.trim() || null,
        notes: notes.trim() || null,
      })
      .select()
      .single();

    if (productErr) {
      Alert.alert("Error", productErr.message);
      setLoading(false);
      return;
    }

    const { error: locErr } = await supabase.from("locations").insert({
      product_id: product.id,
      section_id: selectedSection.id,
      warehouse_id: warehouse.id,
      bay: parseInt(bay) || 1,
      level: parseInt(level) || 1,
      quantity: parseInt(quantity) || 1,
    });

    if (locErr) {
      Alert.alert("Error", locErr.message);
      setLoading(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("scan_history").insert({
      product_id: product.id,
      scanned_by: user?.id,
      action: "register",
      to_location: `${selectedSection.code}-Bay${bay}-L${level}`,
    });

    Alert.alert(
      "Success",
      `${name} registered in Section ${selectedSection.code}, Bay ${bay}, Level ${level}.`
    );
    resetForm();
    setLoading(false);
  }

  function resetForm() {
    setBarcode("");
    setLookupDone(false);
    setExistingProduct(null);
    setName("");
    setCategory("hardwood");
    setWeight("");
    setQuantity("1");
    setNotes("");
    setBay("1");
    setLevel("1");
    setSelectedSection(sections[0] || null);
    setScanned(false);
  }

  const cameraReady = permission?.granted;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#000" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.cameraWrapper}>
        {cameraReady ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{
              barcodeTypes: [
                "ean13",
                "ean8",
                "upc_a",
                "upc_e",
                "code128",
                "code39",
                "code93",
                "itf14",
                "qr",
              ],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          />
        ) : (
          <View style={styles.noCamera}>
            <FontAwesome name="camera" size={30} color="#666" />
            <Text style={styles.noCameraText}>Camera permission required</Text>
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={requestPermission}
            >
              <Text style={styles.permissionButtonText}>Grant Access</Text>
            </TouchableOpacity>
          </View>
        )}
        {cameraReady && (
          <View style={styles.overlay}>
            <View style={styles.crosshair} />
            {!scanned && <Text style={styles.scanHint}>Point at barcode</Text>}
            {scanned && (
              <View style={styles.scannedBadge}>
                <FontAwesome name="check" size={12} color="#FFF" />
                <Text style={styles.scannedText}>Scanned: {barcode}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      <View style={styles.sheet}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.barcodeRow}>
            <TextInput
              style={styles.barcodeInput}
              placeholder="Or type barcode..."
              placeholderTextColor={THEME.textSecondary}
              value={barcode}
              onChangeText={(t) => {
                setBarcode(t);
                setLookupDone(false);
                setExistingProduct(null);
                setScanned(false);
              }}
              autoCapitalize="none"
            />
            {scanned ? (
              <TouchableOpacity
                style={styles.scanAgainButton}
                onPress={resetForm}
              >
                <FontAwesome name="refresh" size={16} color="#FFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.lookupButton}
                onPress={handleLookup}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <FontAwesome name="search" size={16} color="#FFF" />
                )}
              </TouchableOpacity>
            )}
          </View>

          {loading && (
            <ActivityIndicator
              color={THEME.primary}
              style={{ marginVertical: 12 }}
            />
          )}

          {lookupDone && existingProduct && (
            <View style={styles.foundCard}>
              <FontAwesome
                name="check-circle"
                size={18}
                color={THEME.success}
              />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.foundName}>{existingProduct.name}</Text>
                <Text style={styles.foundDetail}>
                  {existingProduct.category} {"\u2022"}{" "}
                  {existingProduct.barcode}
                </Text>
                {existingProduct.locations?.[0] && (
                  <Text style={styles.foundDetail}>
                    {"Section "}
                    {existingProduct.locations[0].sections?.code}
                    {", Bay "}
                    {existingProduct.locations[0].bay}
                    {", Level "}
                    {existingProduct.locations[0].level}
                    {" \u2014 Qty: "}
                    {existingProduct.locations[0].quantity}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={resetForm}>
                <FontAwesome
                  name="refresh"
                  size={16}
                  color={THEME.textSecondary}
                />
              </TouchableOpacity>
            </View>
          )}

          {lookupDone && !existingProduct && !loading && (
            <View style={styles.registerForm}>
              <Text style={styles.registerTitle}>New Product</Text>

              <Text style={styles.label}>Product Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Hickory Wide Plank Rustic"
                placeholderTextColor={THEME.textSecondary}
                value={name}
                onChangeText={setName}
              />

              <Text style={styles.label}>Category</Text>
              <TouchableOpacity
                style={styles.picker}
                onPress={() => setShowCategories(!showCategories)}
              >
                <Text style={styles.pickerText}>
                  {CATEGORIES.find((c) => c.value === category)?.label}
                </Text>
                <FontAwesome
                  name="chevron-down"
                  size={12}
                  color={THEME.textSecondary}
                />
              </TouchableOpacity>
              {showCategories && (
                <View style={styles.dropdown}>
                  {CATEGORIES.map((c) => (
                    <TouchableOpacity
                      key={c.value}
                      style={[
                        styles.dropdownItem,
                        c.value === category && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setCategory(c.value);
                        setShowCategories(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownText,
                          c.value === category && styles.dropdownTextActive,
                        ]}
                      >
                        {c.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.rowInputs}>
                <View style={{ flex: 1, marginRight: 6 }}>
                  <Text style={styles.label}>Weight</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 45 lbs"
                    placeholderTextColor={THEME.textSecondary}
                    value={weight}
                    onChangeText={setWeight}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 6 }}>
                  <Text style={styles.label}>Quantity</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="1"
                    placeholderTextColor={THEME.textSecondary}
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <Text style={styles.label}>Section</Text>
              <TouchableOpacity
                style={styles.picker}
                onPress={() => setShowSections(!showSections)}
              >
                <Text style={styles.pickerText}>
                  {selectedSection
                    ? `${selectedSection.code} \u2014 ${selectedSection.name}`
                    : "Select..."}
                </Text>
                <FontAwesome
                  name="chevron-down"
                  size={12}
                  color={THEME.textSecondary}
                />
              </TouchableOpacity>
              {showSections && (
                <View style={styles.dropdown}>
                  {sections.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[
                        styles.dropdownItem,
                        selectedSection?.id === s.id &&
                          styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedSection(s);
                        setShowSections(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownText,
                          selectedSection?.id === s.id &&
                            styles.dropdownTextActive,
                        ]}
                      >
                        {s.code} {"\u2014"} {s.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.rowInputs}>
                <View style={{ flex: 1, marginRight: 6 }}>
                  <Text style={styles.label}>Bay</Text>
                  <TextInput
                    style={styles.input}
                    value={bay}
                    onChangeText={setBay}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 6 }}>
                  <Text style={styles.label}>Level</Text>
                  <TextInput
                    style={styles.input}
                    value={level}
                    onChangeText={setLevel}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, { height: 60, textAlignVertical: "top" }]}
                placeholder="Optional..."
                placeholderTextColor={THEME.textSecondary}
                value={notes}
                onChangeText={setNotes}
                multiline
              />

              <TouchableOpacity
                style={styles.registerButton}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.registerButtonText}>
                    Register Product
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  cameraWrapper: { height: 260, backgroundColor: "#000" },
  camera: { flex: 1 },
  noCamera: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
  },
  noCameraText: { color: THEME.textSecondary, fontSize: 14, marginTop: 10 },
  permissionButton: {
    marginTop: 12,
    backgroundColor: THEME.primary,
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  permissionButtonText: { color: "#FFF", fontWeight: "600", fontSize: 14 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  crosshair: {
    width: 200,
    height: 120,
    borderWidth: 2,
    borderColor: THEME.primary,
    borderRadius: 10,
  },
  scanHint: {
    color: "#FFF",
    fontSize: 12,
    marginTop: 10,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  scannedBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    backgroundColor: "rgba(46,125,50,0.85)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  scannedText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 6,
  },
  sheet: {
    flex: 1,
    backgroundColor: THEME.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -16,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  barcodeRow: { flexDirection: "row", marginBottom: 12 },
  barcodeInput: {
    flex: 1,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.borderInput,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: THEME.textPrimary,
    marginRight: 10,
  },
  lookupButton: {
    backgroundColor: THEME.primary,
    borderRadius: 8,
    width: 46,
    justifyContent: "center",
    alignItems: "center",
  },
  scanAgainButton: {
    backgroundColor: THEME.secondary,
    borderRadius: 8,
    width: 46,
    justifyContent: "center",
    alignItems: "center",
  },
  foundCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F5E9",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  foundName: { fontSize: 15, fontWeight: "bold", color: THEME.textPrimary },
  foundDetail: { fontSize: 12, color: "#666", marginTop: 2 },
  registerForm: {
    backgroundColor: THEME.surface,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  registerTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: THEME.textPrimary,
    marginBottom: 4,
    marginTop: 10,
  },
  input: {
    backgroundColor: THEME.background,
    borderWidth: 1,
    borderColor: THEME.borderInput,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: THEME.textPrimary,
  },
  picker: {
    backgroundColor: THEME.background,
    borderWidth: 1,
    borderColor: THEME.borderInput,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pickerText: { fontSize: 14, color: THEME.textPrimary },
  dropdown: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.borderInput,
    borderRadius: 8,
    marginTop: 4,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  dropdownItemActive: { backgroundColor: "#FDF0F3" },
  dropdownText: { fontSize: 13, color: THEME.textPrimary },
  dropdownTextActive: { color: THEME.primary, fontWeight: "600" },
  rowInputs: { flexDirection: "row" },
  registerButton: {
    backgroundColor: THEME.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  registerButtonText: { color: "#FFF", fontSize: 15, fontWeight: "bold" },
});
