import { decode } from "base64-arraybuffer";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon } from "../../lib/nimbus/Icon";
import { color, layout, radius, space, type } from "../../lib/nimbus/tokens";
import { useOffline } from "../../lib/offline";
import { usePermissions } from "../../lib/permissions";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { Skeleton, haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const T = useTheme();
  const { warehouseId } = useWarehouse();
  const perms = usePermissions();
  const { isOnline, queueOperation } = useOffline();
  const insets = useSafeAreaInsets();
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
      <View style={[s.screen, { backgroundColor: T.bg }]}>
        <ScreenHeader
          title="Product"
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
        <View
          style={{
            paddingTop: space.s20,
            paddingHorizontal: layout.contentPaddingH,
          }}
        >
          <Skeleton width="40%" height={18} style={{ marginBottom: 10 }} />
          <Skeleton width="80%" height={26} style={{ marginBottom: 8 }} />
          <Skeleton width="50%" height={14} style={{ marginBottom: 24 }} />
          <Skeleton width="100%" height={100} borderRadius={0} />
        </View>
      </View>
    );

  if (!product)
    return (
      <View style={[s.centered, { backgroundColor: T.bg }]}>
        <View
          style={[
            s.emptyCircle,
            { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
          ]}
        >
          <Icon name="alert-circle" size={28} color={T.textMuted} />
        </View>
        <Text style={[s.emptyTitle, { color: T.text }]}>Product not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backLink}>
          <Text style={[type.label, { color: T.accent }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );

  const locations = product.locations || [];
  const primaryLocation = locations[0];
  const categoryLabel = (product.category || "")
    .replace("_", "/")
    .toUpperCase();
  const sectionColor = primaryLocation?.sections?.color || color.accent;
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

  return (
    <View style={[s.screen, { backgroundColor: T.bg }]}>
      <ScreenHeader
        eyebrow={categoryLabel || undefined}
        title={product.name}
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-left" size={18} color={T.text} />
          </Pressable>
        }
        trailing={
          perms.canEditProducts ? (
            <Pressable
              onPress={openEdit}
              hitSlop={10}
              accessibilityLabel="Edit product"
            >
              <Icon name="pencil" size={18} color={T.accent} />
            </Pressable>
          ) : undefined
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: space.s40 + insets.bottom }}
      >
        {/* Barcode */}
        <View style={[s.barcodeRow, { borderBottomColor: T.borderSubtle }]}>
          <Icon name="barcode" size={14} color={T.textDim} />
          <Text
            style={[type.monoSm, { color: T.textMuted, marginLeft: space.s8 }]}
          >
            {product.barcode}
          </Text>
        </View>

        {/* KPI strip */}
        <View style={[s.kpiStrip, { borderBottomColor: T.borderSubtle }]}>
          <View style={s.kpiCell}>
            <Text style={[s.kpiValue, { color: T.text }]}>
              {locations.length}
            </Text>
            <Text style={[s.kpiLabel, { color: T.textMuted }]}>
              {locations.length === 1 ? "Location" : "Locations"}
            </Text>
          </View>
          <View style={[s.kpiDivider, { backgroundColor: T.borderSubtle }]} />
          <View style={s.kpiCell}>
            <Text style={[s.kpiValue, { color: T.text }]} numberOfLines={1}>
              {primaryLocation?.sections?.code || "\u2014"}
            </Text>
            <Text style={[s.kpiLabel, { color: T.textMuted }]}>Primary</Text>
          </View>
          <View style={[s.kpiDivider, { backgroundColor: T.borderSubtle }]} />
          <View style={s.kpiCell}>
            <Text
              style={[s.kpiValue, { color: isLowStock ? T.warning : T.text }]}
            >
              {totalQty}
            </Text>
            <Text style={[s.kpiLabel, { color: T.textMuted }]}>Total Qty</Text>
          </View>
        </View>

        <View style={s.body}>
          {/* Product photo */}
          {product.photo_url ? (
            <TouchableOpacity
              style={[
                s.photoCard,
                { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
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
                <Icon name="camera" size={14} color={color.white} />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                s.addPhotoCard,
                { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
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
              <Icon name="camera" size={22} color={T.textMuted} />
              <Text style={[s.addPhotoText, { color: T.textMuted }]}>
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
                  {
                    backgroundColor: T.bgElevated,
                    borderColor: T.borderSubtle,
                  },
                ]}
              >
                <View
                  style={[
                    s.locationAccent,
                    {
                      backgroundColor: loc.sections?.color || T.accent,
                    },
                  ]}
                />
                <TouchableOpacity
                  style={{ flex: 1 }}
                  activeOpacity={0.8}
                  onPress={() => openRelocate(idx)}
                >
                  <Text style={[s.locationTitle, { color: T.text }]}>
                    {loc.sections?.code} {"\u2014"} {loc.sections?.name}
                  </Text>
                  <Text style={[s.locationSub, { color: T.textMuted }]}>
                    Bay {loc.bay}, Level {loc.level}
                  </Text>
                </TouchableOpacity>
                <View style={s.qtyControls}>
                  <TouchableOpacity
                    style={[
                      s.qtyBtn,
                      {
                        backgroundColor: T.surface2,
                        borderColor: T.borderSubtle,
                      },
                    ]}
                    onPress={() => adjustQuantity(loc.id, -1)}
                  >
                    <Icon name="minus" size={14} color={T.textMuted} />
                  </TouchableOpacity>
                  <Text style={[s.qtyDisplay, { color: T.text }]}>
                    {loc.quantity}
                  </Text>
                  <TouchableOpacity
                    style={[
                      s.qtyBtn,
                      { backgroundColor: T.accentDim, borderColor: T.accent },
                    ]}
                    onPress={() => adjustQuantity(loc.id, 1)}
                  >
                    <Icon name="plus" size={14} color={T.accent} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

          {isLowStock && (
            <View style={[s.lowStockBanner, { backgroundColor: T.dangerDim }]}>
              <Icon name="alert-circle" size={14} color={T.danger} />
              <Text style={[s.lowStockText, { color: T.danger }]}>
                Low stock — only {totalQty} unit{totalQty !== 1 ? "s" : ""}{" "}
                remaining
              </Text>
            </View>
          )}

          <Text style={[s.sectionLabel, { color: T.textMuted }]}>Details</Text>
          <View
            style={[
              s.card,
              { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
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

          <Text style={[s.sectionLabel, { color: T.textMuted }]}>Activity</Text>
          {history.length === 0 ? (
            <View
              style={[
                s.emptyCard,
                { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
              ]}
            >
              <Icon name="clipboard-list" size={22} color={T.textMuted} />
              <Text style={[s.emptyCardText, { color: T.textMuted }]}>
                No activity recorded
              </Text>
            </View>
          ) : (
            <View
              style={[
                s.card,
                { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
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
                        style={[s.historyDot, { backgroundColor: T.accent }]}
                      />
                      {!isLast && (
                        <View
                          style={[
                            s.historyLine,
                            { backgroundColor: T.borderSubtle },
                          ]}
                        />
                      )}
                    </View>
                    <View
                      style={[s.historyBody, isLast && { paddingBottom: 0 }]}
                    >
                      <Text style={[s.historyAction, { color: T.accent }]}>
                        {label}
                      </Text>
                      {item.to_location ? (
                        <Text style={[s.historyLocation, { color: T.text }]}>
                          {item.from_location
                            ? `${item.from_location} \u2192 `
                            : ""}
                          {item.to_location}
                        </Text>
                      ) : null}
                      <Text style={[s.historyTime, { color: T.textMuted }]}>
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
                { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
              ]}
            >
              <Text style={[s.dateLabel, { color: T.textMuted }]}>Added</Text>
              <Text style={[s.dateValue, { color: T.text }]}>
                {new Date(product.created_at).toLocaleDateString()}
              </Text>
            </View>
            <View
              style={[
                s.dateItem,
                { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
              ]}
            >
              <Text style={[s.dateLabel, { color: T.textMuted }]}>Updated</Text>
              <Text style={[s.dateValue, { color: T.text }]}>
                {new Date(product.updated_at).toLocaleDateString()}
              </Text>
            </View>
          </View>

          <Text style={[s.sectionLabel, { color: T.textMuted, marginTop: 4 }]}>
            Actions
          </Text>
          <View style={s.actionRow}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => openRelocate(0)}
              style={[s.relocateBtn, { backgroundColor: T.accent }]}
            >
              <Icon name="move" size={16} color={color.black} />
              <Text style={[s.relocateBtnText, { color: color.black }]}>
                Relocate
              </Text>
            </TouchableOpacity>
            {perms.canDeleteProducts && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleDelete}
                style={[
                  s.actionBtn,
                  { backgroundColor: T.dangerDim, borderColor: T.danger },
                ]}
              >
                <Icon name="trash" size={15} color={T.danger} />
                <Text style={[s.actionBtnText, { color: T.danger }]}>
                  Delete
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Relocate Modal */}
      <Modal
        visible={showRelocate}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={[s.modalScreen, { backgroundColor: T.bg }]}>
          <View style={[s.modalHeader, { borderBottomColor: T.borderSubtle }]}>
            <View
              style={[s.modalHandle, { backgroundColor: T.borderSubtle }]}
            />
            <View style={s.modalHeaderRow}>
              <TouchableOpacity
                onPress={() => setShowRelocate(false)}
                style={s.modalCloseBtn}
                hitSlop={8}
              >
                <Icon name="x" size={18} color={T.textMuted} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={[s.modalHeaderSub, { color: T.textMuted }]}>
                  Relocate
                </Text>
                <Text
                  style={[s.modalHeaderTitle, { color: T.text }]}
                  numberOfLines={1}
                >
                  {product.name}
                </Text>
              </View>
            </View>
          </View>

          <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={[s.fieldLabel, { color: T.textMuted }]}>Section</Text>
            {sections.map((sec) => (
              <TouchableOpacity
                key={sec.id}
                style={[
                  s.sectionOption,
                  {
                    backgroundColor: T.bgElevated,
                    borderColor:
                      selectedSection?.id === sec.id
                        ? T.accent
                        : T.borderSubtle,
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
                    { backgroundColor: sec.color || T.accent },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      s.sectionOptionText,
                      {
                        color:
                          selectedSection?.id === sec.id ? T.accent : T.text,
                      },
                      selectedSection?.id === sec.id && { fontWeight: "700" },
                    ]}
                  >
                    {sec.code} {"\u2014"} {sec.name}
                  </Text>
                </View>
                {selectedSection?.id === sec.id && (
                  <View style={[s.checkCircle, { backgroundColor: T.accent }]}>
                    <Icon name="check" size={12} color={color.black} />
                  </View>
                )}
              </TouchableOpacity>
            ))}

            <Text style={[s.fieldLabel, { color: T.textMuted }]}>Bay</Text>
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
                            selectedBay === num ? T.accent : T.bgElevated,
                          borderColor:
                            selectedBay === num ? T.accent : T.borderSubtle,
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
                            color: selectedBay === num ? color.black : T.text,
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

            <Text style={[s.fieldLabel, { color: T.textMuted }]}>Level</Text>
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
                            selectedLevel === num ? T.accent : T.bgElevated,
                          borderColor:
                            selectedLevel === num ? T.accent : T.borderSubtle,
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
                            color: selectedLevel === num ? color.black : T.text,
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
              <View style={[s.confirmBtn, { backgroundColor: T.accent }]}>
                {relocating ? (
                  <ActivityIndicator color={color.black} />
                ) : (
                  <>
                    <Icon name="check" size={16} color={color.black} />
                    <Text style={[s.confirmBtnText, { color: color.black }]}>
                      Move to {selectedSection?.code}-Bay{selectedBay}-L
                      {selectedLevel}
                    </Text>
                  </>
                )}
              </View>
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
        <View style={[s.modalScreen, { backgroundColor: T.bg }]}>
          <View style={[s.modalHeader, { borderBottomColor: T.borderSubtle }]}>
            <View
              style={[s.modalHandle, { backgroundColor: T.borderSubtle }]}
            />
            <View style={s.modalHeaderRow}>
              <TouchableOpacity
                onPress={() => setShowEdit(false)}
                style={s.modalCloseBtn}
                hitSlop={8}
              >
                <Icon name="x" size={18} color={T.textMuted} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={[s.modalHeaderSub, { color: T.textMuted }]}>
                  Edit
                </Text>
                <Text
                  style={[s.modalHeaderTitle, { color: T.text }]}
                  numberOfLines={1}
                >
                  {product.name}
                </Text>
              </View>
            </View>
          </View>

          <ScrollView
            style={s.modalBody}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[s.fieldLabel, { color: T.textMuted }]}>
              Product name *
            </Text>
            <TextInput
              style={[
                s.editInput,
                {
                  backgroundColor: T.bgElevated,
                  borderColor: T.borderSubtle,
                  color: T.text,
                },
              ]}
              value={editName}
              onChangeText={setEditName}
              placeholder="Product name"
              placeholderTextColor={T.textMuted}
            />

            <Text style={[s.fieldLabel, { color: T.textMuted }]}>Category</Text>
            <TouchableOpacity
              style={[
                s.editPicker,
                { backgroundColor: T.bgElevated, borderColor: T.borderSubtle },
              ]}
              onPress={() => setShowCategoryPicker(!showCategoryPicker)}
            >
              <Text style={[s.editPickerText, { color: T.text }]}>
                {CATEGORIES.find((c) => c.value === editCategory)?.label ||
                  editCategory}
              </Text>
              <Icon name="chevron-down" size={14} color={T.textMuted} />
            </TouchableOpacity>
            {showCategoryPicker && (
              <View
                style={[
                  s.editDropdown,
                  {
                    backgroundColor: T.bgElevated,
                    borderColor: T.borderSubtle,
                  },
                ]}
              >
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.value}
                    style={[
                      s.editDropdownItem,
                      { borderBottomColor: T.borderFaint },
                      c.value === editCategory && {
                        backgroundColor: T.accentDim,
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
                        { color: T.text },
                        c.value === editCategory && {
                          color: T.accent,
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
                <Text style={[s.fieldLabel, { color: T.textMuted }]}>
                  Weight
                </Text>
                <TextInput
                  style={[
                    s.editInput,
                    {
                      backgroundColor: T.bgElevated,
                      borderColor: T.borderSubtle,
                      color: T.text,
                    },
                  ]}
                  value={editWeight}
                  onChangeText={setEditWeight}
                  placeholder="e.g. 45 lbs"
                  placeholderTextColor={T.textMuted}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Text style={[s.fieldLabel, { color: T.textMuted }]}>
                  Dimensions
                </Text>
                <TextInput
                  style={[
                    s.editInput,
                    {
                      backgroundColor: T.bgElevated,
                      borderColor: T.borderSubtle,
                      color: T.text,
                    },
                  ]}
                  value={editDimensions}
                  onChangeText={setEditDimensions}
                  placeholder='e.g. 48"x6"'
                  placeholderTextColor={T.textMuted}
                />
              </View>
            </View>

            <Text style={[s.fieldLabel, { color: T.textMuted }]}>
              Manufacturer
            </Text>
            <TextInput
              style={[
                s.editInput,
                {
                  backgroundColor: T.bgElevated,
                  borderColor: T.borderSubtle,
                  color: T.text,
                },
              ]}
              value={editManufacturer}
              onChangeText={setEditManufacturer}
              placeholder="Manufacturer name"
              placeholderTextColor={T.textMuted}
            />

            <Text style={[s.fieldLabel, { color: T.textMuted }]}>
              Reorder point
            </Text>
            <TextInput
              style={[
                s.editInput,
                {
                  backgroundColor: T.bgElevated,
                  borderColor: T.borderSubtle,
                  color: T.text,
                },
              ]}
              value={editReorderPoint}
              onChangeText={setEditReorderPoint}
              placeholder="0"
              placeholderTextColor={T.textMuted}
              keyboardType="number-pad"
            />

            <Text style={[s.fieldLabel, { color: T.textMuted }]}>Notes</Text>
            <TextInput
              style={[
                s.editInput,
                {
                  backgroundColor: T.bgElevated,
                  borderColor: T.borderSubtle,
                  color: T.text,
                  height: 80,
                  textAlignVertical: "top",
                },
              ]}
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder="Optional notes..."
              placeholderTextColor={T.textMuted}
              multiline
            />

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={saveEdit}
              disabled={savingEdit}
              style={{ marginTop: 16 }}
            >
              <View style={[s.confirmBtn, { backgroundColor: T.accent }]}>
                {savingEdit ? (
                  <ActivityIndicator color={color.black} />
                ) : (
                  <>
                    <Icon name="check" size={16} color={color.black} />
                    <Text style={[s.confirmBtnText, { color: color.black }]}>
                      Save Changes
                    </Text>
                  </>
                )}
              </View>
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
  label,
  value,
  isLast,
}: {
  T: any;
  icon?: string;
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        s.detailRow,
        !isLast && {
          borderBottomWidth: layout.hairlineWidth,
          borderBottomColor: T.borderFaint,
        },
      ]}
    >
      <Text style={[s.detailLabel, { color: T.textMuted }]}>{label}</Text>
      <Text style={[s.detailValue, { color: T.text }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },

  // Identity
  barcodeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: layout.contentPaddingH,
    paddingVertical: space.s12,
    borderBottomWidth: layout.hairlineWidth,
  },

  // KPI strip
  kpiStrip: {
    flexDirection: "row",
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
    fontWeight: "700",
  },
  kpiLabel: { ...type.labelSm, marginTop: 4 },

  body: { paddingHorizontal: layout.contentPaddingH, paddingTop: space.s20 },

  // Photo
  photoCard: {
    overflow: "hidden",
    marginBottom: space.s12,
    borderWidth: layout.hairlineWidth,
    position: "relative",
  },
  productPhoto: { width: "100%", height: 200 },
  photoOverlay: {
    position: "absolute",
    bottom: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: color.blackAlpha.a6,
    justifyContent: "center",
    alignItems: "center",
  },
  addPhotoCard: {
    borderWidth: layout.hairlineWidth,
    borderStyle: "dashed",
    paddingVertical: space.s24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.s12,
  },
  addPhotoText: { ...type.bodySm, marginTop: space.s8 },

  // Location cards
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    marginBottom: space.s12,
    borderWidth: layout.hairlineWidth,
  },
  locationAccent: { width: 4, alignSelf: "stretch" },
  locationTitle: {
    ...type.body,
    fontWeight: "700",
    padding: space.s16,
    paddingBottom: 2,
  },
  locationSub: {
    ...type.monoSm,
    paddingHorizontal: space.s16,
    paddingBottom: space.s16,
  },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: space.s12,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderWidth: layout.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
  },
  qtyDisplay: {
    ...type.monoBody,
    fontSize: 18,
    minWidth: 36,
    textAlign: "center",
  },

  lowStockBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: space.s12,
    marginBottom: space.s16,
    gap: space.s8,
  },
  lowStockText: { ...type.bodySm, fontWeight: "500" },

  sectionLabel: {
    ...type.label,
    marginBottom: space.s8,
    marginLeft: 2,
    marginTop: space.s8,
  },

  card: {
    borderWidth: layout.hairlineWidth,
    marginBottom: space.s20,
    overflow: "hidden",
  },

  // Detail rows (key / value)
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.s12,
    paddingHorizontal: space.s16,
  },
  detailLabel: { ...type.label, flex: 1 },
  detailValue: {
    ...type.body,
    fontWeight: "500",
    textAlign: "right",
    maxWidth: "55%",
  },

  // Activity / history
  emptyCard: {
    borderWidth: layout.hairlineWidth,
    padding: space.s24,
    alignItems: "center",
    marginBottom: space.s20,
  },
  emptyCardText: { ...type.bodySm, marginTop: space.s8 },
  historyItem: { flexDirection: "row", minHeight: 50 },
  historyTrack: {
    width: 28,
    alignItems: "center",
    paddingHorizontal: space.s16,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    zIndex: 1,
    marginTop: 4,
  },
  historyLine: { flex: 1, width: 1 },
  historyBody: { flex: 1, paddingLeft: 4, paddingBottom: space.s16 },
  historyAction: { ...type.label },
  historyLocation: { ...type.monoSm, marginTop: 2 },
  historyTime: { ...type.monoSm, marginTop: 2 },

  dateRow: { flexDirection: "row", gap: space.s12, marginBottom: space.s12 },
  dateItem: { flex: 1, borderWidth: layout.hairlineWidth, padding: space.s16 },
  dateLabel: { ...type.labelSm, marginBottom: 4 },
  dateValue: { ...type.body, fontWeight: "600" },

  // Actions
  actionRow: {
    flexDirection: "row",
    gap: space.s12,
    marginBottom: space.s20,
    marginTop: space.s8,
  },
  relocateBtn: {
    flex: 1,
    paddingVertical: space.s16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s8,
  },
  relocateBtnText: { ...type.body, fontWeight: "700" },
  actionBtn: {
    flex: 0.7,
    paddingVertical: space.s16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: layout.hairlineWidth,
    gap: space.s8,
  },
  actionBtnText: { ...type.bodySm, fontWeight: "600" },

  // Not-found
  emptyCircle: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: layout.hairlineWidth,
    marginBottom: space.s16,
  },
  emptyTitle: { ...type.displayXs },
  backLink: { marginTop: space.s12 },

  // Modals
  modalScreen: { flex: 1 },
  modalHeader: {
    paddingTop: space.s12,
    paddingBottom: space.s16,
    paddingHorizontal: layout.contentPaddingH,
    borderBottomWidth: layout.hairlineWidth,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    alignSelf: "center",
    marginBottom: space.s16,
  },
  modalHeaderRow: { flexDirection: "row", alignItems: "center" },
  modalCloseBtn: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    marginRight: space.s12,
  },
  modalHeaderSub: { ...type.label },
  modalHeaderTitle: { ...type.displayMd, marginTop: 2 },
  modalBody: {
    flex: 1,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s20,
  },

  fieldLabel: {
    ...type.label,
    marginBottom: space.s8,
    marginTop: space.s16,
    marginLeft: 2,
  },
  sectionOption: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: space.s8,
    borderWidth: layout.hairlineWidth,
    overflow: "hidden",
  },
  sectionColorBar: { width: 4, alignSelf: "stretch" },
  sectionOptionText: { ...type.body, padding: space.s16 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    marginRight: space.s12,
  },
  numberScroll: { maxHeight: 48 },
  numBtn: {
    width: 46,
    height: 46,
    borderWidth: layout.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
    marginRight: space.s8,
  },
  numBtnText: { ...type.monoBody, fontSize: 16, fontWeight: "600" },
  confirmBtn: {
    paddingVertical: space.s16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s8,
    marginTop: space.s8,
  },
  confirmBtnText: { ...type.body, fontWeight: "700" },

  // Edit form
  editInput: {
    borderWidth: layout.hairlineWidth,
    paddingHorizontal: space.s16,
    paddingVertical: 11,
    fontFamily: type.body.fontFamily,
    fontSize: 14,
    marginBottom: space.s8,
  },
  editPicker: {
    borderWidth: layout.hairlineWidth,
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space.s8,
  },
  editPickerText: { ...type.body },
  editDropdown: {
    borderWidth: layout.hairlineWidth,
    marginBottom: space.s8,
    overflow: "hidden",
  },
  editDropdownItem: {
    paddingHorizontal: space.s16,
    paddingVertical: 11,
    borderBottomWidth: layout.hairlineWidth,
  },
  editDropdownText: { ...type.bodySm },
});
