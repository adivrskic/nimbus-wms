import FontAwesome from "@expo/vector-icons/FontAwesome";
import { decode } from "base64-arraybuffer";
import { CameraView, useCameraPermissions } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ScreenHeader, useHeaderScroll } from "../../lib/Header";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

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

function Crosshair({ scanned, T }: { scanned: boolean; T: any }) {
  const color = scanned ? T.success : T.primary;
  const size = 220;
  const cornerLen = 30;
  const thickness = 3;
  const radius = 12;
  return (
    <View style={{ width: size, height: size * 0.55 }}>
      <View style={{ position: "absolute", top: 0, left: 0 }}>
        <View
          style={{
            width: cornerLen,
            height: thickness,
            backgroundColor: color,
            borderTopLeftRadius: radius,
          }}
        />
        <View
          style={{
            width: thickness,
            height: cornerLen,
            backgroundColor: color,
            borderTopLeftRadius: radius,
          }}
        />
      </View>
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          alignItems: "flex-end",
        }}
      >
        <View
          style={{
            width: cornerLen,
            height: thickness,
            backgroundColor: color,
            borderTopRightRadius: radius,
          }}
        />
        <View
          style={{
            width: thickness,
            height: cornerLen,
            backgroundColor: color,
            borderTopRightRadius: radius,
            alignSelf: "flex-end",
          }}
        />
      </View>
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            width: thickness,
            height: cornerLen,
            backgroundColor: color,
            borderBottomLeftRadius: radius,
          }}
        />
        <View
          style={{
            width: cornerLen,
            height: thickness,
            backgroundColor: color,
            borderBottomLeftRadius: radius,
          }}
        />
      </View>
      <View
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          alignItems: "flex-end",
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            width: thickness,
            height: cornerLen,
            backgroundColor: color,
            borderBottomRightRadius: radius,
            alignSelf: "flex-end",
          }}
        />
        <View
          style={{
            width: cornerLen,
            height: thickness,
            backgroundColor: color,
            borderBottomRightRadius: radius,
          }}
        />
      </View>
    </View>
  );
}

