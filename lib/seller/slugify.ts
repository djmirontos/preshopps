/**
 * Client-safe slug normalization -- mirrors create_shop's own
 * server-side normalization exactly (lowercase, non-alphanumeric runs
 * collapsed to a single hyphen, leading/trailing hyphens trimmed) so the
 * default slug shown to the seller during setup is exactly what the
 * server would derive on its own. Used only for the live "Shop URL"
 * preview/default in create mode -- the backend remains authoritative for
 * both format validation and uniqueness (0049_shop_create_update_rpcs.sql).
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
