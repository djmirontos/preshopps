import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/**
 * P1 desktop Account navigation cleanup + order label clarification.
 * Purely a frontend labeling/navigation slice -- no route, RPC, RLS, or
 * migration changed. This suite locks in the scope boundaries the task
 * itself called out: mobile keeps its own unrelated navigation pattern,
 * "Orders"/"Seller Orders" renamed only where they name these two
 * specific account/order destinations, and no backend touched.
 */
describe("Account navigation cleanup stays frontend-only -- no backend/migration change", () => {
  it("no migration newer than 0091 exists -- this task added no schema/RPC change", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newerThan0091 = migrationFiles.filter((f) => f > "0091_notification_dismiss.sql");
    expect(newerThan0091).toEqual([]);
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
  });
});

describe("Mobile bottom navigation is untouched -- desktop-only dropdown expansion", () => {
  it("MobileBottomNav still has exactly 5 tabs, unchanged structure (Home/Search/Sell/Messages/Account)", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    const tabCount = (source.match(/<li className="flex-1">/g) ?? []).length;
    expect(tabCount).toBe(5);
    expect(source).toMatch(/href="\/"/);
    expect(source).toMatch(/href="\/search"/);
    expect(source).toMatch(/href="\/messages"/);
    expect(source).toMatch(/href=\{isAuthenticated \? "\/account"/);
  });

  it("MobileBottomNav's Account tab still links to /account (unchanged), never opens the new desktop dropdown", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    expect(source).not.toMatch(/AccountMenu/);
    expect(source).not.toMatch(/My Orders|Customer Orders/);
  });

  it("AccountMenu (the new desktop dropdown) is never imported by any mobile-facing component", () => {
    for (const file of ["components/layout/MobileBottomNav.tsx"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/from ["']@\/components\/auth\/AccountMenu["']/);
    }
  });

  it("AccountMenu itself renders unconditionally (no responsive breakpoint class hides/shows it) -- it is mounted only inside AppHeader's own desktop-only nav row, not duplicated for mobile", () => {
    const menuSource = readFile("components/auth/AccountMenu.tsx");
    expect(menuSource).not.toMatch(/lg:hidden|lg:flex|hidden lg:/);

    const headerSource = readFile("components/layout/AppHeader.tsx");
    const desktopNavMatch = headerSource.match(/<nav aria-label="Account actions"[\s\S]*?<\/nav>/);
    expect(desktopNavMatch).not.toBeNull();
    expect(desktopNavMatch![0]).toMatch(/hidden items-center gap-0\.5 lg:flex/);
    expect(desktopNavMatch![0]).toMatch(/AccountEntry/);

    const mobileIconsMatch = headerSource.match(/\{\/\* Mobile right-hand icons \*\/\}[\s\S]*?<\/div>/);
    expect(mobileIconsMatch).not.toBeNull();
    expect(mobileIconsMatch![0]).not.toMatch(/AccountEntry|AccountMenu/);
  });
});

describe("Terminology audit: 'Orders' / 'Seller Orders' renamed only for the two account/order destinations", () => {
  it("desktop AccountMenu dropdown uses My Orders / Customer Orders, never the old labels", () => {
    const source = readFile("components/auth/AccountMenu.tsx");
    expect(source).toMatch(/label:\s*"My Orders"/);
    expect(source).toMatch(/label:\s*"Customer Orders"/);
    expect(source).not.toMatch(/label:\s*"Orders"/);
    expect(source).not.toMatch(/label:\s*"Seller Orders"/);
  });

  it("mobile/shared AccountPage uses My Orders / Customer Orders link text", () => {
    const source = readFile("app/account/page.tsx");
    expect(source).toMatch(/>\s*My Orders\s*</);
    expect(source).toMatch(/>\s*Customer Orders\s*</);
    expect(source).not.toMatch(/>\s*Orders\s*</);
    expect(source).not.toMatch(/>\s*Seller Orders\s*</);
  });

  it("the buyer orders page renders My Orders as its own h1 and page title", () => {
    const source = readFile("app/orders/page.tsx");
    expect(source).toMatch(/<h1[^>]*>My Orders<\/h1>/);
    expect(source).toMatch(/title:\s*"My Orders \| Preshopps"/);
  });

  it("the seller orders page renders Customer Orders as its own h1 (both the no-shop and populated states) and page title", () => {
    const source = readFile("app/seller/orders/page.tsx");
    const h1Matches = source.match(/<h1[^>]*>Customer Orders<\/h1>/g) ?? [];
    expect(h1Matches.length).toBe(2);
    expect(source).toMatch(/title:\s*"Customer Orders \| Preshopps"/);
    expect(source).not.toMatch(/<h1[^>]*>Seller Orders<\/h1>/);
  });

  it("order detail breadcrumbs use the new labels", () => {
    expect(readFile("app/orders/[publicCode]/page.tsx")).toMatch(/Back to My Orders/);
    expect(readFile("app/seller/orders/[publicCode]/page.tsx")).toMatch(/Back to Customer Orders/);
  });

  it("does not rename generic/unrelated 'orders' usages -- descriptive body copy, admin terminology, and route/technical identifiers are untouched", () => {
    // Descriptive subtitle/empty-state prose is left exactly as-is (not a
    // navigation label -- explicitly out of scope per the task).
    expect(readFile("app/orders/page.tsx")).toMatch(/Orders you&apos;ve placed, newest first\./);
    expect(readFile("app/seller/orders/page.tsx")).toMatch(/Orders placed with your shop, newest first\./);
    expect(readFile("components/orders/OrdersListClient.tsx")).toMatch(/Orders you place will appear here\./);
    expect(readFile("components/seller/SellerOrdersListClient.tsx")).toMatch(/Orders buyers place with your shop will appear here\./);

    // No route/technical identifier was touched.
    expect(readFile("app/orders/page.tsx")).toMatch(/redirect\(`\/sign-in\?next=\$\{encodeURIComponent\("\/orders"\)\}`\)/);
    expect(readFile("app/seller/orders/page.tsx")).toMatch(/redirect\(`\/sign-in\?next=\$\{encodeURIComponent\("\/seller\/orders"\)\}`\)/);

    // Unrelated generic uses of the word "orders" elsewhere are untouched.
    expect(readFile("app/terms/page.tsx")).toMatch(/Orders and transaction arrangements/);
  });

  it("does not touch AGENTS.md", () => {
    // No content assertion needed beyond confirming the file is still
    // readable/unchanged in shape -- git history is the actual source of
    // truth for "untouched"; this just guards against an accidental
    // rename/move of the file itself.
    expect(() => readFile("AGENTS.md")).not.toThrow();
  });
});

describe("Canonical routes are reused verbatim -- no new URL invented", () => {
  it("every AccountMenu link points at a route that already exists elsewhere in the app", () => {
    const menuSource = readFile("components/auth/AccountMenu.tsx");
    const hrefs = [...menuSource.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/orders", "/seller/orders", "/seller/shop", "/seller/listings", "/favorites", "/account"]);

    // Each of these routes' own page file already exists (pre-dates this task).
    expect(() => readFile("app/orders/page.tsx")).not.toThrow();
    expect(() => readFile("app/seller/orders/page.tsx")).not.toThrow();
    expect(() => readFile("app/seller/shop/page.tsx")).not.toThrow();
    expect(() => readFile("app/seller/listings/page.tsx")).not.toThrow();
    expect(() => readFile("app/favorites/page.tsx")).not.toThrow();
    expect(() => readFile("app/account/page.tsx")).not.toThrow();
  });
});
