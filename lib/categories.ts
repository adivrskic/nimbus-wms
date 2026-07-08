/**
 * Categories — org-defined rows in app.categories.
 *
 * The old schema had a hardcoded `products.category` text enum (flooring
 * verticals). The live nimbus-wms schema replaces it with a `category_id`
 * FK onto app.categories (id, name, icon, color, sort_order), managed per
 * org from the desktop app. Screens should render whatever the org defined.
 */

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useWarehouse } from "./warehouse";

export type Category = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  sort_order: number | null;
};

export function useCategories(): {
  categories: Category[];
  loading: boolean;
} {
  const { orgId } = useWarehouse();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!orgId) {
      setCategories([]);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("categories")
        .select("id, name, icon, color, sort_order")
        .eq("org_id", orgId)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("name");
      if (!cancelled) {
        setCategories((data as Category[]) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { categories, loading };
}

/** Joined-row shape when selecting `categories(name)` off a product. */
export type CategoryRef = { name: string | null } | null;

export function categoryName(ref: CategoryRef | undefined): string {
  return ref?.name ?? "";
}
