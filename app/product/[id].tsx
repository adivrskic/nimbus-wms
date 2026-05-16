import FontAwesome from "@expo/vector-icons/FontAwesome";
import { decode } from "base64-arraybuffer";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useOffline } from "../../lib/offline";
import { usePermissions } from "../../lib/permissions";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { Skeleton, haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

const STATUS_BAR = Platform.OS === "ios" ? 54 : 36;
const HEADER_FULL = 260;
const HEADER_COMPACT = STATUS_BAR + 110;
const SCROLL_RANGE = 120;

const CATEGORY_ICONS: Record<string, string> = {
  hardwood: "tree",
  laminate: "clone",
  vinyl_lvp: "square",
  tile: "th",
  carpet: "ellipsis-h",
  underlayment: "minus",
  adhesive: "tint",
  trim_molding: "minus",
  tools: "wrench",
  accessories: "puzzle-piece",
  other: "cube",
};

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const T = useTheme();
  const { warehouseId } = useWarehouse();
  const perms = usePermissions();
  const { isOnline, queueOperation } = useOffline();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [showRelocate, setShowRelocate] = useState(false);
  const [sections, setSections] = useState<any[]>([]);
  const [selectedSection, setSelectedSection] = useState<any>(null);
  const [selectedBay, setSelectedBay] = useState(1);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [relocating, setRelocating] = useState(false);
  const [relocateLocationIdx, setRelocateLocationIdx] = useState(0);

  // Edit product state
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editDimensions, setEditDimensions] = useState("");
  const [editManufacturer, setEditManufacturer] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editReorderPoint, setEditReorderPoint] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  useEffect(() => {
    loadProduct();
    loadHistory();
  }, [id]);

  async function loadProduct() {
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select(
        "*, locations(*, sections(code, name, color, total_bays, total_levels))"
      )
      .eq("id", id)
      .single();
    setProduct(data);
    setLoading(false);
  }

  async function loadHistory() {
    const { data } = await supabase
      .from("scan_history")
      .select("*")
      .eq("product_id", id)
      .order("scanned_at", { ascending: false })
      .limit(6);
    setHistory(data || []);
  }

  async function openRelocate(locationIdx: number = 0) {
    haptic.medium();
    setRelocateLocationIdx(locationIdx);
    const { data: secs } = await supabase
      .from("sections")
      .select("id, code, name, color, total_bays, total_levels")
      .eq("warehouse_id", warehouseId)
      .order("code");
    setSections(secs || []);
    const currentLoc = product?.locations?.[locationIdx];
    if (currentLoc && secs) {
      const current = secs.find((sec: any) => sec.id === currentLoc.section_id);
      setSelectedSection(current || secs[0]);
      setSelectedBay(currentLoc.bay);
      setSelectedLevel(currentLoc.level);
    } else if (secs && secs.length > 0) setSelectedSection(secs[0]);
    setShowRelocate(true);
  }

  async function handleRelocate() {
    if (!selectedSection) return;
    const currentLoc = product?.locations?.[relocateLocationIdx];
    if (!currentLoc) {
      Alert.alert("Error", "No current location found.");
      return;
    }
    setRelocating(true);
    haptic.medium();
    const fromStr = `${currentLoc.sections?.code}-Bay${currentLoc.bay}-L${currentLoc.level}`;
    const toStr = `${selectedSection.code}-Bay${selectedBay}-L${selectedLevel}`;

    if (!isOnline) {
      await queueOperation({
        type: "relocate",
        warehouseId: warehouseId || "",
        payload: {
          locationId: currentLoc.id,
          newSectionId: selectedSection.id,
          newBay: selectedBay,
          newLevel: selectedLevel,
          productId: product.id,
          fromLocationLabel: fromStr,
          toLocationLabel: toStr,
        },
      });
      haptic.success();
      Alert.alert(
        "Queued offline",
        `Relocation will sync when you're back online.`
      );
      setShowRelocate(false);
      setRelocating(false);
      return;
    }

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
      warehouse_id: warehouseId,
      scanned_by: user?.id,
      action: "relocate",
      from_location: fromStr,
      to_location: toStr,
    });
    haptic.success();
    Alert.alert(
      "Relocated",
      `Moved to Section ${selectedSection.code}, Bay ${selectedBay}, Level ${selectedLevel}.`
    );
    setShowRelocate(false);
    setRelocating(false);
    loadProduct();
    loadHistory();
  }

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

  async function adjustQuantity(locationId: string, delta: number) {
    const loc = product?.locations?.find((l: any) => l.id === locationId);
    if (!loc) return;
    haptic.medium();

    if (!isOnline) {
      await queueOperation({
        type: "adjust",
        warehouseId: warehouseId || "",
        payload: { locationId, delta, productId: product.id },
      });
      // Optimistic update
      const newQty = Math.max(0, loc.quantity + delta);
      setProduct((prev: any) => ({
        ...prev,
        locations: prev.locations.map((l: any) =>
          l.id === locationId ? { ...l, quantity: newQty } : l
        ),
      }));
      return;
    }

    const newQty = Math.max(0, loc.quantity + delta);
    const { error } = await supabase
      .from("locations")
      .update({ quantity: newQty })
      .eq("id", locationId);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("scan_history").insert({
      product_id: product.id,
      warehouse_id: warehouseId,
      scanned_by: user?.id,
      action: "adjust",
      quantity: delta,
      notes: `${delta > 0 ? "+" : ""}${delta} (${loc.quantity} → ${newQty})`,
    });
    loadProduct();
    loadHistory();
  }

  function openEdit() {
    haptic.light();
    setEditName(product.name || "");
    setEditCategory(product.category || "other");
    setEditWeight(product.weight || "");
    setEditDimensions(product.dimensions || "");
    setEditManufacturer(product.manufacturer || "");
    setEditNotes(product.notes || "");
    setEditReorderPoint(product.reorder_point?.toString() || "");
    setShowCategoryPicker(false);
    setShowEdit(true);
  }

  async function saveEdit() {
    if (!editName.trim()) {
      Alert.alert("Error", "Product name is required.");
      return;
    }
    setSavingEdit(true);
    haptic.medium();
    const { error } = await supabase
      .from("products")
      .update({
        name: editName.trim(),
        category: editCategory,
        weight: editWeight.trim() || null,
        dimensions: editDimensions.trim() || null,
        manufacturer: editManufacturer.trim() || null,
        notes: editNotes.trim() || null,
        reorder_point: editReorderPoint ? parseInt(editReorderPoint) || 0 : 0,
      })
      .eq("id", product.id);
    setSavingEdit(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    haptic.success();
    setShowEdit(false);
    loadProduct();
  }

  function handleDelete() {
    Alert.alert(
      "Delete Product",
      `Are you sure you want to delete "${product.name}"? This will also remove all location and scan history data. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            haptic.heavy();
            const { error } = await supabase
              .from("products")
              .delete()
              .eq("id", product.id);
            if (error) {
              Alert.alert("Error", error.message);
              return;
            }
            router.back();
          },
        },
      ]
    );
  }

  async function changePhoto() {
    haptic.light();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert("Error", "Could not read image data");
      return;
    }
    try {
      const filePath = `${product.id}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("product-photos")
        .upload(filePath, decode(asset.base64), {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (uploadErr) {
        Alert.alert("Error", uploadErr.message);
        return;
      }
      const { data: urlData } = supabase.storage
        .from("product-photos")
        .getPublicUrl(filePath);
      const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      await supabase
        .from("products")
        .update({ photo_url: photoUrl })
        .eq("id", product.id);
      haptic.success();
      loadProduct();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to upload photo");
    }
  }

  async function takeNewPhoto() {
    haptic.light();
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert("Error", "Could not read image data");
      return;
    }
    try {
      const filePath = `${product.id}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("product-photos")
        .upload(filePath, decode(asset.base64), {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (uploadErr) {
        Alert.alert("Error", uploadErr.message);
        return;
      }
      const { data: urlData } = supabase.storage
        .from("product-photos")
        .getPublicUrl(filePath);
      const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      await supabase
        .from("products")
        .update({ photo_url: photoUrl })
        .eq("id", product.id);
      haptic.success();
      loadProduct();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to upload photo");
    }
  }

  if (loading)
    return (
      <View style={[s.screen, { backgroundColor: T.background }]}>
        <View style={{ paddingTop: STATUS_BAR + 20, paddingHorizontal: 20 }}>
          <Skeleton width="40%" height={18} style={{ marginBottom: 10 }} />
          <Skeleton width="80%" height={26} style={{ marginBottom: 8 }} />
          <Skeleton width="50%" height={14} style={{ marginBottom: 24 }} />
          <Skeleton width="100%" height={100} borderRadius={14} />
        </View>
      </View>
    );

  if (!product)
    return (
      <View style={[s.centered, { backgroundColor: T.background }]}>
        <View
          style={[
            s.emptyCircle,
            { backgroundColor: T.surface, borderColor: T.border },
          ]}
        >
          <FontAwesome
            name="exclamation-triangle"
            size={28}
            color={T.textSecondary}
          />
        </View>
        <Text style={[s.emptyTitle, { color: T.textPrimary }]}>
          Product not found
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backLink}>
          <Text style={[s.backLinkText, { color: T.primary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );

  const locations = product.locations || [];
  const primaryLocation = locations[0];
  const categoryLabel = (product.category || "")
    .replace("_", "/")
    .toUpperCase();
  const categoryIcon = CATEGORY_ICONS[product.category] || "cube";
  const sectionColor = primaryLocation?.sections?.color || T.primary;
  const totalQty = locations.reduce(
    (sum: number, loc: any) => sum + (loc.quantity || 0),
    0
  );
  const isLowStock = totalQty <= 5 && totalQty > 0;
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
  const statsHeight = scrollY.interpolate({
    inputRange: [0, SCROLL_RANGE * 0.6],
    outputRange: [90, 0],
    extrapolate: "clamp",
  });
  const statsOpacity = scrollY.interpolate({
    inputRange: [0, SCROLL_RANGE * 0.4],
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
      {/* Fixed header */}
      <Animated.View style={[s.headerWrap, { height: headerHeight }]}>
        <LinearGradient
          colors={[sectionColor, T.secondary]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={s.headerGradient}
        >
          <View style={s.headerTop}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <FontAwesome name="arrow-left" size={16} color="#FFF" />
            </TouchableOpacity>
            <View style={s.headerBadge}>
              <FontAwesome
                name={categoryIcon as any}
                size={10}
                color="#FFF"
                style={{ marginRight: 5 }}
              />
              <Text style={s.headerBadgeText}>{categoryLabel}</Text>
            </View>
          </View>

          <Animated.Text
            style={[s.headerName, { fontSize: nameFontSize }]}
            numberOfLines={1}
          >
            {product.name}
          </Animated.Text>

          <View style={s.headerBarcode}>
            <FontAwesome
              name="barcode"
              size={12}
              color="rgba(255,255,255,0.5)"
            />
            <Text style={s.headerBarcodeText}>{product.barcode}</Text>
          </View>

          <Animated.View
            style={{
              opacity: statsOpacity,
              height: statsHeight,
              overflow: "hidden",
            }}
          >
            {locations.length > 0 ? (
              <View style={s.headerStats}>
                <View style={s.headerStat}>
                  <Text style={s.headerStatNum}>{locations.length}</Text>
                  <Text style={s.headerStatLabel}>
                    {locations.length === 1 ? "Location" : "Locations"}
                  </Text>
                </View>
                <View style={s.headerStatDiv} />
                <View style={s.headerStat}>
                  <Text style={s.headerStatNum}>
                    {primaryLocation.sections?.code}
                  </Text>
                  <Text style={s.headerStatLabel}>Primary</Text>
                </View>
                <View style={s.headerStatDiv} />
                <View style={s.headerStat}>
                  <Text
                    style={[
                      s.headerStatNum,
                      isLowStock && { color: "#FFCDD2" },
                    ]}
                  >
                    {totalQty}
                  </Text>
                  <Text style={s.headerStatLabel}>Total Qty</Text>
                </View>
              </View>
            ) : (
              <Text
                style={{
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 13,
                  marginTop: 10,
                }}
              >
                No location assigned
              </Text>
            )}
          </Animated.View>
        </LinearGradient>
      </Animated.View>

      {/* Scrollable content behind header */}
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: HEADER_FULL, paddingBottom: 120 }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
      >
        <View style={s.body}>
          {/* Product photo */}
          {product.photo_url ? (
            <TouchableOpacity
              style={[
                s.photoCard,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
              activeOpacity={0.8}
              onPress={() => {
                Alert.alert("Change Photo", "Choose a source", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Camera", onPress: takeNewPhoto },
                  { text: "Photo Library", onPress: changePhoto },
                ]);
              }}
            >
              <Image
                source={{ uri: product.photo_url }}
                style={s.productPhoto}
                resizeMode="cover"
              />
              <View style={s.photoOverlay}>
                <FontAwesome name="camera" size={12} color="#FFF" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                s.addPhotoCard,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
              activeOpacity={0.7}
              onPress={() => {
                Alert.alert("Add Photo", "Choose a source", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Camera", onPress: takeNewPhoto },
                  { text: "Photo Library", onPress: changePhoto },
                ]);
              }}
            >
              <FontAwesome name="camera" size={20} color={T.textSecondary} />
              <Text style={[s.addPhotoText, { color: T.textSecondary }]}>
                Add product photo
              </Text>
            </TouchableOpacity>
          )}

          {locations.length > 0 &&
            locations.map((loc: any, idx: number) => (
              <View
                key={loc.id}
                style={[
                  s.locationCard,
                  { backgroundColor: T.surface, borderColor: T.border },
                ]}
              >
                <View
                  style={[
                    s.locationAccent,
                    {
                      backgroundColor: loc.sections?.color || T.primary,
                    },
                  ]}
                />
                <TouchableOpacity
                  style={{ flex: 1 }}
                  activeOpacity={0.8}
                  onPress={() => openRelocate(idx)}
                >
                  <Text style={[s.locationTitle, { color: T.textPrimary }]}>
                    {loc.sections?.code} {"\u2014"} {loc.sections?.name}
                  </Text>
                  <Text style={[s.locationSub, { color: T.textSecondary }]}>
                    Bay {loc.bay}, Level {loc.level}
                  </Text>
                </TouchableOpacity>
                <View style={s.qtyControls}>
                  <TouchableOpacity
                    style={[
                      s.qtyBtn,
                      { backgroundColor: T.background, borderColor: T.border },
                    ]}
                    onPress={() => adjustQuantity(loc.id, -1)}
                  >
                    <FontAwesome
                      name="minus"
                      size={10}
                      color={T.textSecondary}
                    />
                  </TouchableOpacity>
                  <Text style={[s.qtyDisplay, { color: T.textPrimary }]}>
                    {loc.quantity}
                  </Text>
                  <TouchableOpacity
                    style={[
                      s.qtyBtn,
                      {
                        backgroundColor: T.primary + "12",
                        borderColor: T.primary + "30",
                      },
                    ]}
                    onPress={() => adjustQuantity(loc.id, 1)}
                  >
                    <FontAwesome name="plus" size={10} color={T.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

          {isLowStock && (
            <View
              style={[s.lowStockBanner, { backgroundColor: T.danger + "10" }]}
            >
              <FontAwesome
                name="exclamation-triangle"
                size={13}
                color={T.danger}
              />
              <Text style={[s.lowStockText, { color: T.danger }]}>
                Low stock — only {totalQty} unit{totalQty !== 1 ? "s" : ""}{" "}
                remaining
              </Text>
            </View>
          )}

          <Text style={[s.sectionLabel, { color: T.textSecondary }]}>
            Details
          </Text>
          <View
            style={[
              s.card,
              { backgroundColor: T.surface, borderColor: T.border },
            ]}
          >
            <DetailRow
              T={T}
              icon="balance-scale"
              label="Weight"
              value={product.weight || "\u2014"}
            />
            <DetailRow
              T={T}
              icon="arrows-alt"
              label="Dimensions"
              value={product.dimensions || "\u2014"}
            />
            <DetailRow
              T={T}
              icon="industry"
              label="Manufacturer"
              value={product.manufacturer || "\u2014"}
            />
            <DetailRow
              T={T}
              icon="tag"
              label="Internal SKU"
              value={product.internal_sku || "\u2014"}
            />
            <DetailRow
              T={T}
              icon="exclamation-circle"
              label="Reorder point"
              value={product.reorder_point?.toString() || "\u2014"}
            />
            {product.notes ? (
              <DetailRow
                T={T}
                icon="sticky-note-o"
                label="Notes"
                value={product.notes}
                isLast
              />
            ) : null}
          </View>

          <Text style={[s.sectionLabel, { color: T.textSecondary }]}>
            Activity
          </Text>
          {history.length === 0 ? (
            <View
              style={[
                s.emptyCard,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              <FontAwesome name="clock-o" size={22} color={T.textSecondary} />
              <Text style={[s.emptyCardText, { color: T.textSecondary }]}>
                No activity recorded
              </Text>
            </View>
          ) : (
            <View
              style={[
                s.card,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              {history.map((item, index) => {
                const time = new Date(item.scanned_at);
                const dateStr = time.toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                });
                const timeStr = time.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const label = ACTION_LABELS[item.action] || item.action;
                const isLast = index === history.length - 1;
                return (
                  <View key={item.id} style={s.historyItem}>
                    <View style={s.historyTrack}>
                      <View
                        style={[s.historyDot, { backgroundColor: T.primary }]}
                      />
                      {!isLast && (
                        <View
                          style={[s.historyLine, { backgroundColor: T.border }]}
                        />
                      )}
                    </View>
                    <View
                      style={[s.historyBody, isLast && { paddingBottom: 0 }]}
                    >
                      <Text style={[s.historyAction, { color: T.primary }]}>
                        {label}
                      </Text>
                      {item.to_location ? (
                        <Text
                          style={[s.historyLocation, { color: T.textPrimary }]}
                        >
                          {item.from_location
                            ? `${item.from_location} \u2192 `
                            : ""}
                          {item.to_location}
                        </Text>
                      ) : null}
                      <Text style={[s.historyTime, { color: T.textSecondary }]}>
                        {dateStr} {"\u2022"} {timeStr}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <View style={s.dateRow}>
            <View
              style={[
                s.dateItem,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              <Text style={[s.dateLabel, { color: T.textSecondary }]}>
                Added
              </Text>
              <Text style={[s.dateValue, { color: T.textPrimary }]}>
                {new Date(product.created_at).toLocaleDateString()}
              </Text>
            </View>
            <View
              style={[
                s.dateItem,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              <Text style={[s.dateLabel, { color: T.textSecondary }]}>
                Updated
              </Text>
              <Text style={[s.dateValue, { color: T.textPrimary }]}>
                {new Date(product.updated_at).toLocaleDateString()}
              </Text>
            </View>
          </View>

          <Text
            style={[s.sectionLabel, { color: T.textSecondary, marginTop: 4 }]}
          >
            Actions
          </Text>
          <View style={s.actionRow}>
            {perms.canEditProducts && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={openEdit}
                style={[
                  s.actionBtn,
                  { backgroundColor: T.surface, borderColor: T.border },
                ]}
              >
                <FontAwesome name="pencil" size={15} color={T.primary} />
                <Text style={[s.actionBtnText, { color: T.primary }]}>
                  Edit
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => openRelocate(0)}
              style={{ flex: 1 }}
            >
              <LinearGradient
                colors={[T.secondary, "#0f2240"]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={s.relocateBtn}
              >
                <FontAwesome
                  name="arrows"
                  size={15}
                  color="#FFF"
                  style={{ marginRight: 8 }}
                />
                <Text style={s.relocateBtnText}>Relocate</Text>
              </LinearGradient>
            </TouchableOpacity>
            {perms.canDeleteProducts && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleDelete}
                style={[
                  s.actionBtn,
                  {
                    backgroundColor: T.danger + "08",
                    borderColor: T.danger + "20",
                  },
                ]}
              >
                <FontAwesome name="trash-o" size={15} color={T.danger} />
                <Text style={[s.actionBtnText, { color: T.danger }]}>
                  Delete
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.ScrollView>

      {/* Relocate Modal */}
      <Modal
        visible={showRelocate}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={[s.modalScreen, { backgroundColor: T.background }]}>
          <LinearGradient
            colors={[selectedSection?.color || T.primary, T.secondary]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={s.modalHeader}
          >
            <View style={s.modalHandle} />
            <View style={s.modalHeaderRow}>
              <TouchableOpacity
                onPress={() => setShowRelocate(false)}
                style={s.modalCloseBtn}
              >
                <FontAwesome
                  name="times"
                  size={16}
                  color="rgba(255,255,255,0.6)"
                />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={s.modalHeaderSub}>Relocate</Text>
                <Text style={s.modalHeaderTitle}>{product.name}</Text>
              </View>
            </View>
          </LinearGradient>

          <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
              Section
            </Text>
            {sections.map((sec) => (
              <TouchableOpacity
                key={sec.id}
                style={[
                  s.sectionOption,
                  {
                    backgroundColor: T.surface,
                    borderColor:
                      selectedSection?.id === sec.id ? T.primary : T.border,
                  },
                ]}
                onPress={() => {
                  haptic.selection();
                  setSelectedSection(sec);
                  setSelectedBay(1);
                  setSelectedLevel(1);
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    s.sectionColorBar,
                    { backgroundColor: sec.color || T.primary },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      s.sectionOptionText,
                      {
                        color:
                          selectedSection?.id === sec.id
                            ? T.primary
                            : T.textPrimary,
                      },
                      selectedSection?.id === sec.id && { fontWeight: "700" },
                    ]}
                  >
                    {sec.code} {"\u2014"} {sec.name}
                  </Text>
                </View>
                {selectedSection?.id === sec.id && (
                  <View style={[s.checkCircle, { backgroundColor: T.primary }]}>
                    <FontAwesome name="check" size={10} color="#FFF" />
                  </View>
                )}
              </TouchableOpacity>
            ))}

            <Text style={[s.fieldLabel, { color: T.textSecondary }]}>Bay</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.numberScroll}
            >
              {Array.from(
                { length: selectedSection?.total_bays || 5 },
                (_, i) => {
                  const num = i + 1;
                  return (
                    <TouchableOpacity
                      key={num}
                      style={[
                        s.numBtn,
                        {
                          backgroundColor:
                            selectedBay === num ? T.primary : T.surface,
                          borderColor:
                            selectedBay === num ? T.primary : T.border,
                        },
                      ]}
                      onPress={() => {
                        haptic.selection();
                        setSelectedBay(num);
                      }}
                    >
                      <Text
                        style={[
                          s.numBtnText,
                          {
                            color: selectedBay === num ? "#FFF" : T.textPrimary,
                          },
                        ]}
                      >
                        {num}
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )}
            </ScrollView>

            <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
              Level
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.numberScroll}
            >
              {Array.from(
                { length: selectedSection?.total_levels || 3 },
                (_, i) => {
                  const num = i + 1;
                  return (
                    <TouchableOpacity
                      key={num}
                      style={[
                        s.numBtn,
                        {
                          backgroundColor:
                            selectedLevel === num ? T.primary : T.surface,
                          borderColor:
                            selectedLevel === num ? T.primary : T.border,
                        },
                      ]}
                      onPress={() => {
                        haptic.selection();
                        setSelectedLevel(num);
                      }}
                    >
                      <Text
                        style={[
                          s.numBtnText,
                          {
                            color:
                              selectedLevel === num ? "#FFF" : T.textPrimary,
                          },
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
              activeOpacity={0.85}
              onPress={handleRelocate}
              disabled={relocating}
              style={{ marginTop: 24 }}
            >
              <LinearGradient
                colors={[selectedSection?.color || T.primary, T.secondary]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={s.confirmBtn}
              >
                {relocating ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <FontAwesome
                      name="check-circle"
                      size={16}
                      color="#FFF"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={s.confirmBtnText}>
                      Move to {selectedSection?.code}-Bay{selectedBay}-L
                      {selectedLevel}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* Edit Product Modal */}
      <Modal
        visible={showEdit}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={[s.modalScreen, { backgroundColor: T.background }]}>
          <LinearGradient
            colors={[sectionColor, T.secondary]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={s.modalHeader}
          >
            <View style={s.modalHandle} />
            <View style={s.modalHeaderRow}>
              <TouchableOpacity
                onPress={() => setShowEdit(false)}
                style={s.modalCloseBtn}
              >
                <FontAwesome
                  name="times"
                  size={16}
                  color="rgba(255,255,255,0.6)"
                />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={s.modalHeaderSub}>Edit</Text>
                <Text style={s.modalHeaderTitle}>{product.name}</Text>
              </View>
            </View>
          </LinearGradient>

          <ScrollView
            style={s.modalBody}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
              Product name *
            </Text>
            <TextInput
              style={[
                s.editInput,
                {
                  backgroundColor: T.surface,
                  borderColor: T.borderInput,
                  color: T.textPrimary,
                },
              ]}
              value={editName}
              onChangeText={setEditName}
              placeholder="Product name"
              placeholderTextColor={T.textSecondary}
            />

            <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
              Category
            </Text>
            <TouchableOpacity
              style={[
                s.editPicker,
                { backgroundColor: T.surface, borderColor: T.borderInput },
              ]}
              onPress={() => setShowCategoryPicker(!showCategoryPicker)}
            >
              <Text style={[s.editPickerText, { color: T.textPrimary }]}>
                {CATEGORIES.find((c) => c.value === editCategory)?.label ||
                  editCategory}
              </Text>
              <FontAwesome
                name="chevron-down"
                size={12}
                color={T.textSecondary}
              />
            </TouchableOpacity>
            {showCategoryPicker && (
              <View
                style={[
                  s.editDropdown,
                  { backgroundColor: T.surface, borderColor: T.borderInput },
                ]}
              >
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.value}
                    style={[
                      s.editDropdownItem,
                      { borderBottomColor: T.border },
                      c.value === editCategory && {
                        backgroundColor: T.primary + "08",
                      },
                    ]}
                    onPress={() => {
                      setEditCategory(c.value);
                      setShowCategoryPicker(false);
                      haptic.selection();
                    }}
                  >
                    <Text
                      style={[
                        s.editDropdownText,
                        { color: T.textPrimary },
                        c.value === editCategory && {
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

            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
                  Weight
                </Text>
                <TextInput
                  style={[
                    s.editInput,
                    {
                      backgroundColor: T.surface,
                      borderColor: T.borderInput,
                      color: T.textPrimary,
                    },
                  ]}
                  value={editWeight}
                  onChangeText={setEditWeight}
                  placeholder="e.g. 45 lbs"
                  placeholderTextColor={T.textSecondary}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
                  Dimensions
                </Text>
                <TextInput
                  style={[
                    s.editInput,
                    {
                      backgroundColor: T.surface,
                      borderColor: T.borderInput,
                      color: T.textPrimary,
                    },
                  ]}
                  value={editDimensions}
                  onChangeText={setEditDimensions}
                  placeholder='e.g. 48"x6"'
                  placeholderTextColor={T.textSecondary}
                />
              </View>
            </View>

            <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
              Manufacturer
            </Text>
            <TextInput
              style={[
                s.editInput,
                {
                  backgroundColor: T.surface,
                  borderColor: T.borderInput,
                  color: T.textPrimary,
                },
              ]}
              value={editManufacturer}
              onChangeText={setEditManufacturer}
              placeholder="Manufacturer name"
              placeholderTextColor={T.textSecondary}
            />

            <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
              Reorder point
            </Text>
            <TextInput
              style={[
                s.editInput,
                {
                  backgroundColor: T.surface,
                  borderColor: T.borderInput,
                  color: T.textPrimary,
                },
              ]}
              value={editReorderPoint}
              onChangeText={setEditReorderPoint}
              placeholder="0"
              placeholderTextColor={T.textSecondary}
              keyboardType="number-pad"
            />

            <Text style={[s.fieldLabel, { color: T.textSecondary }]}>
              Notes
            </Text>
            <TextInput
              style={[
                s.editInput,
                {
                  backgroundColor: T.surface,
                  borderColor: T.borderInput,
                  color: T.textPrimary,
                  height: 80,
                  textAlignVertical: "top",
                },
              ]}
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder="Optional notes..."
              placeholderTextColor={T.textSecondary}
              multiline
            />

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={saveEdit}
              disabled={savingEdit}
              style={{ marginTop: 16 }}
            >
              <LinearGradient
                colors={[sectionColor, T.secondary]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={s.confirmBtn}
              >
                {savingEdit ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <FontAwesome
                      name="check-circle"
                      size={16}
                      color="#FFF"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={s.confirmBtnText}>Save Changes</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({
  T,
  icon,
  label,
  value,
  isLast,
}: {
  T: any;
  icon: string;
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        s.detailRow,
        !isLast && {
          borderBottomWidth: 1,
          borderBottomColor:
            T.mode === "dark" ? "rgba(255,255,255,0.05)" : "#F2F2F2",
        },
      ]}
    >
      <View style={[s.detailIconWrap, { backgroundColor: T.primary + "10" }]}>
        <FontAwesome name={icon as any} size={12} color={T.primary} />
      </View>
      <Text style={[s.detailLabel, { color: T.textSecondary }]}>{label}</Text>
      <Text style={[s.detailValue, { color: T.textPrimary }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  headerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerGradient: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: STATUS_BAR,
    marginBottom: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  headerBadgeText: { color: "#FFF", fontSize: 10, fontWeight: "bold" },
  headerName: { fontWeight: "bold", color: "#FFF", marginBottom: 4 },
  headerBarcode: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerBarcodeText: { fontSize: 13, color: "rgba(255,255,255,0.5)" },
  headerStats: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 8,
  },
  headerStat: { flex: 1, alignItems: "center" },
  headerStatNum: { fontSize: 20, fontWeight: "bold", color: "#FFF" },
  headerStatLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
    marginTop: 2,
  },
  headerStatDiv: { width: 1, backgroundColor: "rgba(255,255,255,0.12)" },
  body: { paddingHorizontal: 20, paddingTop: 20 },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: 1,
  },
  locationAccent: { width: 5, alignSelf: "stretch" },
  locationTitle: {
    fontSize: 15,
    fontWeight: "bold",
    padding: 14,
    paddingBottom: 2,
  },
  locationSub: { fontSize: 12, paddingHorizontal: 14, paddingBottom: 14 },
  locationAction: { alignItems: "center", paddingRight: 16 },
  locationActionText: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  lowStockBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  lowStockText: { fontSize: 13, fontWeight: "500" },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 4,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
    overflow: "hidden",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  detailIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  detailLabel: { flex: 1, fontSize: 14 },
  detailValue: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "right",
    maxWidth: "50%",
  },
  historyItem: { flexDirection: "row", minHeight: 50 },
  historyTrack: { width: 28, alignItems: "center", paddingHorizontal: 16 },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    zIndex: 1,
    marginTop: 4,
  },
  historyLine: { flex: 1, width: 1 },
  historyBody: { flex: 1, paddingLeft: 4, paddingBottom: 16 },
  historyAction: {
    fontSize: 13,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  historyLocation: { fontSize: 12, marginTop: 2 },
  historyTime: { fontSize: 11, marginTop: 2 },
  dateRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  dateItem: { flex: 1, borderRadius: 12, padding: 14, borderWidth: 1 },
  dateLabel: { fontSize: 11, marginBottom: 2 },
  dateValue: { fontSize: 14, fontWeight: "600" },
  relocateBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  relocateBtnText: { color: "#FFF", fontSize: 15, fontWeight: "bold" },
  emptyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: "bold" },
  backLink: { marginTop: 12 },
  backLinkText: { fontSize: 14, fontWeight: "600" },
  emptyCard: {
    borderRadius: 14,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    marginBottom: 20,
  },
  emptyCardText: { fontSize: 13, marginTop: 10 },
  modalScreen: { flex: 1 },
  modalHeader: {
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeaderRow: { flexDirection: "row", alignItems: "center" },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  modalHeaderSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.5)",
    fontWeight: "600",
  },
  modalHeaderTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#FFF",
    marginTop: 2,
  },
  modalBody: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
    marginLeft: 4,
  },
  sectionOption: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    marginBottom: 6,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionColorBar: { width: 5, alignSelf: "stretch" },
  sectionOptionText: { fontSize: 14, padding: 14 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  numberScroll: { maxHeight: 48 },
  numBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  numBtnText: { fontSize: 16, fontWeight: "600" },
  confirmBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnText: { color: "#FFF", fontSize: 15, fontWeight: "bold" },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12,
  },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  qtyDisplay: {
    fontSize: 18,
    fontWeight: "bold",
    minWidth: 36,
    textAlign: "center",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  actionBtn: {
    flex: 0.7,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    gap: 6,
  },
  actionBtnText: { fontSize: 13, fontWeight: "600" },
  editInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    marginBottom: 8,
  },
  editPicker: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  editPickerText: { fontSize: 14 },
  editDropdown: {
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 8,
    overflow: "hidden",
  },
  editDropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  editDropdownText: { fontSize: 13 },
  photoCard: {
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: 1,
    position: "relative",
  },
  productPhoto: {
    width: "100%",
    height: 200,
  },
  photoOverlay: {
    position: "absolute",
    bottom: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  addPhotoCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  addPhotoText: { fontSize: 13, marginTop: 8 },
});
