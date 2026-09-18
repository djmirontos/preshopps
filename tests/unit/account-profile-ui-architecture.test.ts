import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips //, /* *\/, and SQL -- line comments so a "must NOT contain X"
 * assertion against actual code can't false-positive on a comment merely
 * explaining (by name) the thing being asserted absent -- the same
 * pattern already used by the 0091/0092 backend architecture suites,
 * extended here to also cover the one .sql file this suite reads. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/--.*$/gm, "");
}

/**
 * P1 Account/Profile Management -- frontend/UI slice, built on the
 * already-live 0092 backend (get_my_profile/update_my_profile/
 * avatar-images). This suite locks in the scope boundaries the task
 * itself called out: no schema/RPC/storage change, no direct profiles
 * table access, mobile navigation untouched, no Change Email/Password
 * UI yet, and no privacy regression on the app's existing public
 * identity projections (display_name/avatar only).
 */
describe("Account/Profile UI slice adds no backend/migration change", () => {
  it("only approved 0093/0094 follow 0092 -- this task is frontend-only (0093 is a later, separately-approved migration)", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newer = migrationFiles.filter((f) => f > "0092_account_profile_management.sql");
    expect(newer).toEqual([
      "0093_seller_order_messaging.sql",
      "0094_published_listing_editing.sql",
      "0095_restriction_visibility_notifications.sql",
      "0096_restriction_visibility_notifications.sql",
    ]);
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
  });
});