export default function ScannerScreen() {
  const wh = useWarehouse();
  const router = useRouter();
  const T = useTheme();

  const { scrollY, onScroll } = useHeaderScroll();

  const [barcode, setBarcode] = useState("");
  const [lookupDone, setLookupDone] = useState(false);
  const [existingProduct, setExistingProduct] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [flashOn, setFlashOn] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const successOpacity = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0.8)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

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
  const scanScale = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef<any>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, []);

  // Reset form when warehouse changes
  useEffect(() => {
    setBarcode("");
    setLookupDone(false);
    setExistingProduct(null);
    setName("");
    setCategory("hardwood");
    setWeight("");
    setQuantity("1");
    setNotes("");
    setSections([]);
    setSelectedSection(null);
    setBay("1");
    setLevel("1");
    setScanned(false);
    setFlashOn(false);
    setShowSuccess(false);
    setPhotoUri(null);
    setPhotoBase64(null);
  }, [wh.warehouseId]);

  function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);
    setBarcode(data);
    haptic.success();
    scanScale.setValue(0);
    Animated.spring(scanScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 14,
      bounciness: 8,
    }).start();
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
      setShowSuccess(true);
      successOpacity.setValue(0);
      successScale.setValue(0.8);
      checkScale.setValue(0);
      Animated.parallel([
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(successScale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 14,
          bounciness: 6,
        }),
      ]).start(() => {
        Animated.spring(checkScale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 10,
          bounciness: 12,
        }).start();
      });
    } else {
      setExistingProduct(null);
      setLookupDone(true);
      const { data: secs } = await supabase
        .from("sections")
        .select("id, code, name")
        .eq("warehouse_id", wh.warehouseId)
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
    haptic.medium();
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
    haptic.medium();
    if (!wh.warehouseId) {
      Alert.alert("Error", "No warehouse selected.");
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
    // Upload photo if taken
    const photoUrl = await uploadPhoto(product.id);
    if (photoUrl) {
      await supabase
        .from("products")
        .update({ photo_url: photoUrl })
        .eq("id", product.id);
    }
    const { error: locErr } = await supabase.from("locations").insert({
      product_id: product.id,
      section_id: selectedSection.id,
      warehouse_id: wh.warehouseId,
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
      warehouse_id: wh.warehouseId,
      scanned_by: user?.id,
      action: "register",
      to_location: `${selectedSection.code}-Bay${bay}-L${level}`,
    });
    haptic.success();
    Alert.alert(
      "Success",
      `${name} registered in Section ${selectedSection.code}, Bay ${bay}, Level ${level}.`
    );
    resetForm();
    setLoading(false);
  }

  function dismissSuccess() {
    haptic.light();
    Animated.timing(successOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setShowSuccess(false));
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
    setFlashOn(false);
    setPhotoUri(null);
    setPhotoBase64(null);
  }

  async function takePhoto() {
    if (!cameraRef.current) return;
    haptic.medium();
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
      });
      if (photo?.uri) {
        setPhotoUri(photo.uri);
        setPhotoBase64(photo.base64 || null);
      }
    } catch (e) {
      console.warn("Photo capture failed:", e);
    }
  }

  async function uploadPhoto(productId: string): Promise<string | null> {
    if (!photoBase64) return null;
    try {
      const filePath = `${productId}.jpg`;
      const { error } = await supabase.storage
        .from("product-photos")
        .upload(filePath, decode(photoBase64), {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (error) {
        console.warn("Photo upload failed:", error.message);
        return null;
      }
      const { data } = supabase.storage
        .from("product-photos")
        .getPublicUrl(filePath);
      return data.publicUrl;
    } catch (e) {
      console.warn("Photo upload error:", e);
      return null;
    }
  }

  const cameraReady = permission?.granted;
  const badgeScale = scanScale.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });
  const dropdownBg = T.mode === "dark" ? "rgba(255,255,255,0.05)" : "#F0F0F0";
  const dropdownActiveBg = T.primary + "08";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader {...wh} scrollY={scrollY} />

      <View style={s.cameraWrapper}>
        {cameraReady ? (
          <CameraView
            ref={cameraRef}
            style={s.camera}
            enableTorch={flashOn}
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
          <View style={s.noCamera}>
            <FontAwesome name="camera" size={30} color="#555" />
            <Text style={s.noCameraText}>Camera permission required</Text>
            <TouchableOpacity
              style={[s.permissionButton, { backgroundColor: T.primary }]}
              onPress={requestPermission}
            >
              <Text style={s.permissionButtonText}>Grant Access</Text>
            </TouchableOpacity>
          </View>
        )}
        {cameraReady && (
          <View style={s.overlay}>
            <Crosshair scanned={scanned} T={T} />
            {!scanned && (
              <Text style={s.scanHint}>Point at a barcode to scan</Text>
            )}
            {scanned && (
              <Animated.View
                style={[
                  s.scannedBadge,
                  {
                    backgroundColor: T.success,
                    transform: [{ scale: badgeScale }],
                  },
                ]}
              >
                <FontAwesome name="check-circle" size={14} color="#FFF" />
                <Text style={s.scannedText}>{barcode}</Text>
              </Animated.View>
            )}
            <TouchableOpacity
              style={[s.flashBtn, flashOn && s.flashBtnOn]}
              onPress={() => {
                haptic.light();
                setFlashOn(!flashOn);
              }}
            >
              <FontAwesome
                name="bolt"
                size={16}
                color={flashOn ? "#FFD600" : "rgba(255,255,255,0.6)"}
              />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Bottom sheet */}
      <View style={[s.sheet, { backgroundColor: T.background }]}>
        <View
          style={[
            s.sheetHandle,
            {
              backgroundColor:
                T.mode === "dark" ? "rgba(255,255,255,0.15)" : "#DDD",
            },
          ]}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <View style={s.barcodeRow}>
            <View
              style={[
                s.barcodeInputWrap,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              <FontAwesome
                name="barcode"
                size={14}
                color={T.textSecondary}
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={[s.barcodeInput, { color: T.textPrimary }]}
                placeholder="Type barcode manually..."
                placeholderTextColor={T.textSecondary}
                value={barcode}
                onChangeText={(t) => {
                  setBarcode(t);
                  setLookupDone(false);
                  setExistingProduct(null);
                  setScanned(false);
                }}
                autoCapitalize="none"
              />
            </View>
            {scanned ? (
              <TouchableOpacity
                style={[s.scanAgainButton, { backgroundColor: T.secondary }]}
                onPress={() => {
                  haptic.light();
                  resetForm();
                }}
              >
                <FontAwesome name="refresh" size={15} color="#FFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.lookupButton, { backgroundColor: T.primary }]}
                onPress={handleLookup}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <FontAwesome name="arrow-right" size={15} color="#FFF" />
                )}
              </TouchableOpacity>
            )}
          </View>

          {loading && (
            <ActivityIndicator
              color={T.primary}
              style={{ marginVertical: 12 }}
            />
          )}

          {/* Found product */}
          {lookupDone && existingProduct && !showSuccess && (
            <TouchableOpacity
              style={[
                s.foundCard,
                {
                  backgroundColor: T.surface,
                  borderColor: T.success + "30",
                  borderLeftColor: T.success,
                },
              ]}
              activeOpacity={0.8}
              onPress={() => {
                haptic.light();
                router.push(`/product/${existingProduct.id}`);
              }}
            >
              <View style={[s.foundIconCircle, { backgroundColor: T.success }]}>
                <FontAwesome name="check" size={16} color="#FFF" />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[s.foundName, { color: T.textPrimary }]}>
                  {existingProduct.name}
                </Text>
                <Text style={[s.foundDetail, { color: T.textSecondary }]}>
                  {existingProduct.category?.replace("_", "/").toUpperCase()}{" "}
                  {"\u2022"} {existingProduct.barcode}
                </Text>
                {existingProduct.locations?.[0] && (
                  <View style={s.foundLocationRow}>
                    <FontAwesome
                      name="map-marker"
                      size={10}
                      color={T.primary}
                    />
                    <Text style={[s.foundLocation, { color: T.primary }]}>
                      {existingProduct.locations[0].sections?.code}-Bay
                      {existingProduct.locations[0].bay}-L
                      {existingProduct.locations[0].level}
                    </Text>
                    <Text style={[s.foundQty, { color: T.textSecondary }]}>
                      Qty: {existingProduct.locations[0].quantity}
                    </Text>
                  </View>
                )}
              </View>
              <FontAwesome
                name="chevron-right"
                size={12}
                color={T.textSecondary}
              />
            </TouchableOpacity>
          )}

          {lookupDone && existingProduct && (
            <TouchableOpacity
              style={s.scanAgainPrompt}
              onPress={() => {
                haptic.light();
                resetForm();
              }}
            >
              <FontAwesome name="camera" size={13} color={T.primary} />
              <Text style={[s.scanAgainPromptText, { color: T.primary }]}>
                Scan another product
              </Text>
            </TouchableOpacity>
          )}

          {/* Registration form */}
          {lookupDone && !existingProduct && !loading && (
            <View
              style={[
                s.registerForm,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              <View style={s.registerHeader}>
                <View style={[s.registerBadge, { backgroundColor: T.primary }]}>
                  <FontAwesome name="plus" size={10} color="#FFF" />
                </View>
                <Text style={[s.registerTitle, { color: T.textPrimary }]}>
                  New Product
                </Text>
              </View>

              <Text style={[s.label, { color: T.textPrimary }]}>
                Product Name *
              </Text>
              <TextInput
                style={[
                  s.input,
                  {
                    backgroundColor: T.background,
                    borderColor: T.borderInput,
                    color: T.textPrimary,
                  },
                ]}
                placeholder="e.g. Hickory Wide Plank Rustic"
                placeholderTextColor={T.textSecondary}
                value={name}
                onChangeText={setName}
              />

              <Text style={[s.label, { color: T.textPrimary }]}>Category</Text>
              <TouchableOpacity
                style={[
                  s.picker,
                  { backgroundColor: T.background, borderColor: T.borderInput },
                ]}
                onPress={() => setShowCategories(!showCategories)}
              >
                <Text style={[s.pickerText, { color: T.textPrimary }]}>
                  {CATEGORIES.find((c) => c.value === category)?.label}
                </Text>
                <FontAwesome
                  name="chevron-down"
                  size={12}
                  color={T.textSecondary}
                />
              </TouchableOpacity>
              {showCategories && (
                <View
                  style={[
                    s.dropdown,
                    { backgroundColor: T.surface, borderColor: T.borderInput },
                  ]}
                >
                  {CATEGORIES.map((c) => (
                    <TouchableOpacity
                      key={c.value}
                      style={[
                        s.dropdownItem,
                        { borderBottomColor: dropdownBg },
                        c.value === category && {
                          backgroundColor: dropdownActiveBg,
                        },
                      ]}
                      onPress={() => {
                        setCategory(c.value);
                        setShowCategories(false);
                        haptic.selection();
                      }}
                    >
                      <Text
                        style={[
                          s.dropdownText,
                          { color: T.textPrimary },
                          c.value === category && {
                            color: T.primary,
                            fontWeight: "600",
                          },
                        ]}
                      >
                        {c.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={s.rowInputs}>
                <View style={{ flex: 1, marginRight: 6 }}>
                  <Text style={[s.label, { color: T.textPrimary }]}>
                    Weight
                  </Text>
                  <TextInput
                    style={[
                      s.input,
                      {
                        backgroundColor: T.background,
                        borderColor: T.borderInput,
                        color: T.textPrimary,
                      },
                    ]}
                    placeholder="e.g. 45 lbs"
                    placeholderTextColor={T.textSecondary}
                    value={weight}
                    onChangeText={setWeight}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 6 }}>
                  <Text style={[s.label, { color: T.textPrimary }]}>
                    Quantity
                  </Text>
                  <TextInput
                    style={[
                      s.input,
                      {
                        backgroundColor: T.background,
                        borderColor: T.borderInput,
                        color: T.textPrimary,
                      },
                    ]}
                    placeholder="1"
                    placeholderTextColor={T.textSecondary}
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <Text style={[s.label, { color: T.textPrimary }]}>Section</Text>
              <TouchableOpacity
                style={[
                  s.picker,
                  { backgroundColor: T.background, borderColor: T.borderInput },
                ]}
                onPress={() => setShowSections(!showSections)}
              >
                <Text style={[s.pickerText, { color: T.textPrimary }]}>
                  {selectedSection
                    ? `${selectedSection.code} \u2014 ${selectedSection.name}`
                    : "Select..."}
                </Text>
                <FontAwesome
                  name="chevron-down"
                  size={12}
                  color={T.textSecondary}
                />
              </TouchableOpacity>
              {showSections && (
                <View
                  style={[
                    s.dropdown,
                    { backgroundColor: T.surface, borderColor: T.borderInput },
                  ]}
                >
                  {sections.map((sec) => (
                    <TouchableOpacity
                      key={sec.id}
                      style={[
                        s.dropdownItem,
                        { borderBottomColor: dropdownBg },
                        selectedSection?.id === sec.id && {
                          backgroundColor: dropdownActiveBg,
                        },
                      ]}
                      onPress={() => {
                        setSelectedSection(sec);
                        setShowSections(false);
                        haptic.selection();
                      }}
                    >
                      <Text
                        style={[
                          s.dropdownText,
                          { color: T.textPrimary },
                          selectedSection?.id === sec.id && {
                            color: T.primary,
                            fontWeight: "600",
                          },
                        ]}
                      >
                        {sec.code} {"\u2014"} {sec.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={s.rowInputs}>
                <View style={{ flex: 1, marginRight: 6 }}>
                  <Text style={[s.label, { color: T.textPrimary }]}>Bay</Text>
                  <TextInput
                    style={[
                      s.input,
                      {
                        backgroundColor: T.background,
                        borderColor: T.borderInput,
                        color: T.textPrimary,
                      },
                    ]}
                    value={bay}
                    onChangeText={setBay}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 6 }}>
                  <Text style={[s.label, { color: T.textPrimary }]}>Level</Text>
                  <TextInput
                    style={[
                      s.input,
                      {
                        backgroundColor: T.background,
                        borderColor: T.borderInput,
                        color: T.textPrimary,
                      },
                    ]}
                    value={level}
                    onChangeText={setLevel}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <Text style={[s.label, { color: T.textPrimary }]}>Photo</Text>
              {photoUri ? (
                <View style={s.photoPreviewWrap}>
                  <Image
                    source={{ uri: photoUri }}
                    style={s.photoPreview}
                    resizeMode="cover"
                  />
                  <View style={s.photoActions}>
                    <TouchableOpacity
                      style={[
                        s.photoBtn,
                        {
                          backgroundColor: T.background,
                          borderColor: T.border,
                        },
                      ]}
                      onPress={() => setPhotoUri(null)}
                    >
                      <FontAwesome name="trash-o" size={13} color={T.danger} />
                      <Text style={[s.photoBtnText, { color: T.danger }]}>
                        Remove
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        s.photoBtn,
                        {
                          backgroundColor: T.primary + "10",
                          borderColor: T.primary + "30",
                        },
                      ]}
                      onPress={takePhoto}
                    >
                      <FontAwesome name="camera" size={13} color={T.primary} />
                      <Text style={[s.photoBtnText, { color: T.primary }]}>
                        Retake
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[
                    s.photoCapture,
                    {
                      backgroundColor: T.background,
                      borderColor: T.borderInput,
                    },
                  ]}
                  onPress={takePhoto}
                  activeOpacity={0.7}
                >
                  <FontAwesome
                    name="camera"
                    size={18}
                    color={T.textSecondary}
                  />
                  <Text
                    style={[s.photoCaptureText, { color: T.textSecondary }]}
                  >
                    Tap to take product photo
                  </Text>
                </TouchableOpacity>
              )}

              <Text style={[s.label, { color: T.textPrimary }]}>Notes</Text>
              <TextInput
                style={[
                  s.input,
                  {
                    backgroundColor: T.background,
                    borderColor: T.borderInput,
                    color: T.textPrimary,
                    height: 60,
                    textAlignVertical: "top",
                  },
                ]}
                placeholder="Optional..."
                placeholderTextColor={T.textSecondary}
                value={notes}
                onChangeText={setNotes}
                multiline
              />

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleRegister}
                disabled={loading}
                style={{ marginTop: 16 }}
              >
                <LinearGradient
                  colors={T.headerGradient}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={s.registerButton}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <FontAwesome
                        name="check-circle"
                        size={16}
                        color="#FFF"
                        style={{ marginRight: 8 }}
                      />
                      <Text style={s.registerButtonText}>Register Product</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
      </View>

      {/* Success overlay */}
      {showSuccess && existingProduct && (
        <Animated.View style={[s.successOverlay, { opacity: successOpacity }]}>
          <Animated.View
            style={[s.successContent, { transform: [{ scale: successScale }] }]}
          >
            <Animated.View
              style={[s.successCheck, { transform: [{ scale: checkScale }] }]}
            >
              <View
                style={[s.successCheckInner, { backgroundColor: T.success }]}
              >
                <FontAwesome name="check" size={28} color="#FFF" />
              </View>
            </Animated.View>
            <Text style={s.successTitle}>Product found</Text>
            <Text style={s.successProductName}>{existingProduct.name}</Text>
            <View style={s.successCard}>
              <View style={s.successCardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.successCardLabel}>Location</Text>
                  <Text style={s.successCardValue}>
                    {existingProduct.locations?.[0]
                      ? `${existingProduct.locations[0].sections?.code}-Bay${existingProduct.locations[0].bay}-L${existingProduct.locations[0].level}`
                      : "Unassigned"}
                  </Text>
                </View>
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={s.successCardLabel}>Quantity</Text>
                  <Text style={s.successCardValue}>
                    {existingProduct.locations?.[0]?.quantity || 0} units
                  </Text>
                </View>
              </View>
              <View style={s.successDivider} />
              <View style={s.successCardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.successCardLabel}>Category</Text>
                  <Text style={s.successCardValue}>
                    {existingProduct.category?.replace("_", "/").toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={s.successCardLabel}>Barcode</Text>
                  <Text style={s.successCardValue}>
                    {existingProduct.barcode}
                  </Text>
                </View>
              </View>
            </View>
            <View style={s.successActions}>
              <TouchableOpacity
                style={s.successBtnPrimary}
                activeOpacity={0.85}
                onPress={() => {
                  dismissSuccess();
                  setTimeout(
                    () => router.push(`/product/${existingProduct.id}`),
                    250
                  );
                }}
              >
                <LinearGradient
                  colors={T.headerGradient}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={s.successBtnGradient}
                >
                  <FontAwesome
                    name="eye"
                    size={14}
                    color="#FFF"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={s.successBtnPrimaryText}>View product</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.successBtnSecondary}
                activeOpacity={0.7}
                onPress={() => {
                  dismissSuccess();
                  setTimeout(() => resetForm(), 250);
                }}
              >
                <FontAwesome
                  name="camera"
                  size={13}
                  color="rgba(255,255,255,0.6)"
                  style={{ marginRight: 8 }}
                />
                <Text style={s.successBtnSecondaryText}>Scan another</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  cameraWrapper: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  noCamera: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111",
  },
  noCameraText: { color: "#666", fontSize: 14, marginTop: 12 },
  permissionButton: {
    marginTop: 14,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  permissionButtonText: { color: "#FFF", fontWeight: "700", fontSize: 14 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanHint: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    marginTop: 14,
    fontWeight: "500",
  },
  scannedBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  scannedText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    marginLeft: 8,
  },
  flashBtn: {
    position: "absolute",
    top: 36,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  flashBtnOn: { backgroundColor: "rgba(0,0,0,0.7)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "65%",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 14,
  },
  barcodeRow: { flexDirection: "row", marginBottom: 14 },
  barcodeInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginRight: 10,
  },
  barcodeInput: { flex: 1, paddingVertical: 12, fontSize: 15 },
  lookupButton: {
    borderRadius: 12,
    width: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  scanAgainButton: {
    borderRadius: 12,
    width: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  foundCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  foundIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  foundName: { fontSize: 15, fontWeight: "bold" },
  foundDetail: { fontSize: 11, marginTop: 2 },
  foundLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 5,
  },
  foundLocation: { fontSize: 11, fontWeight: "600", marginLeft: 4 },
  foundQty: { fontSize: 11, marginLeft: 10 },
  scanAgainPrompt: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    marginBottom: 8,
  },
  scanAgainPromptText: { fontSize: 14, fontWeight: "600", marginLeft: 8 },
  registerForm: { borderRadius: 14, padding: 18, borderWidth: 1 },
  registerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  registerBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  registerTitle: { fontSize: 17, fontWeight: "bold" },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 4, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
  },
  picker: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pickerText: { fontSize: 14 },
  dropdown: { borderWidth: 1, borderRadius: 10, marginTop: 4 },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  dropdownText: { fontSize: 13 },
  rowInputs: { flexDirection: "row" },
  registerButton: {
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  registerButtonText: { color: "#FFF", fontSize: 15, fontWeight: "bold" },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
    paddingHorizontal: 32,
  },
  successContent: { alignItems: "center", width: "100%" },
  successCheck: { marginBottom: 20 },
  successCheckInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.15)",
  },
  successTitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.5)",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  successProductName: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#FFF",
    textAlign: "center",
    marginBottom: 24,
  },
  successCard: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 18,
    marginBottom: 28,
  },
  successCardRow: { flexDirection: "row", justifyContent: "space-between" },
  successCardLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.35)",
    marginBottom: 4,
  },
  successCardValue: { fontSize: 15, fontWeight: "600", color: "#FFF" },
  successDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginVertical: 14,
  },
  successActions: { width: "100%", gap: 10 },
  successBtnPrimary: { borderRadius: 14, overflow: "hidden" },
  successBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 14,
  },
  successBtnPrimaryText: { fontSize: 15, fontWeight: "bold", color: "#FFF" },
  successBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  successBtnSecondaryText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.6)",
  },
  photoCapture: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  photoCaptureText: { fontSize: 13, marginTop: 8 },
  photoPreviewWrap: { marginBottom: 4 },
  photoPreview: {
    width: "100%",
    height: 160,
    borderRadius: 12,
    marginBottom: 8,
  },
  photoActions: { flexDirection: "row", gap: 8 },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    paddingVertical: 8,
    borderWidth: 1,
    gap: 6,
  },
  photoBtnText: { fontSize: 12, fontWeight: "600" },
});
