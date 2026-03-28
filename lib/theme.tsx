import { createContext, useContext, useState } from "react";
import { useColorScheme } from "react-native";

const LIGHT = {
  primary: "#93143A",
  secondary: "#22214E",
  success: "#2E7D32",
  warning: "#F57C00",
  danger: "#D32F2F",
  background: "#F5F5F7",
  surface: "#FFFFFF",
  textPrimary: "#1A1A1A",
  textSecondary: "#8E8E93",
  border: "rgba(0,0,0,0.06)",
  borderInput: "rgba(0,0,0,0.1)",
  navFill: "#FFFFFF",
  headerGradient: ["#93143A", "#22214E"] as [string, string],
  mode: "light" as const,
};

const DARK = {
  primary: "#EF4444",
  secondary: "#60A5FA",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  background: "#0A0A14",
  surface: "#141420",
  textPrimary: "#F5F5F7",
  textSecondary: "#6B6B7B",
  border: "rgba(255,255,255,0.08)",
  borderInput: "rgba(255,255,255,0.12)",
  navFill: "#141420",
  headerGradient: ["#93143A", "#22214E"] as [string, string],
  mode: "dark" as const,
};

export type ThemeColors = typeof LIGHT;

const ThemeContext = createContext<{ theme: ThemeColors; toggle: () => void }>({
  theme: LIGHT,
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [override, setOverride] = useState<"light" | "dark" | null>(null);
  const mode = override || systemScheme || "light";
  const theme = mode === "dark" ? DARK : LIGHT;

  function toggle() {
    setOverride((prev) => {
      if (prev === null) return systemScheme === "dark" ? "light" : "dark";
      return prev === "dark" ? "light" : "dark";
    });
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeColors {
  return useContext(ThemeContext).theme;
}

export function useThemeToggle(): () => void {
  return useContext(ThemeContext).toggle;
}

export { DARK, LIGHT };
