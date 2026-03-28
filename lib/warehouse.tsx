import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

const ACTIVE_WH_KEY = "nimbus_active_warehouse_id";

type Warehouse = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  owner_id: string | null;
};

type WarehouseContextType = {
  greeting: string;
  userName: string;
  userId: string;
  userRole: string;
  warehouseName: string;
  warehouseAddress: string;
  warehouseId: string;
  accessibleWarehouses: Warehouse[];
  switchWarehouse: (id: string) => Promise<void>;
  createWarehouse: (fields: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  refreshWarehouses: () => Promise<void>;
};

const defaults: WarehouseContextType = {
  greeting: "",
  userName: "",
  userId: "",
  userRole: "staff",
  warehouseName: "",
  warehouseAddress: "",
  warehouseId: "",
  accessibleWarehouses: [],
  switchWarehouse: async () => {},
  createWarehouse: async () => ({ success: false }),
  refreshWarehouses: async () => {},
};

const WarehouseContext = createContext<WarehouseContextType>(defaults);

export function WarehouseProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<WarehouseContextType>(defaults);

  useEffect(() => {
    load();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") load();
      if (event === "SIGNED_OUT") {
        setData((prev) => ({
          ...prev,
          greeting: "",
          userName: "",
          userId: "",
          warehouseName: "",
          warehouseAddress: "",
          warehouseId: "",
          accessibleWarehouses: [],
        }));
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function load(overrideId?: string) {
    const hour = new Date().getHours();
    const greeting =
      hour < 12
        ? "Good morning"
        : hour < 17
        ? "Good afternoon"
        : "Good evening";
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const userName =
      user.user_metadata?.full_name || user.email?.split("@")[0] || "";

    // Fetch user role from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const userRole = profile?.role || "staff";

    // RLS on warehouses already filters to only those the user has access to
    const { data: warehouses } = await supabase
      .from("warehouses")
      .select("*")
      .order("name");

    const accessible: Warehouse[] = warehouses || [];

    // Determine which warehouse to activate
    let activeId = overrideId || null;
    if (!activeId) {
      try {
        activeId = await AsyncStorage.getItem(ACTIVE_WH_KEY);
      } catch {}
    }

    let wh = accessible.find((w) => w.id === activeId) || null;
    if (!wh && accessible.length > 0) {
      wh = accessible[0];
    }

    if (wh?.id) {
      try {
        await AsyncStorage.setItem(ACTIVE_WH_KEY, wh.id);
      } catch {}
    }

    setData((prev) => ({
      ...prev,
      greeting,
      userName,
      userId: user.id,
      userRole,
      warehouseName: wh?.name || "",
      warehouseAddress: wh?.address || "",
      warehouseId: wh?.id || "",
      accessibleWarehouses: accessible,
    }));
  }

  async function switchWarehouse(id: string) {
    await load(id);
  }

  async function createWarehouse(fields: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { success: false, error: "Not authenticated" };

      const { data: wh, error: whErr } = await supabase
        .from("warehouses")
        .insert({
          name: fields.name,
          address: fields.address || null,
          city: fields.city || null,
          state: fields.state || null,
          zip: fields.zip || null,
          phone: fields.phone || null,
          owner_id: user.id,
        })
        .select()
        .single();

      if (whErr) return { success: false, error: whErr.message };

      // Grant creator access so RLS allows them to see it
      await supabase
        .from("warehouse_access")
        .insert({
          user_id: user.id,
          warehouse_id: wh.id,
          granted_by: user.id,
        })
        .then(() => {});

      await load(wh.id);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || "Unexpected error" };
    }
  }

  async function refreshWarehouses() {
    await load();
  }

  return (
    <WarehouseContext.Provider
      value={{ ...data, switchWarehouse, createWarehouse, refreshWarehouses }}
    >
      {children}
    </WarehouseContext.Provider>
  );
}

export function useWarehouse() {
  return useContext(WarehouseContext);
}
