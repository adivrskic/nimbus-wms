import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "./config";
import { color, font } from "./nimbus/tokens";

const SCREEN_WIDTH = Dimensions.get("window").width;

// ============================================================
// SHADOW PRESETS (must be first — other sections reference these)
// ============================================================
const shadowStylesRaw = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardLarge: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
};

export const shadowStyles = StyleSheet.create(shadowStylesRaw);

// ============================================================
// HAPTICS
// ============================================================
export const haptic = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  selection: () => Haptics.selectionAsync(),
};

// ============================================================
// GRADIENT CARD (legacy — flat Nimbus surface, sharp corners)
// ============================================================
export function GradientCard({
  children,
  style,
  colors,
}: {
  children: React.ReactNode;
  style?: any;
  colors?: string[];
}) {
  return (
    <View
      style={[
        {
          backgroundColor: colors?.[0] || THEME.surface,
          borderWidth: 1,
          borderColor: color.whiteAlpha.a2,
          padding: 20,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ============================================================
// ELEVATED CARD (white card with shadow)
// ============================================================
export function ElevatedCard({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: any;
  onPress?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePressIn() {
    if (onPress) {
      Animated.spring(scale, {
        toValue: 0.97,
        useNativeDriver: true,
        speed: 50,
        bounciness: 4,
      }).start();
    }
  }

  function handlePressOut() {
    if (onPress) {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 50,
        bounciness: 4,
      }).start();
    }
  }

  const card = (
    <Animated.View
      style={[
        {
          backgroundColor: THEME.surface,
          borderWidth: 1,
          borderColor: color.whiteAlpha.a2,
          padding: 16,
          transform: [{ scale }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => {
          haptic.light();
          onPress();
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {card}
      </TouchableOpacity>
    );
  }

  return card;
}

// ============================================================
// ANIMATED COUNTER
// ============================================================
export function AnimatedCounter({
  value,
  style,
}: {
  value: number;
  style?: any;
}) {
  const [display, setDisplay] = useState(0);
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animValue.setValue(0);
    Animated.timing(animValue, {
      toValue: value,
      duration: 800,
      useNativeDriver: false,
    }).start();

    const listener = animValue.addListener(({ value: v }) => {
      setDisplay(Math.round(v));
    });

    return () => animValue.removeListener(listener);
  }, [value]);

  return <Text style={style}>{display}</Text>;
}

// ============================================================
// SKELETON LOADER
// ============================================================
export function Skeleton({
  width,
  height,
  borderRadius = 0,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: color.whiteAlpha.a3,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCard() {
  return (
    <View
      style={[
        {
          backgroundColor: THEME.surface,
          borderWidth: 1,
          borderColor: color.whiteAlpha.a2,
          padding: 16,
          marginBottom: 12,
        },
      ]}
    >
      <Skeleton width="60%" height={16} style={{ marginBottom: 10 }} />
      <Skeleton width="90%" height={12} style={{ marginBottom: 6 }} />
      <Skeleton width="40%" height={12} />
    </View>
  );
}

export function SkeletonStats() {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 24,
      }}
    >
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            {
              flex: 1,
              backgroundColor: THEME.surface,
              borderWidth: 1,
              borderColor: color.whiteAlpha.a2,
              padding: 16,
              marginHorizontal: 4,
              alignItems: "center",
            },
          ]}
        >
          <Skeleton
            width={24}
            height={24}
            borderRadius={12}
            style={{ marginBottom: 8 }}
          />
          <Skeleton width={40} height={22} style={{ marginBottom: 4 }} />
          <Skeleton width={50} height={12} />
        </View>
      ))}
    </View>
  );
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================
type ToastType = "success" | "error" | "info";

let toastRef: {
  show: (message: string, type?: ToastType) => void;
} | null = null;

export function setToastRef(ref: typeof toastRef) {
  toastRef = ref;
}

export function showToast(message: string, type: ToastType = "success") {
  toastRef?.show(message, type);
}

const TOAST_ICONS: Record<ToastType, { name: string; tone: string }> = {
  success: { name: "check-circle", tone: color.success },
  error: { name: "exclamation-circle", tone: color.danger },
  info: { name: "info-circle", tone: color.info },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const [message, setMessage] = useState("");
  const [type, setType] = useState<ToastType>("success");
  const [visible, setVisible] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setToastRef({
      show: (msg: string, t: ToastType = "success") => {
        if (timeout.current) clearTimeout(timeout.current);
        setMessage(msg);
        setType(t);
        setVisible(true);

        if (t === "success") haptic.success();
        if (t === "error") haptic.error();

        translateY.setValue(-100);
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 14,
          bounciness: 5,
        }).start();

        timeout.current = setTimeout(() => {
          Animated.timing(translateY, {
            toValue: -100,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setVisible(false));
        }, 3000);
      },
    });
  }, []);

  const icon = TOAST_ICONS[type];

  return (
    <View style={{ flex: 1 }}>
      {children}
      {visible && (
        <Animated.View
          style={[toastStyles.container, { transform: [{ translateY }] }]}
        >
          <View style={[toastStyles.body, { borderLeftColor: icon.tone }]}>
            <FontAwesome name={icon.name as any} size={16} color={icon.tone} />
            <Text style={toastStyles.text}>{message}</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const toastStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 55,
    left: 20,
    right: 20,
    zIndex: 9999,
  },
  // Nimbus: sharp corners, near-black glass surface, hairline border,
  // 4px semantic left-edge escalation (same pattern as list-row alerts).
  body: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.nearBlack,
    borderWidth: 1,
    borderColor: color.whiteAlpha.a2,
    borderLeftWidth: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...shadowStylesRaw.cardLarge,
  },
  text: {
    color: color.white,
    fontFamily: font.mono,
    fontSize: 12,
    letterSpacing: 0.5,
    marginLeft: 10,
    flex: 1,
  },
});

// ============================================================
// BUTTON WITH HAPTIC + GRADIENT
// ============================================================
const btnTextStyle = {
  color: "#000",
  fontFamily: font.mono,
  fontSize: 12,
  fontWeight: "500" as const,
  letterSpacing: 0.5,
  textTransform: "uppercase" as const,
};

export function GradientButton({
  label,
  onPress,
  icon,
  loading,
  colors,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  loading?: boolean;
  colors?: string[];
  style?: any;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => {
        haptic.medium();
        onPress();
      }}
      onPressIn={() => {
        Animated.spring(scale, {
          toValue: 0.96,
          useNativeDriver: true,
          speed: 50,
        }).start();
      }}
      onPressOut={() => {
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 50,
        }).start();
      }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {/* Nimbus accent button: flat gold, sharp corners, black text */}
        <View
          style={[
            {
              backgroundColor: colors?.[0] || color.accent,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
            },
            style,
          ]}
        >
          {loading ? (
            <Text style={btnTextStyle}>...</Text>
          ) : (
            <>
              {icon && (
                <FontAwesome
                  name={icon as any}
                  size={14}
                  color="#000"
                  style={{ marginRight: 8 }}
                />
              )}
              <Text style={btnTextStyle}>{label}</Text>
            </>
          )}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}
