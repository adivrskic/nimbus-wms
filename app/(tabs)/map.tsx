import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ScreenHeader, useHeaderScroll } from "../../lib/Header";
import { THEME } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { Skeleton, haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

function SectionBlock({
  section,
  onPress,
  size,
}: {
  section: any;
  onPress: () => void;
  size: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => {
        haptic.medium();
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 0.93,
            duration: 80,
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 20,
            bounciness: 10,
          }),
        ]).start();
        onPress();
      }}
    >
      <Animated.View
        style={[
          s.block,
          {
            backgroundColor: section.color || THEME.primary,
            width: size,
            height: size,
            transform: [{ scale }],
          },
        ]}
      >
        <Text style={s.blockCode}>{section.code}</Text>
        <Text style={s.blockName} numberOfLines={1}>
          {section.name}
        </Text>
        <Text style={s.blockMeta}>
          {section.total_bays}B {"\u00D7"} {section.total_levels}L
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function MapScreen() {
  const wh = useWarehouse();
  const router = useRouter();
  const T = useTheme();
  const [sections, setSections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSection, setSelectedSection] = useState<any>(null);
  const [bayProducts, setBayProducts] = useState<any[]>([]);
  const [bayLoading, setBayLoading] = useState(false);

  const { scrollY, onScroll } = useHeaderScroll();

  useFocusEffect(
    useCallback(() => {
      if (wh.warehouseId) loadSections();
    }, [wh.warehouseId])
  );

  useEffect(() => {
    if (wh.warehouseId) loadSections();
  }, [wh.warehouseId]);

  async function loadSections() {
    if (!wh.warehouseId) return;
    setLoading(true);
    const { data } = await supabase
      .from("sections")
      .select("*")
      .eq("warehouse_id", wh.warehouseId)
      .order("code");
    setSections(data || []);
    setLoading(false);
  }

  async function openBayView(section: any) {
    setSelectedSection(section);
    setBayLoading(true);
    const { data } = await supabase
      .from("locations")
      .select("*, products(id, name, barcode, category)")
      .eq("section_id", section.id)
      .eq("warehouse_id", wh.warehouseId)
      .order("bay")
      .order("level");
    setBayProducts(data || []);
    setBayLoading(false);
  }

  function closeBayView() {
    setSelectedSection(null);
    setBayProducts([]);
  }

  const topRow = sections.filter((_, i) => i % 2 === 0);
  const bottomRow = sections.filter((_, i) => i % 2 === 1);

  const headerHeight = 130;
  const availableH = SCREEN_H - headerHeight - 180;
  const rotatedW = availableH;
  const rotatedH = SCREEN_W;
  const maxSections = Math.max(topRow.length, bottomRow.length);
  const gap = 8;
  const aisleW = 36;
  const padding = 16;
  const blockSize =
    maxSections > 0
      ? Math.min(
          Math.floor((rotatedH - aisleW - padding * 2 - gap) / 2),
          Math.floor(
            (rotatedW - padding * 2 - (maxSections - 1) * gap - 80) /
              maxSections
          )
        )
      : 0;

  return (
    <View style={[s.screen, { backgroundColor: T.background }]}>
      <ScreenHeader {...wh} scrollY={scrollY} />
      <View style={s.content}>
        <View style={s.titleRow}>
          <Text style={[s.title, { color: T.textPrimary }]}>Floor Plan</Text>
          <Text style={[s.subtitle, { color: T.textSecondary }]}>
            {sections.length} sections
            {sections.length > 0 ? " \u2022 Tilt phone to view" : ""}
          </Text>
        </View>

        {loading ? (
          <View style={s.mapArea}>
            <View style={s.skeletonRow}>
              {[1, 2, 3].map((i) => (
                <Skeleton
                  key={i}
                  width={120}
                  height={90}
                  borderRadius={12}
                  style={{ marginRight: 10 }}
                />
              ))}
            </View>
            <View style={{ height: 30 }} />
            <View style={s.skeletonRow}>
              {[1, 2, 3].map((i) => (
                <Skeleton
                  key={i}
                  width={120}
                  height={90}
                  borderRadius={12}
                  style={{ marginRight: 10 }}
                />
              ))}
            </View>
          </View>
        ) : sections.length === 0 ? (
          <View style={s.emptyState}>
            <View
              style={[
                s.emptyCircle,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
            >
              <FontAwesome name="map-o" size={28} color={T.textSecondary} />
            </View>
            <Text style={[s.emptyTitle, { color: T.textPrimary }]}>
              No sections yet
            </Text>
            <Text style={[s.emptySub, { color: T.textSecondary }]}>
              Add sections to this warehouse to see the floor plan
            </Text>
          </View>
        ) : (
          <View style={s.mapArea}>
            <View
              style={[
                s.rotatedContainer,
                {
                  width: rotatedW,
                  height: rotatedH,
                  transform: [{ rotate: "90deg" }],
                },
              ]}
            >
              <View style={s.landmark}>
                <View
                  style={[
                    s.landmarkIcon,
                    { backgroundColor: T.surface, borderColor: T.border },
                  ]}
                >
                  <FontAwesome name="truck" size={14} color={T.textSecondary} />
                </View>
                <Text style={[s.landmarkText, { color: T.textSecondary }]}>
                  DOCK
                </Text>
              </View>
              <View style={s.gridArea}>
                <View style={s.col}>
                  {topRow.map((sec) => (
                    <SectionBlock
                      key={sec.id}
                      section={sec}
                      onPress={() => openBayView(sec)}
                      size={blockSize}
                    />
                  ))}
                </View>
                <View style={s.aisle}>
                  <View
                    style={[
                      s.aisleLine,
                      {
                        borderColor:
                          T.mode === "dark" ? "rgba(255,255,255,0.1)" : "#CCC",
                      },
                    ]}
                  />
                  <Text style={[s.aisleLabel, { color: T.textSecondary }]}>
                    AISLE
                  </Text>
                  <View
                    style={[
                      s.aisleLine,
                      {
                        borderColor:
                          T.mode === "dark" ? "rgba(255,255,255,0.1)" : "#CCC",
                      },
                    ]}
                  />
                </View>
                <View style={s.col}>
                  {bottomRow.map((sec) => (
                    <SectionBlock
                      key={sec.id}
                      section={sec}
                      onPress={() => openBayView(sec)}
                      size={blockSize}
                    />
                  ))}
                </View>
              </View>
              <View style={s.landmark}>
                <View
                  style={[
                    s.landmarkIcon,
                    { backgroundColor: T.surface, borderColor: T.border },
                  ]}
                >
                  <FontAwesome
                    name="sign-in"
                    size={14}
                    color={T.textSecondary}
                  />
                </View>
                <Text style={[s.landmarkText, { color: T.textSecondary }]}>
                  ENTRY
                </Text>
              </View>
            </View>
          </View>
        )}

        {sections.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.legendScroll}
            contentContainerStyle={{ paddingHorizontal: 20 }}
          >
            {sections.map((sec) => (
              <TouchableOpacity
                key={sec.id}
                style={[
                  s.legendChip,
                  { backgroundColor: T.surface, borderColor: T.border },
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  haptic.light();
                  openBayView(sec);
                }}
              >
                <View style={[s.legendDot, { backgroundColor: sec.color }]} />
                <Text style={[s.legendCode, { color: T.textPrimary }]}>
                  {sec.code}
                </Text>
                <Text style={[s.legendName, { color: T.textSecondary }]}>
                  {sec.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Bay View Modal */}
      <Modal visible={!!selectedSection} animationType="slide">
        <View style={[s.bayScreen, { backgroundColor: T.background }]}>
          <LinearGradient
            colors={[selectedSection?.color || T.primary, T.secondary]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={s.bayHeader}
          >
            <TouchableOpacity onPress={closeBayView} style={s.bayBack}>
              <FontAwesome name="arrow-left" size={18} color="#FFF" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.bayHeaderSub}>
                Section {selectedSection?.code}
              </Text>
              <Text style={s.bayHeaderTitle}>{selectedSection?.name}</Text>
            </View>
            <View style={s.bayStatBox}>
              <Text style={s.bayStatNum}>{selectedSection?.total_bays}</Text>
              <Text style={s.bayStatLabel}>Bays</Text>
            </View>
            <View style={s.bayStatBox}>
              <Text style={s.bayStatNum}>{selectedSection?.total_levels}</Text>
              <Text style={s.bayStatLabel}>Levels</Text>
            </View>
          </LinearGradient>

          {bayLoading ? (
            <View style={s.centered}>
              <ActivityIndicator size="large" color={T.primary} />
            </View>
          ) : (
            <ScrollView style={s.bayBody} showsVerticalScrollIndicator={false}>
              {Array.from(
                { length: selectedSection?.total_bays || 0 },
                (_, bayIndex) => {
                  const bayNum = bayIndex + 1;
                  const totalLevels = selectedSection?.total_levels || 3;
                  const occupied = bayProducts.filter(
                    (p) => p.bay === bayNum
                  ).length;
                  return (
                    <View
                      key={bayNum}
                      style={[
                        s.bayCard,
                        { backgroundColor: T.surface, borderColor: T.border },
                      ]}
                    >
                      <View style={s.bayCardTop}>
                        <Text
                          style={[s.bayCardTitle, { color: T.textPrimary }]}
                        >
                          Bay {bayNum}
                        </Text>
                        <View
                          style={[
                            s.occupancyBadge,
                            { backgroundColor: T.primary + "12" },
                          ]}
                        >
                          <Text style={[s.occupancyText, { color: T.primary }]}>
                            {occupied}/{totalLevels}
                          </Text>
                        </View>
                      </View>
                      {Array.from({ length: totalLevels }, (_, li) => {
                        const levelNum = totalLevels - li;
                        const product = bayProducts.find(
                          (p) => p.bay === bayNum && p.level === levelNum
                        );
                        return (
                          <View key={levelNum} style={s.shelfRow}>
                            <View
                              style={[
                                s.levelBadge,
                                {
                                  backgroundColor: T.background,
                                  borderColor: T.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  s.levelText,
                                  { color: T.textSecondary },
                                ]}
                              >
                                L{levelNum}
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                s.shelf,
                                {
                                  backgroundColor: T.background,
                                  borderColor: T.border,
                                },
                                product && {
                                  backgroundColor: T.surface,
                                  borderStyle: "solid",
                                },
                              ]}
                              activeOpacity={product ? 0.7 : 1}
                              onPress={() => {
                                if (product?.products?.id) {
                                  haptic.light();
                                  closeBayView();
                                  router.push(
                                    `/product/${product.products.id}`
                                  );
                                }
                              }}
                            >
                              {product ? (
                                <View style={s.shelfProduct}>
                                  <View
                                    style={[
                                      s.shelfAccent,
                                      {
                                        backgroundColor:
                                          selectedSection?.color || T.primary,
                                      },
                                    ]}
                                  />
                                  <View style={{ flex: 1 }}>
                                    <Text
                                      style={[
                                        s.shelfProductName,
                                        { color: T.textPrimary },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {product.products?.name}
                                    </Text>
                                    <Text
                                      style={[
                                        s.shelfProductMeta,
                                        { color: T.textSecondary },
                                      ]}
                                    >
                                      {product.products?.category
                                        ?.replace("_", "/")
                                        .toUpperCase()}
                                      {" \u2022 Qty: "}
                                      {product.quantity}
                                    </Text>
                                  </View>
                                  <FontAwesome
                                    name="chevron-right"
                                    size={10}
                                    color={T.textSecondary}
                                  />
                                </View>
                              ) : (
                                <Text
                                  style={[
                                    s.shelfEmpty,
                                    { color: T.textSecondary },
                                  ]}
                                >
                                  Available
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      <View
                        style={[s.rackBase, { backgroundColor: T.border }]}
                      />
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

const s = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: { flex: 1 },
  titleRow: { paddingHorizontal: 20, marginTop: 16, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "bold" },
  subtitle: { fontSize: 12, marginTop: 2 },
  mapArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: "bold" },
  emptySub: { fontSize: 13, marginTop: 4, textAlign: "center" },
  rotatedContainer: {
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
  },
  gridArea: { flex: 1, justifyContent: "center" },
  col: { flexDirection: "row", justifyContent: "center", gap: 8 },
  skeletonRow: { flexDirection: "row", justifyContent: "center" },
  block: {
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    padding: 6,
  },
  blockCode: { fontSize: 26, fontWeight: "bold", color: "#FFF" },
  blockName: {
    fontSize: 10,
    color: "rgba(255,255,255,0.8)",
    marginTop: 1,
    paddingHorizontal: 4,
  },
  blockMeta: { fontSize: 8, color: "rgba(255,255,255,0.5)", marginTop: 2 },
  aisle: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  aisleLine: { flex: 1, height: 1, borderWidth: 1, borderStyle: "dashed" },
  aisleLabel: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 2,
    marginHorizontal: 10,
  },
  landmark: { alignItems: "center", justifyContent: "center", width: 44 },
  landmarkIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  landmarkText: {
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 3,
  },
  legendScroll: { maxHeight: 44, marginBottom: 100 },
  legendChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
  },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendCode: { fontSize: 13, fontWeight: "bold", marginRight: 4 },
  legendName: { fontSize: 12 },
  bayScreen: { flex: 1 },
  bayHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  bayBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  bayHeaderSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "600",
  },
  bayHeaderTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#FFF",
    marginTop: 2,
  },
  bayStatBox: { alignItems: "center", marginLeft: 20 },
  bayStatNum: { fontSize: 20, fontWeight: "bold", color: "#FFF" },
  bayStatLabel: { fontSize: 10, color: "rgba(255,255,255,0.55)", marginTop: 1 },
  bayBody: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  bayCard: { borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1 },
  bayCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  bayCardTitle: { fontSize: 16, fontWeight: "bold" },
  occupancyBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  occupancyText: { fontSize: 12, fontWeight: "bold" },
  shelfRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  levelBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    borderWidth: 1,
  },
  levelText: { fontSize: 11, fontWeight: "bold" },
  shelf: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shelfProduct: { flexDirection: "row", alignItems: "center" },
  shelfAccent: { width: 4, height: 32, borderRadius: 2, marginRight: 10 },
  shelfProductName: { fontSize: 13, fontWeight: "600" },
  shelfProductMeta: { fontSize: 10, marginTop: 2 },
  shelfEmpty: { fontSize: 12, fontStyle: "italic" },
  rackBase: { height: 4, borderRadius: 2, marginTop: 8 },
});
