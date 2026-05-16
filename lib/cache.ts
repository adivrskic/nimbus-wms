import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_PREFIX = "nimbus_cache_";
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  warehouseId: string;
};

export async function setCache<T>(key: string, data: T, warehouseId: string) {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now(), warehouseId };
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {}
}

export async function getCache<T>(
  key: string,
  warehouseId: string
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    // Must be for the same warehouse
    if (entry.warehouseId !== warehouseId) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function getCacheFresh<T>(
  key: string,
  warehouseId: string
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (entry.warehouseId !== warehouseId) return null;
    // Check TTL — only return if fresh
    if (Date.now() - entry.timestamp > CACHE_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function clearCacheForWarehouse(warehouseId: string) {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    for (const key of cacheKeys) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        try {
          const entry = JSON.parse(raw);
          if (entry.warehouseId === warehouseId) {
            await AsyncStorage.removeItem(key);
          }
        } catch {}
      }
    }
  } catch {}
}
