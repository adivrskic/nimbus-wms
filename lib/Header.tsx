import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { usePermissions } from "./permissions";
import { supabase } from "./supabase";
import { useTheme } from "./theme";
import { Skeleton, haptic } from "./ui";

const { height: SCREEN_H } = Dimensions.get("window");
const STATUS_BAR = Platform.OS === "ios" ? 54 : 36;
const HEADER_TALL = 240;
const HEADER_SHORT = 155;
const HEADER_COMPACT = STATUS_BAR + 44;
const SCROLL_RANGE = 80;

export function useHeaderScroll() {
  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false }
  );
  return { scrollY, onScroll };
}

export function ScreenHeader({
  greeting,
  userName,
  warehouseName,
  warehouseAddress,
  warehouseId,
  accessibleWarehouses,
  switchWarehouse,
  createWarehouse,
  scrollY,
  contractedStats,
  loading,
  onWarehouseSwitch,
}: {
  greeting: string;
  userName: string;
  warehouseName: string;
  warehouseAddress?: string;
  warehouseId?: string;
  accessibleWarehouses?: any[];
  switchWarehouse?: (id: string) => Promise<void>;
  createWarehouse?: (fields: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  scrollY?: Animated.Value;
  contractedStats?: { products: number; sections: number; stock: number };
  loading?: boolean;
  onWarehouseSwitch?: () => void;
}) {
  const T = useTheme();
  const perms = usePermissions();
  const [expanded, setExpanded] = useState(false);
  const expandAnim = useRef(new Animated.Value(0)).current;

  // Stats for expanded view (loaded on expand for screens without contractedStats)
  const [expandedStats, setExpandedStats] = useState({
    products: 0,
    sections: 0,
    stock: 0,
  });

  useEffect(() => {
    if (expanded && warehouseId) {
      if (contractedStats) {
        setExpandedStats(contractedStats);
      } else {
        loadExpandedStats();
      }
    }
  }, [expanded, warehouseId, contractedStats]);

  async function loadExpandedStats() {
    const [{ data: locs }, { count: sectionCount }] = await Promise.all([
      supabase
        .from("locations")
        .select("product_id, quantity")
        .eq("warehouse_id", warehouseId),
      supabase
        .from("sections")
        .select("*", { count: "exact", head: true })
        .eq("warehouse_id", warehouseId),
    ]);
    const allLocs = locs || [];
    setExpandedStats({
      products: new Set(allLocs.map((l: any) => l.product_id)).size,
      sections: sectionCount || 0,
      stock: allLocs.reduce(
        (sum: number, l: any) => sum + (l.quantity || 0),
        0
      ),
    });
  }

  // Add warehouse form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newZip, setNewZip] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setNewName("");
    setNewAddress("");
    setNewCity("");
    setNewState("");
    setNewZip("");
    setNewPhone("");
    setShowAddForm(false);
  }

  async function handleAddWarehouse() {
    if (!newName.trim()) {
      Alert.alert("Error", "Warehouse name is required.");
      return;
    }
    if (!createWarehouse) return;
    setSaving(true);
    haptic.medium();
    const result = await createWarehouse({
      name: newName.trim(),
      address: newAddress.trim() || undefined,
      city: newCity.trim() || undefined,
      state: newState.trim() || undefined,
      zip: newZip.trim() || undefined,
      phone: newPhone.trim() || undefined,
    });
    setSaving(false);
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to create warehouse.");
      return;
    }
    haptic.success();
    resetForm();
    Animated.timing(expandAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: false,
    }).start(() => setExpanded(false));
    onWarehouseSwitch?.();
  }

  const hasStats = !!contractedStats;
  const collapsedHeight = hasStats ? HEADER_TALL : HEADER_SHORT;
  const scroll = scrollY || new Animated.Value(0);

  const headerHeight = expanded
    ? expandAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [collapsedHeight, SCREEN_H],
      })
    : hasStats
    ? collapsedHeight
    : scroll.interpolate({
        inputRange: [0, SCROLL_RANGE],
        outputRange: [HEADER_SHORT, HEADER_COMPACT],
        extrapolate: "clamp",
      });

  const detailsOpacity = hasStats
    ? 1
    : scroll.interpolate({
        inputRange: [0, SCROLL_RANGE * 0.4],
        outputRange: [1, 0],
        extrapolate: "clamp",
      });

  const nameFontSize = hasStats
    ? 22
    : scroll.interpolate({
        inputRange: [0, SCROLL_RANGE],
        outputRange: [22, 17],
        extrapolate: "clamp",
      });

  const expandedOpacity = expandAnim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
  });

  function toggleExpanded() {
    haptic.medium();
    if (!expanded) {
      setShowAddForm(false);
      setExpanded(true);
      Animated.spring(expandAnim, {
        toValue: 1,
        useNativeDriver: false,
        speed: 12,
        bounciness: 2,
      }).start();
    } else {
      Animated.timing(expandAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start(() => {
        setExpanded(false);
        setShowAddForm(false);
      });
    }
  }

  const warehouses = accessibleWarehouses || [];
  const stats = contractedStats || expandedStats;

  return (
    <Animated.View
      style={[
        s.headerWrapper,
        { height: headerHeight },
        expanded && s.headerWrapperExpanded,
      ]}
    >
      <LinearGradient
        colors={T.headerGradient}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={s.headerGradient}
      >
        {/* Contracted header */}
        <TouchableOpacity
          activeOpacity={0.95}
          onPress={toggleExpanded}
          style={s.headerTouchable}
        >
          {loading ? (
            <View style={s.headerContent}>
              <Skeleton
                width={160}
                height={14}
                style={{ opacity: 0.3, marginBottom: 6 }}
              />
              <Skeleton
                width={220}
                height={24}
                style={{ opacity: 0.3, marginBottom: 4 }}
              />
              <Skeleton width={140} height={12} style={{ opacity: 0.3 }} />
            </View>
          ) : (
            <View style={s.headerContent}>
              <View style={s.headerRow}>
                <View style={{ flex: 1 }}>
                  <Animated.View style={{ opacity: detailsOpacity }}>
                    <Text style={s.greetingText}>
                      {greeting}, {userName}
                    </Text>
                  </Animated.View>
                  <Animated.Text
                    style={[s.warehouseName, { fontSize: nameFontSize }]}
                    numberOfLines={1}
                  >
                    {warehouseName || ""}
                  </Animated.Text>
                  {warehouseAddress ? (
                    <Animated.View style={{ opacity: detailsOpacity }}>
                      <Text style={s.warehouseAddr}>{warehouseAddress}</Text>
                    </Animated.View>
                  ) : null}
                </View>
                <View style={s.plusCircle}>
                  <FontAwesome
                    name={expanded ? "times" : "plus"}
                    size={15}
                    color="rgba(255,255,255,0.7)"
                  />
                </View>
              </View>
            </View>
          )}
          {/* Stats strip — only in contracted state when contractedStats provided */}
          {hasStats && !loading && (
            <View style={s.statsStrip}>
              <View style={s.statItem}>
                <Text style={s.statNum}>{contractedStats!.products}</Text>
                <Text style={s.statLbl}>Products</Text>
              </View>
              <View style={s.statDiv} />
              <View style={s.statItem}>
                <Text style={s.statNum}>{contractedStats!.sections}</Text>
                <Text style={s.statLbl}>Sections</Text>
              </View>
              <View style={s.statDiv} />
              <View style={s.statItem}>
                <Text style={s.statNum}>{contractedStats!.stock}</Text>
                <Text style={s.statLbl}>Stock</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* Expanded warehouse list — identical on every screen */}
        {expanded && (
          <Animated.View style={[s.expandedWrap, { opacity: expandedOpacity }]}>
            {/* Stats row — only on screens without contracted stats */}
            {!hasStats && (
              <View style={s.statsStrip}>
                <View style={s.statItem}>
                  <Text style={s.statNum}>{stats.products}</Text>
                  <Text style={s.statLbl}>Products</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.statItem}>
                  <Text style={s.statNum}>{stats.sections}</Text>
                  <Text style={s.statLbl}>Sections</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.statItem}>
                  <Text style={s.statNum}>{stats.stock}</Text>
                  <Text style={s.statLbl}>Stock</Text>
                </View>
              </View>
            )}

            <View style={s.expandDivider} />

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              {warehouses.map((wh) => (
                <TouchableOpacity
                  key={wh.id}
                  style={[s.whItem, wh.id === warehouseId && s.whItemActive]}
                  activeOpacity={0.7}
                  onPress={async () => {
                    haptic.selection();
                    if (wh.id !== warehouseId && switchWarehouse) {
                      await switchWarehouse(wh.id);
                      Animated.timing(expandAnim, {
                        toValue: 0,
                        duration: 250,
                        useNativeDriver: false,
                      }).start(() => setExpanded(false));
                      onWarehouseSwitch?.();
                    }
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.whName}>{wh.name}</Text>
                    {wh.address ? (
                      <Text style={s.whAddr}>{wh.address}</Text>
                    ) : null}
                  </View>
                  {wh.id === warehouseId && (
                    <View style={s.activePill}>
                      <Text style={s.activePillTxt}>Active</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}

              {/* Add warehouse form */}
              {showAddForm && (
                <View style={s.addFormCard}>
                  <Text style={s.addFormTitle}>New warehouse</Text>
                  <TextInput
                    style={s.addFormInput}
                    placeholder="Warehouse name *"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={newName}
                    onChangeText={setNewName}
                  />
                  <TextInput
                    style={s.addFormInput}
                    placeholder="Address"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={newAddress}
                    onChangeText={setNewAddress}
                  />
                  <View style={{ flexDirection: "row" }}>
                    <TextInput
                      style={[s.addFormInput, { flex: 1, marginRight: 8 }]}
                      placeholder="City"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      value={newCity}
                      onChangeText={setNewCity}
                    />
                    <TextInput
                      style={[s.addFormInput, { width: 70, marginRight: 8 }]}
                      placeholder="State"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      value={newState}
                      onChangeText={setNewState}
                      autoCapitalize="characters"
                      maxLength={2}
                    />
                    <TextInput
                      style={[s.addFormInput, { width: 90 }]}
                      placeholder="ZIP"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      value={newZip}
                      onChangeText={setNewZip}
                      keyboardType="number-pad"
                    />
                  </View>
                  <TextInput
                    style={s.addFormInput}
                    placeholder="Phone"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={newPhone}
                    onChangeText={setNewPhone}
                    keyboardType="phone-pad"
                  />
                  <View style={{ flexDirection: "row" }}>
                    <TouchableOpacity
                      style={s.addFormCancelBtn}
                      onPress={() => {
                        haptic.light();
                        resetForm();
                      }}
                    >
                      <Text style={s.addFormCancelTxt}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.addFormSaveBtn}
                      onPress={handleAddWarehouse}
                      disabled={saving}
                    >
                      {saving ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={s.addFormSaveTxt}>Create</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={{ height: 100 }} />
            </ScrollView>

            {!showAddForm && perms.canCreateWarehouse && (
              <TouchableOpacity
                style={s.addWhBtn}
                activeOpacity={0.7}
                onPress={() => {
                  haptic.light();
                  setShowAddForm(true);
                }}
              >
                <FontAwesome
                  name="plus"
                  size={13}
                  color="rgba(255,255,255,0.7)"
                />
                <Text style={s.addWhTxt}>Add Warehouse</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

// Every style below is taken directly from index.tsx header styles
const s = StyleSheet.create({
  headerWrapper: {
    overflow: "hidden",
    zIndex: 10,
    borderBottomLeftRadius: 55,
    borderBottomRightRadius: 55,
  },
  headerWrapperExpanded: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  headerGradient: { flex: 1 },
  headerTouchable: { paddingTop: 62, paddingHorizontal: 20, paddingBottom: 28 },
  headerContent: { marginBottom: 16 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  greetingText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 4,
  },
  warehouseName: { fontWeight: "bold", color: "#FFF" },
  warehouseAddr: { fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 },
  plusCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  statsStrip: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingVertical: 12,
  },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 18, fontWeight: "bold", color: "#FFF" },
  statLbl: { fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 },
  statDiv: { width: 1, backgroundColor: "rgba(255,255,255,0.12)" },
  expandedWrap: { flex: 1, paddingHorizontal: 20 },
  expandDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginVertical: 20,
  },
  whItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  whItemActive: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderColor: "rgba(255,255,255,0.22)",
  },
  whName: { fontSize: 16, fontWeight: "bold", color: "#FFF" },
  whAddr: { fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 },
  activePill: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activePillTxt: { fontSize: 10, fontWeight: "bold", color: "#FFF" },
  addWhBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.15)",
    borderStyle: "dashed",
    marginHorizontal: 20,
    marginBottom: 110,
  },
  addWhTxt: {
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    fontWeight: "600",
    marginLeft: 8,
  },
  addFormCard: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  addFormTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 12,
  },
  addFormInput: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: "#FFF",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  addFormCancelBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  addFormCancelTxt: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.5)",
  },
  addFormSaveBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  addFormSaveTxt: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#FFF",
  },
});
