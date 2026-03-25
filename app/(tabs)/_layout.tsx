import FontAwesome from "@expo/vector-icons/FontAwesome";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Platform, StyleSheet } from "react-native";
import { THEME } from "../../lib/config";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: THEME.secondary },
        headerTintColor: "#FFFFFF",
        tabBarActiveTintColor: THEME.primary,
        tabBarInactiveTintColor: "rgba(100,100,100,0.7)",
        tabBarStyle: {
          position: "absolute",
          borderTopWidth: 0,
          elevation: 0,
          backgroundColor:
            Platform.OS === "ios" ? "transparent" : "rgba(255,255,255,0.85)",
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView
              intensity={90}
              tint="extraLight"
              style={StyleSheet.absoluteFill}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => (
            <FontAwesome name="home" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scanner"
        options={{
          title: "Scanner",
          tabBarIcon: ({ color }) => (
            <FontAwesome name="barcode" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color }) => (
            <FontAwesome name="map" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: "Inventory",
          tabBarIcon: ({ color }) => (
            <FontAwesome name="list" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <FontAwesome name="cog" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