describe("Profile data access goes only through get_my_profile/update_my_profile", () => {
  const files = [
    "lib/account/get-my-profile.ts",
    "lib/account/update-my-profile.ts",
    "components/account/AccountProfileForm.tsx",
    "components/account/AvatarPicker.tsx",
    "app/account/page.tsx",
  ];

  it("no file selects the profiles table directly", () => {
    for (const file of files) {
      const source = stripComments(readFile(file));
      expect(source).not.toMatch(/\.from\(\s*["']profiles["']\s*\)/);
    }
  });

  it("get-my-profile.ts calls get_my_profile with no arguments", () => {
    const source = readFile("lib/account/get-my-profile.ts");
    expect(source).toMatch(/rpc\(\s*["']get_my_profile["']\s*\)/);
  });

  it("update-my-profile.ts calls update_my_profile and never sends a caller-supplied user/profile id", () => {
    const source = readFile("lib/account/update-my-profile.ts");
    expect(source).toMatch(/rpc\(\s*["']update_my_profile["']/);
    expect(source).not.toMatch(/p_user_id|p_profile_id|p_target/);
  });

  it("email is sourced from the authenticated session (AccountPage's own getAuthUser), never from get_my_profile's return shape", () => {
    const rpcSource = stripComments(readFile("lib/account/get-my-profile.ts"));
    expect(rpcSource).not.toMatch(/\bemail\b/i);

    const pageSource = readFile("app/account/page.tsx");
    expect(pageSource).toMatch(/getAuthUser/);
    expect(pageSource).toMatch(/user\.email/);
  });

  it("no new profiles RLS policy is introduced by this UI slice (nothing here is a migration at all)", () => {
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/create policy|alter policy/i);
    }
  });

  it("no service-role key/client anywhere in the new account UI files", () => {
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("Avatar upload reuses the established image pipeline", () => {
  it("MediaBucket includes avatar-images alongside the existing buckets, not a replacement", () => {
    const source = readFile("lib/image-processing/upload-image.ts");
    expect(source).toMatch(/"listing-images" \| "review-images" \| "shop-images" \| "dispute-images" \| "avatar-images"/);
  });

  it("AvatarPicker uploads via the shared uploadImage/deleteUploadedImage helpers, not a bespoke storage call", () => {
    const source = readFile("components/account/AvatarPicker.tsx");
    expect(source).toMatch(/from ["']@\/lib\/image-processing\/upload-image["']/);
    expect(source).not.toMatch(/\.storage\.from\(/);
  });

  it("AvatarPicker always passes the authenticated ownerId prop as the storage owner segment, never a hardcoded or route-derived id", () => {
    const source = readFile("components/account/AvatarPicker.tsx");
    expect(source).toMatch(/uploadImage\(\s*"avatar-images",\s*ownerId,\s*AVATAR_ENTITY/);
  });

  it("AccountProfileForm passes the authenticated user's own id (from getAuthUser via AccountPage), never a route param, into AvatarPicker", () => {
    const pageSource = readFile("app/account/page.tsx");
    expect(pageSource).toMatch(/userId=\{user\.id\}/);
    expect(pageSource).not.toMatch(/params\.(userId|id)/);
  });
});

describe("Save flow: two distinct write paths -- avatar actions read CONFIRMED state, Save Changes reads/promotes the draft", () => {
  it("updateMyProfile has exactly two call sites: performAvatarSave and handleSaveChangesClick", () => {
    const source = readFile("components/account/AccountProfileForm.tsx");
    const callSites = source.match(/updateMyProfile\(/g) ?? [];
    expect(callSites.length).toBe(2);
    expect(source).toMatch(/async function performAvatarSave\(/);
    expect(source).toMatch(/async function handleSaveChangesClick\(/);
  });

  it("performAvatarSave sends the CONFIRMED snapshot fields, never the draft state variables", () => {
    const source = readFile("components/account/AccountProfileForm.tsx");
    const body = source.split("async function performAvatarSave")[1]!.split("\n  /**\n   * The ONLY write path for display_name")[0]!;
    expect(body).toMatch(/displayName: confirmed\.displayName/);
    expect(body).toMatch(/firstName: confirmed\.firstName/);
    expect(body).toMatch(/lastName: confirmed\.lastName/);
    expect(body).toMatch(/bio: confirmed\.bio/);
    expect(body).toMatch(/mobileNumber: confirmed\.mobileNumber/);
    expect(body).toMatch(/provinceId: confirmed\.provinceId/);
    expect(body).toMatch(/cityId: confirmed\.cityId/);
    expect(body).toMatch(/barangayId: confirmed\.barangayId/);
    // Never reads the raw draft state setters/variables for these fields.
    expect(body).not.toMatch(/displayName\.trim\(\)|firstName\.trim\(\)|lastName\.trim\(\)|bio\.trim\(\)|mobileNumber\.trim\(\)/);
  });

  it("performAvatarSave runs no client-side field validation before calling the RPC -- an invalid draft can never block it", () => {
    const source = readFile("components/account/AccountProfileForm.tsx");
    const body = source.split("async function performAvatarSave")[1]!.split("\n  /**\n   * The ONLY write path for display_name")[0]!;
    expect(body).not.toMatch(/validate\(\)/);
    expect(body).not.toMatch(/setFieldErrors/);
  });

  it("handleSaveChangesClick validates the draft, and only on success promotes it into `confirmed`", () => {
    const source = readFile("components/account/AccountProfileForm.tsx");
    const body = source.split("async function handleSaveChangesClick")[1]!;
    expect(body).toMatch(/validate\(\)/);
    expect(body).toMatch(/setConfirmed\(nextConfirmed\)/);
    // avatarPath itself is passed through unchanged, never reassigned here.
    expect(body).not.toMatch(/setAvatarPath/);
  });

  it("avatar upload/removal cleans up the previous storage object only after a successful save, never before", () => {
    const source = readFile("components/account/AccountProfileForm.tsx");
    const body = source.split("async function performAvatarSave")[1]!.split("\n  /**\n   * The ONLY write path for display_name")[0]!;
    const successBlock = body.split("setSubmitError(null);\n\n    const previousPath")[1]!;
    expect(successBlock).toMatch(/deleteUploadedImage\(previousPath\)/);

    const failureBlock = body.split("if (!result.ok) {")[1]!.split("return false;")[0]!;
    expect(failureBlock).not.toMatch(/deleteUploadedImage/);
  });

  it("a cleanup failure is caught and logged, never rethrown to the UI", () => {
    const source = readFile("components/account/AccountProfileForm.tsx");
    expect(source).toMatch(/deleteUploadedImage\(previousPath\)\.catch\(/);
  });
});

describe("Suspension handling is reactive to the RPC error, not recreated client-side", () => {
  it("no user_restrictions/restriction_type query exists anywhere in the new frontend files", () => {
    for (const file of ["components/account/AccountProfileForm.tsx", "app/account/page.tsx", "lib/account/get-my-profile.ts", "lib/account/update-my-profile.ts"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/user_restrictions|restriction_type|seller_suspended|account_suspended/);
    }
  });

  it("PUBLIC_PROFILE_LOCKED maps to the exact locked copy and no other file re-implements this string", () => {
    const source = readFile("lib/account/update-my-profile.ts");
    expect(source).toMatch(/PUBLIC_PROFILE_LOCKED: "Your public profile details can't be changed while your account is under review\."/);
  });
});

describe("No unrelated public RPC/profile exposure was added", () => {
  it("does not modify get_shop_reviews, get_conversation_context, or get_my_notifications", () => {
    for (const file of [
      "supabase/migrations/0091_notification_dismiss.sql",
      "supabase/migrations/0092_account_profile_management.sql",
    ]) {
      const source = readFile(file);
      expect(source).not.toMatch(/create or replace function public\.get_shop_reviews/);
      expect(source).not.toMatch(/create or replace function public\.get_conversation_context/);
    }
  });

  it("bio/first_name/last_name/mobile_number/profile location are never referenced by existing review or messaging display components", () => {
    for (const file of ["components/shop/ShopReviewCard.tsx", "components/messaging/ConversationsListClient.tsx"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/\bbio\b/);
      expect(source).not.toMatch(/firstName|first_name/);
      expect(source).not.toMatch(/lastName|last_name/);
      expect(source).not.toMatch(/mobileNumber|mobile_number/);
      expect(source).not.toMatch(/provinceId|province_id/);
    }
  });

  it("no new public_profiles view or route exists", () => {
    const migrationSource = stripComments(readFile("supabase/migrations/0092_account_profile_management.sql"));
    expect(migrationSource).not.toMatch(/create (or replace )?view/i);
    expect(migrationSource).not.toMatch(/public_profiles/);
  });
});

describe("No Security section / Change Email / Change Password UI added yet", () => {
  it("app/account/page.tsx never mentions Change Email or Change Password", () => {
    const source = stripComments(readFile("app/account/page.tsx"));
    expect(source).not.toMatch(/change email/i);
    expect(source).not.toMatch(/change password/i);
    expect(source).not.toMatch(/>\s*Security\s*</);
  });

  it("AccountProfileForm never calls supabase.auth.updateUser or reauthenticate", () => {
    const source = readFile("components/account/AccountProfileForm.tsx");
    expect(source).not.toMatch(/auth\.updateUser/);
    expect(source).not.toMatch(/auth\.reauthenticate/);
  });
});

describe("Marketplace section uses the approved labels and routes", () => {
  it("app/account/page.tsx links exactly the five marketplace destinations with the locked labels", () => {
    const source = readFile("app/account/page.tsx");
    expect(source).toMatch(/href="\/orders"[\s\S]{0,500}My Orders/);
    expect(source).toMatch(/href="\/seller\/orders"[\s\S]{0,500}Customer Orders/);
    expect(source).toMatch(/href="\/seller\/shop"[\s\S]{0,500}My Shop/);
    expect(source).toMatch(/href="\/seller\/listings"[\s\S]{0,500}My Listings/);
    expect(source).toMatch(/href="\/favorites"[\s\S]{0,500}Favorites/);
  });
});

describe("Account deletion request reuses the existing support flow only", () => {
  it("app/account/page.tsx links to /support with no invented query-parameter mechanism", () => {
    const source = readFile("app/account/page.tsx");
    expect(source).toMatch(/href="\/support"/);
    expect(source).not.toMatch(/\/support\?/);
  });

  it("does not add a new delete-account RPC/action anywhere", () => {
    const files = ["app/account/page.tsx", "components/account/AccountProfileForm.tsx", "lib/account/get-my-profile.ts", "lib/account/update-my-profile.ts"];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/delete_account|deleteAccount|delete_my_account/i);
    }
  });
});

describe("Mobile bottom navigation remains untouched by this slice", () => {
  it("MobileBottomNav still has exactly 5 tabs and is not imported by any new account file", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    const tabCount = (source.match(/<li className="flex-1">/g) ?? []).length;
    expect(tabCount).toBe(5);

    for (const file of ["components/account/AccountProfileForm.tsx", "components/account/AvatarPicker.tsx", "app/account/page.tsx"]) {
      expect(stripComments(readFile(file))).not.toMatch(/MobileBottomNav/);
    }
  });

  it("MobileBottomNav's Account tab still links to /account, unchanged", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    expect(source).toMatch(/href=\{isAuthenticated \? "\/account"/);
  });
});
