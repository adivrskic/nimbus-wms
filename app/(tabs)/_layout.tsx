import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { Tabs } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { THEME } from "../../lib/config";
import { PendingBadge } from "../../lib/offlineUI";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useWarehouse } from "../../lib/warehouse";

const { width: SCREEN_W } = Dimensions.get("window");
const NAV_W = SCREEN_W;
const NAV_H = 56;
const BOTTOM_PAD = Platform.OS === "ios" ? 20 : 0;
const CUTOUT_R = 36;
const CENTER_X = NAV_W / 2;
const CUTOUT_LEFT = CENTER_X - CUTOUT_R;
const CUTOUT_RIGHT = CENTER_X + CUTOUT_R;

const navPath = `
  M0,${NAV_H + BOTTOM_PAD}
  L0,0
  L${CUTOUT_LEFT},0
  A${CUTOUT_R},${CUTOUT_R} 0 0 0 ${CUTOUT_RIGHT},0
  L${NAV_W},0
  L${NAV_W},${NAV_H + BOTTOM_PAD}
  Z
`;

const INACTIVE_ICON = "rgba(130,130,130,0.7)";
const INACTIVE_LABEL = "rgba(130,130,130,0.6)";

const SUGGESTIONS = [
  {
    icon: "exclamation-triangle",
    label: "What's running low?",
    prompt: "What products are running low on stock?",
  },
  {
    icon: "bolt",
    label: "Today's activity",
    prompt: "Summarize today's warehouse activity",
  },
  {
    icon: "users",
    label: "Staff productivity",
    prompt: "Show me staff productivity rankings",
  },
  {
    icon: "cube",
    label: "Top products",
    prompt: "What are our top products by quantity?",
  },
  {
    icon: "truck",
    label: "Pending orders",
    prompt: "Are there any pending orders or purchase orders?",
  },
  {
    icon: "map-o",
    label: "Section capacity",
    prompt: "Which sections are close to full capacity?",
  },
];

type Message = { role: "user" | "assistant"; content: string };

function AIModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const T = useTheme();
  const { warehouseName, warehouseId } = useWarehouse();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<FlatList>(null);
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (visible) {
      setMessages([]);
      setInput("");
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.8,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [visible]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Build context about the warehouse
      const [
        { data: locs },
        { count: sectionCount },
        { data: lowStock },
        { data: recentScans },
      ] = await Promise.all([
        supabase
          .from("locations")
          .select("product_id, quantity")
          .eq("warehouse_id", warehouseId),
        supabase
          .from("sections")
          .select("*", { count: "exact", head: true })
          .eq("warehouse_id", warehouseId),
        supabase
          .from("locations")
          .select("quantity, products(name, barcode, category)")
          .eq("warehouse_id", warehouseId)
          .lte("quantity", 5)
          .gt("quantity", 0)
          .order("quantity", { ascending: true })
          .limit(10),
        supabase
          .from("scan_history")
          .select(
            "action, scanned_at, products(name), profiles:scanned_by(full_name)"
          )
          .eq("warehouse_id", warehouseId)
          .order("scanned_at", { ascending: false })
          .limit(15),
      ]);

      const allLocs = locs || [];
      const totalProducts = new Set(allLocs.map((l: any) => l.product_id)).size;
      const totalStock = allLocs.reduce(
        (sum: number, l: any) => sum + (l.quantity || 0),
        0
      );

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayScans = (recentScans || []).filter(
        (s: any) => new Date(s.scanned_at) >= todayStart
      ).length;

      const lowStockList = (lowStock || [])
        .map((l: any) => `${l.products?.name} (qty: ${l.quantity})`)
        .join(", ");
      const recentList = (recentScans || [])
        .slice(0, 5)
        .map((s: any) => {
          const time = new Date(s.scanned_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          return `${s.action}: ${s.products?.name || "?"} by ${
            (s.profiles as any)?.full_name || "?"
          } at ${time}`;
        })
        .join("\n");

      const systemPrompt = `You are Nimbus AI, an intelligent assistant for the ${
        warehouseName || "warehouse"
      } warehouse management system. You help warehouse staff with inventory questions, stock analysis, and operational insights.

Current warehouse stats:
- ${totalProducts} unique products, ${totalStock} total stock units, ${
        sectionCount || 0
      } sections
- ${todayScans} scans today
- Low stock items: ${lowStockList || "None"}
- Recent activity:\n${recentList || "No recent activity"}

Be concise and helpful. Use numbers and specifics from the data above. If you don't have enough data to answer, say so honestly. Keep responses under 150 words.`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await response.json();
      const assistantText =
        data.content?.find((c: any) => c.type === "text")?.text ||
        "Sorry, I couldn't process that request.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: assistantText },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        },
      ]);
    }
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  const hasMessages = messages.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <LinearGradient
          colors={[THEME.primary, THEME.secondary]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={ai.modal}
        >
          {/* Header */}
          <View style={ai.header}>
            <View style={ai.handle} />
            <View style={ai.headerRow}>
              <TouchableOpacity
                onPress={() => {
                  haptic.light();
                  onClose();
                }}
                style={ai.closeBtn}
              >
                <FontAwesome
                  name="chevron-down"
                  size={14}
                  color="rgba(255,255,255,0.5)"
                />
              </TouchableOpacity>
              <View style={ai.headerCenter}>
                <View style={ai.headerDot} />
                <Text style={ai.headerTitle}>Nimbus AI</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setMessages([]);
                  haptic.light();
                }}
                style={ai.closeBtn}
              >
                <FontAwesome
                  name="refresh"
                  size={13}
                  color="rgba(255,255,255,0.5)"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Body */}
          {!hasMessages ? (
            <View style={ai.emptyState}>
              {/* Orb */}
              <View style={ai.orbWrap}>
                <Animated.View style={[ai.orbGlow, { opacity: pulseAnim }]} />
                <View style={ai.orbInner}>
                  <FontAwesome
                    name="cloud"
                    size={24}
                    color="rgba(255,255,255,0.8)"
                  />
                </View>
              </View>

              <Text style={ai.greeting}>How can I help?</Text>
              <Text style={ai.greetingSub}>
                {warehouseName || "Your warehouse"} assistant
              </Text>

              {/* Suggestion chips */}
              <View style={ai.suggestWrap}>
                {SUGGESTIONS.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={ai.suggestChip}
                    activeOpacity={0.7}
                    onPress={() => {
                      haptic.light();
                      sendMessage(s.prompt);
                    }}
                  >
                    <FontAwesome
                      name={s.icon as any}
                      size={12}
                      color="rgba(255,255,255,0.5)"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={ai.suggestText}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            <FlatList
              ref={scrollRef}
              data={messages}
              keyExtractor={(_, i) => String(i)}
              style={ai.chatList}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingBottom: 16,
                paddingTop: 8,
              }}
              onContentSizeChange={() =>
                scrollRef.current?.scrollToEnd({ animated: true })
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    ai.bubble,
                    item.role === "user" ? ai.bubbleUser : ai.bubbleAi,
                  ]}
                >
                  {item.role === "assistant" && (
                    <View style={ai.bubbleAvatar}>
                      <FontAwesome
                        name="cloud"
                        size={10}
                        color="rgba(255,255,255,0.7)"
                      />
                    </View>
                  )}
                  <View
                    style={[
                      ai.bubbleContent,
                      item.role === "user"
                        ? ai.bubbleContentUser
                        : ai.bubbleContentAi,
                    ]}
                  >
                    <Text
                      style={[
                        ai.bubbleText,
                        item.role === "user"
                          ? ai.bubbleTextUser
                          : ai.bubbleTextAi,
                      ]}
                    >
                      {item.content}
                    </Text>
                  </View>
                </View>
              )}
              ListFooterComponent={
                loading ? (
                  <View style={[ai.bubble, ai.bubbleAi]}>
                    <View style={ai.bubbleAvatar}>
                      <FontAwesome
                        name="cloud"
                        size={10}
                        color="rgba(255,255,255,0.7)"
                      />
                    </View>
                    <View style={[ai.bubbleContent, ai.bubbleContentAi]}>
                      <ActivityIndicator
                        size="small"
                        color="rgba(255,255,255,0.5)"
                      />
                    </View>
                  </View>
                ) : null
              }
            />
          )}

          {/* Quick suggestions when in chat */}
          {hasMessages && !loading && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={ai.quickRow}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              {SUGGESTIONS.slice(0, 4).map((s, i) => (
                <TouchableOpacity
                  key={i}
                  style={ai.quickChip}
                  activeOpacity={0.7}
                  onPress={() => {
                    haptic.light();
                    sendMessage(s.prompt);
                  }}
                >
                  <Text style={ai.quickText}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Input */}
          <View style={ai.inputWrap}>
            <View style={ai.inputRow}>
              <TextInput
                style={ai.input}
                placeholder="Ask about your warehouse..."
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={input}
                onChangeText={setInput}
                multiline
                onSubmitEditing={() => sendMessage(input)}
                blurOnSubmit
              />
              <TouchableOpacity
                style={[
                  ai.sendBtn,
                  (!input.trim() || loading) && { opacity: 0.4 },
                ]}
                activeOpacity={0.7}
                onPress={() => sendMessage(input)}
                disabled={!input.trim() || loading}
              >
                <View style={ai.sendCircle}>
                  <FontAwesome
                    name="arrow-up"
                    size={14}
                    color={THEME.secondary}
                  />
                </View>
              </TouchableOpacity>
            </View>
            <Text style={ai.disclaimer}>Hold scan button to open AI</Text>
          </View>
        </LinearGradient>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CustomTabBar({ state, descriptors, navigation }: any) {
  const T = useTheme();
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <>
      <View style={styles.outer} pointerEvents="box-none">
        <View style={styles.svgWrap} pointerEvents="none">
          <Svg
            width={NAV_W}
            height={NAV_H + BOTTOM_PAD}
            viewBox={`0 0 ${NAV_W} ${NAV_H + BOTTOM_PAD}`}
          >
            <Path
              d={navPath}
              fill={T.navFill}
              stroke={T.border}
              strokeWidth={0.5}
            />
          </Svg>
        </View>

        <ScanButton
          isFocused={state.routes[state.index]?.name === "scanner"}
          onPress={() => {
            haptic.medium();
            const scanRoute = state.routes.find(
              (r: any) => r.name === "scanner"
            );
            if (scanRoute) {
              const event = navigation.emit({
                type: "tabPress",
                target: scanRoute.key,
                canPreventDefault: true,
              });
              if (!event.defaultPrevented) navigation.navigate("scanner");
            }
          }}
          onLongPress={() => {
            haptic.heavy();
            setAiOpen(true);
          }}
          T={T}
        />

        <View style={styles.tabRow}>
          {state.routes.map((route: any, index: number) => {
            if (route.name === "scanner")
              return (
                <View key={route.key} style={{ width: CUTOUT_R * 2 + 16 }} />
              );
            const isFocused = state.index === index;
            const icons: Record<string, string> = {
              index: "home",
              map: "map",
              inventory: "list",
              settings: "cog",
            };
            const labels: Record<string, string> = {
              index: "Home",
              map: "Map",
              inventory: "Inventory",
              settings: "Settings",
            };
            return (
              <TabButton
                key={route.key}
                icon={icons[route.name] || "circle"}
                label={labels[route.name] || route.name}
                isFocused={isFocused}
                onPress={() => {
                  haptic.selection();
                  const event = navigation.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!isFocused && !event.defaultPrevented)
                    navigation.navigate(route.name);
                }}
              />
            );
          })}
        </View>
      </View>

      <AIModal visible={aiOpen} onClose={() => setAiOpen(false)} />
    </>
  );
}

function TabButton({
  icon,
  label,
  isFocused,
  onPress,
}: {
  icon: string;
  label: string;
  isFocused: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      style={styles.tab}
      activeOpacity={1}
      onPress={() => {
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 0.85,
            duration: 60,
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 30,
            bounciness: 8,
          }),
        ]).start();
        onPress();
      }}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale }] }]}>
        <FontAwesome
          name={icon as any}
          size={18}
          color={isFocused ? THEME.primary : INACTIVE_ICON}
        />
        <Text
          style={[
            styles.tabLabel,
            { color: isFocused ? THEME.primary : INACTIVE_LABEL },
            isFocused && { fontWeight: "700" },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function ScanButton({
  isFocused,
  onPress,
  onLongPress,
  T,
}: {
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  T: any;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const rot1 = useRef(new Animated.Value(0)).current;
  const rot2 = useRef(new Animated.Value(0)).current;
  const rot3 = useRef(new Animated.Value(0)).current;

  useState(() => {
    Animated.loop(
      Animated.timing(rot1, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: true,
      })
    ).start();
    Animated.loop(
      Animated.timing(rot2, {
        toValue: 1,
        duration: 4500,
        useNativeDriver: true,
      })
    ).start();
    Animated.loop(
      Animated.timing(rot3, {
        toValue: 1,
        duration: 6000,
        useNativeDriver: true,
      })
    ).start();
  });

  const spin1 = rot1.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const spin2 = rot2.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-360deg"],
  });
  const spin3 = rot3.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const GLOW_SIZE = 68;

  return (
    <View style={styles.scanWrap}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => {
          Animated.sequence([
            Animated.timing(scale, {
              toValue: 0.88,
              duration: 60,
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
        onLongPress={onLongPress}
        delayLongPress={400}
      >
        <Animated.View style={[styles.scanOuter, { transform: [{ scale }] }]}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glowLayer,
              {
                width: GLOW_SIZE,
                height: GLOW_SIZE,
                borderRadius: GLOW_SIZE / 2,
                transform: [{ rotate: spin1 }],
              },
            ]}
          >
            <LinearGradient
              colors={[
                THEME.primary + "60",
                "#8a64ff60",
                "transparent",
                "transparent",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glowLayer,
              {
                width: GLOW_SIZE + 10,
                height: GLOW_SIZE + 10,
                borderRadius: (GLOW_SIZE + 10) / 2,
                transform: [{ rotate: spin2 }],
              },
            ]}
          >
            <LinearGradient
              colors={[
                "transparent",
                THEME.primary + "90",
                "#8a64ff90",
                "transparent",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glowLayer,
              {
                width: GLOW_SIZE + 4,
                height: GLOW_SIZE + 4,
                borderRadius: (GLOW_SIZE + 4) / 2,
                transform: [{ rotate: spin3 }],
              },
            ]}
          >
            <LinearGradient
              colors={[
                "#8a64ffCC",
                THEME.primary + "CC",
                "transparent",
                "transparent",
              ]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <View style={styles.scanRing}>
            <LinearGradient
              colors={
                isFocused
                  ? [THEME.primary, "#7a1020"]
                  : [THEME.secondary, "#0f2240"]
              }
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.scanBtn}
            >
              <FontAwesome name="barcode" size={24} color="#FFF" />
            </LinearGradient>
          </View>
          <View
            pointerEvents="none"
            style={{ position: "absolute", top: 8, right: 8 }}
          >
            <PendingBadge />
          </View>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="map" options={{ title: "Map" }} />
      <Tabs.Screen name="scanner" options={{ title: "Scanner" }} />
      <Tabs.Screen name="inventory" options={{ title: "Inventory" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}

// ============================================================
// AI MODAL STYLES
// ============================================================
const ai = StyleSheet.create({
  modal: { flex: 1 },
  header: { paddingTop: Platform.OS === "ios" ? 12 : 16 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: { flexDirection: "row", alignItems: "center" },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4ADE80",
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFF",
    letterSpacing: 0.5,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  orbWrap: {
    width: 88,
    height: 88,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  orbGlow: {
    position: "absolute",
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  orbInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  greeting: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 4,
  },
  greetingSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.4)",
    marginBottom: 32,
  },

  // Suggestions
  suggestWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    maxWidth: 340,
  },
  suggestChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  suggestText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "500",
  },

  // Chat
  chatList: { flex: 1 },
  bubble: { flexDirection: "row", marginBottom: 12 },
  bubbleUser: { justifyContent: "flex-end" },
  bubbleAi: { justifyContent: "flex-start" },
  bubbleAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
    marginTop: 2,
  },
  bubbleContent: {
    maxWidth: "78%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleContentUser: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderBottomRightRadius: 4,
  },
  bubbleContentAi: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextUser: { color: "#FFF" },
  bubbleTextAi: { color: "rgba(255,255,255,0.85)" },

  // Quick suggestions
  quickRow: { maxHeight: 42, marginBottom: 8 },
  quickChip: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  quickText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    fontWeight: "500",
  },

  // Input
  inputWrap: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "ios" ? 36 : 16,
    paddingTop: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: "#FFF",
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendBtn: { marginLeft: 4 },
  sendCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  disclaimer: {
    fontSize: 11,
    color: "rgba(255,255,255,0.15)",
    textAlign: "center",
    marginTop: 8,
  },
});

// ============================================================
// TAB BAR STYLES
// ============================================================
const styles = StyleSheet.create({
  outer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: NAV_H + 18 + BOTTOM_PAD,
  },
  svgWrap: {
    position: "absolute",
    top: 28,
    left: 0,
    right: 0,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
    }),
  },
  tabRow: {
    position: "absolute",
    top: 28,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    height: NAV_H,
    paddingHorizontal: 8,
    zIndex: 20,
  },
  tab: { flex: 1, alignItems: "center" },
  tabInner: { alignItems: "center" },
  tabLabel: { fontSize: 9, marginTop: 1, letterSpacing: 0.2 },
  scanWrap: {
    position: "absolute",
    top: -4,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  scanOuter: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  glowLayer: { position: "absolute", overflow: "hidden" },
  scanRing: {
    width: 56,
    height: 56,
    borderRadius: 29,
    borderWidth: 2.5,
    borderColor: "rgba(138,100,255,0.35)",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: THEME.surface,
  },
  scanBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
  },
});
