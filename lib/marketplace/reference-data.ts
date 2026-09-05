import { createClient } from "@/lib/supabase/server";

export type CategoryRef = { id: number; slug: string; name: string };
export type LocationRef = { id: number; name: string };

/**
 * categories/provinces/cities_municipalities/barangays all carry public,
 * anon-readable SELECT-only RLS policies (0035_public_browsing_indexes_
 * and_reference_rls.sql) specifically so filter dropdowns don't need a
 * dedicated RPC -- these read the tables directly, unlike listings (zero
 * policies, reachable only through browse_listings). No service role, no
 * admin client, no raw access to any user-owned or business table.
 */
export async function getCategories(): Promise<CategoryRef[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, slug, name")
    .order("sort_order", { ascending: true });

  if (error || !data) {
    console.error("Failed to load categories:", error?.message);
    return [];
  }
  return data;
}

export async function getProvinces(): Promise<LocationRef[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("provinces")
    .select("id, name")
    .order("name", { ascending: true });

  if (error || !data) {
    console.error("Failed to load provinces:", error?.message);
    return [];
  }
  return data;
}

/** Dependent load: only called when a province is actually selected --
 * never fetches every city nationwide up front. */
export async function getCitiesForProvince(provinceId: number): Promise<LocationRef[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cities_municipalities")
    .select("id, name")
    .eq("province_id", provinceId)
    .order("name", { ascending: true });

  if (error || !data) {
    console.error("Failed to load cities:", error?.message);
    return [];
  }
  return data;
}

/** Dependent load: only called when a city is actually selected. */
export async function getBarangaysForCity(cityId: number): Promise<LocationRef[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("barangays")
    .select("id, name")
    .eq("city_id", cityId)
    .order("name", { ascending: true });

  if (error || !data) {
    console.error("Failed to load barangays:", error?.message);
    return [];
  }
  return data;
}

export type LocationContext = {
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
};

/**
 * Resolves a lone city/barangay id (e.g. a hand-edited or partially stale
 * shared URL that only specifies the most specific level) up to its
 * parent ids, so the cascading location selects render correctly on
 * direct navigation. Unknown/invalid ids resolve to null (fail safe,
 * never throw) rather than surfacing a raw lookup error to the page.
 */
export async function resolveLocationContext(filters: LocationContext): Promise<LocationContext> {
  let { provinceId, cityId, barangayId } = filters;
  const supabase = await createClient();

  if (barangayId && !cityId) {
    const { data } = await supabase
      .from("barangays")
      .select("city_id")
      .eq("id", barangayId)
      .maybeSingle();
    cityId = data?.city_id ?? null;
    if (!cityId) barangayId = null;
  }

  if (cityId && !provinceId) {
    const { data } = await supabase
      .from("cities_municipalities")
      .select("province_id")
      .eq("id", cityId)
      .maybeSingle();
    provinceId = data?.province_id ?? null;
    if (!provinceId) {
      cityId = null;
      barangayId = null;
    }
  }

  return { provinceId, cityId, barangayId };
}
