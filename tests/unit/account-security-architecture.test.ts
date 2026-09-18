import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips //, /* *\/, and SQL -- line comments so a "must NOT contain X"
 * assertion against actual code can't false-positive on a comment merely
 * explaining (by name) the thing being asserted absent. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/--.*$/gm, "");
}

const SECURITY_FILES = [
  "components/account/SecuritySection.tsx",
  "components/account/SecurityDialog.tsx",
  "components/account/ChangePasswordForm.tsx",
  "lib/auth/security-errors.ts",
  "app/account/page.tsx",
  "app/auth/confirm/route.ts",
];

describe("Account Security slice adds no backend/migration/config change", () => {
  it("only approved 0093/0094 follow 0092 -- this task is frontend/auth-only (0093 is a later, separately-approved migration)", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newer = migrationFiles.filter((f) => f > "0092_account_profile_management.sql");
    expect(newer).toEqual([
      "0093_seller_order_messaging.sql",
      "0094_published_listing_editing.sql",
      "0095_restriction_visibility_notifications.sql",
      "0096_restriction_visibility_notifications.sql",
      "0097_fix_apply_user_restriction_output_collision.sql",
    ]);
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
  });

  it("no security file references a database table, RPC name, or storage bucket", () => {
    for (const file of SECURITY_FILES) {
      const source = stripComments(readFile(file));
      expect(source).not.toMatch(/\.from\(\s*["'][a-z_]+["']\s*\)/);
      expect(source).not.toMatch(/\.rpc\(/);
      expect(source).not.toMatch(/\.storage\./);
    }
  });

  it("no security file references profiles.email, writes email onto the profiles table, or touches display_name", () => {
    for (const file of SECURITY_FILES) {
      const source = stripComments(readFile(file));
      expect(source).not.toMatch(/profiles\.email|profile\.email|p_email/);
      expect(source).not.toMatch(/display_name|displayName/);
    }
  });

  it("no security file uses service_role or an admin Auth API", () => {
    for (const file of SECURITY_FILES) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
      expect(source).not.toMatch(/auth\.admin\./);
    }
  });
});

describe("Self-service Change Email is removed -- email changes go through Support only", () => {
  it("no Account component calls updateUser({ email: ... })", () => {
    const accountComponentFiles = [
      "components/account/SecuritySection.tsx",
      "components/account/ChangePasswordForm.tsx",
      "components/account/AccountProfileForm.tsx",
      "app/account/page.tsx",
    ];
    for (const file of accountComponentFiles) {
      const source = stripComments(readFile(file));
      expect(source).not.toMatch(/updateUser\(\s*\{\s*email:/);
    }
  });

  it("ChangeEmailForm.tsx no longer exists", () => {
    expect(existsSync(path.join(process.cwd(), "components/account/ChangeEmailForm.tsx"))).toBe(false);
  });

  it("SecuritySection no longer imports or renders ChangeEmailForm, and has no email-change confirmation modal", () => {
    const source = readFile("components/account/SecuritySection.tsx");
    expect(source).not.toMatch(/ChangeEmailForm/);
    expect(source).not.toMatch(/Confirm your email change/);
    expect(source).not.toMatch(/showEmailChangeConfirmation/);
  });

  it("no email-change completion/pending routes remain from the abandoned feature", () => {
    expect(existsSync(path.join(process.cwd(), "app/auth/email-change-complete"))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "app/auth/email-change-pending"))).toBe(false);
  });

  it("lib/auth/security-errors.ts no longer exports a Change-Email error mapper", () => {
    const source = readFile("lib/auth/security-errors.ts");
    expect(source).not.toMatch(/mapChangeEmailError/);
  });

  it("/auth/confirm's SUPPORTED_EMAIL_OTP_TYPES is reverted to exactly signup and recovery -- email_change was only added for the abandoned feature", () => {
    const source = readFile("app/auth/confirm/route.ts");
    expect(source).toMatch(/SUPPORTED_EMAIL_OTP_TYPES = \["signup", "recovery"\]/);
    expect(source).not.toMatch(/email_change/);
  });
});

describe("/auth/confirm: existing signup/recovery confirmation behavior is untouched", () => {
  const source = readFile("app/auth/confirm/route.ts");

  it("still handles token_hash + a supported type via verifyOtp", () => {
    expect(source).toMatch(/auth\.verifyOtp\(\{ type, token_hash: tokenHash \}\)/);
  });

  it("still handles the PKCE code shape via exchangeCodeForSession", () => {
    expect(source).toMatch(/auth\.exchangeCodeForSession\(code\)/);
  });

  it("still falls back to the safe invalid-link redirect for anything else", () => {
    expect(source).toMatch(/INVALID_LINK_PATH = "\/sign-in\?auth_error=invalid_link"/);
  });
});

describe("Change Password: current password directly, no reauthentication OTP", () => {
  const source = readFile("components/account/ChangePasswordForm.tsx");
  const stripped = stripComments(source);

  it("never calls auth.reauthenticate anywhere", () => {
    expect(stripped).not.toMatch(/reauthenticate/i);
  });

  it("never references OtpCodeInput, a nonce, or a verification/resend code concept", () => {
    expect(stripped).not.toMatch(/OtpCodeInput|nonce|resend|cooldown/i);
  });

  it("collects the current password via a real field", () => {
    expect(source).toMatch(/currentPassword/);
    expect(source).toMatch(/autoComplete="current-password"/);
  });

  it("calls auth.updateUser({ password, current_password }) -- never signInWithPassword for verification", () => {
    expect(source).toMatch(/auth\.updateUser\(\{\s*\n\s*password:\s*newPassword,\s*\n\s*current_password:\s*currentPassword,?\s*\n\s*\}\)/);
    expect(stripped).not.toMatch(/signInWithPassword/);
  });

  it("password minimum length matches the existing signup/reset-password policy (6)", () => {
    expect(source).toMatch(/PASSWORD_MIN_LENGTH\s*=\s*6/);
  });
});

describe("Change Password: successful update triggers a mandatory GLOBAL sign-out", () => {
  const source = readFile("components/account/ChangePasswordForm.tsx");

  it("calls auth.signOut({ scope: 'global' }) immediately after a successful updateUser call", () => {
    expect(source).toMatch(/auth\.signOut\(\{\s*scope:\s*["']global["']\s*\}\)/);
  });

  it("redirects to /sign-in only after signOut itself succeeds", () => {
    const body = source.split("if (signOutError) {")[1]!.split("router.push")[0]!;
    expect(body).not.toMatch(/router\.push/);
    const afterBody = source.split("router.push(\"/sign-in\")")[1]!;
    expect(afterBody).toBeDefined();
  });

  it("on signOut failure, shows the exact locked safe-recovery copy and does not navigate away", () => {
    const source2 = readFile("lib/auth/security-errors.ts");
    expect(source2).toContain("export const PASSWORD_CHANGED_SIGN_OUT_FAILED_MESSAGE =");
    expect(source2).toContain("Your password was updated, but we couldn't sign out your other sessions automatically.");
    expect(source2).toContain('For your security, please use \\"Sign out other devices\\" below.');
    expect(source).toMatch(/PASSWORD_CHANGED_SIGN_OUT_FAILED_MESSAGE/);
    expect(source).not.toMatch(/router\.push\("\/sign-in"\);\s*\n\s*router\.refresh\(\);\s*\n\s*\}\s*\n\s*if \(signOutError\)/);
  });

  it("never auto-retries the sign-out call (no retry loop/counter in actual code)", () => {
    const stripped = stripComments(source);
    expect(stripped).not.toMatch(/retry|attempt.*\+\+|for\s*\(.*signOut/i);
  });
});

describe("Sensitive state is never persisted, logged, or left in the DOM after success", () => {
  it("ChangePasswordForm never writes to localStorage/sessionStorage", () => {
    const source = stripComments(readFile("components/account/ChangePasswordForm.tsx"));
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });

  it("no security file logs a password value, nonce, or code -- console calls may only describe the event, never include the sensitive variable itself", () => {
    for (const file of SECURITY_FILES) {
      const source = stripComments(readFile(file));
      const consoleCalls = source.match(/console\.(log|error|warn|info)\([^)]*\)/g) ?? [];
      for (const call of consoleCalls) {
        expect(call).not.toMatch(/\b(currentPassword|newPassword|confirmPassword|verificationCode|recoveryToken|accessToken|refreshToken)\b/);
      }
    }
  });

  it("ChangePasswordForm clears all three password fields and resets all three visibility flags on successful update", () => {
    const source = readFile("components/account/ChangePasswordForm.tsx");
    const successBlock = source.split("// Success: clear every password field")[1]!;
    expect(successBlock).toMatch(/setCurrentPassword\(""\)/);
    expect(successBlock).toMatch(/setNewPassword\(""\)/);
    expect(successBlock).toMatch(/setConfirmPassword\(""\)/);
    expect(successBlock).toMatch(/setIsCurrentPasswordVisible\(false\)/);
    expect(successBlock).toMatch(/setIsNewPasswordVisible\(false\)/);
    expect(successBlock).toMatch(/setIsConfirmPasswordVisible\(false\)/);
  });

  it("SecurityDialog unmounting its children is what actually clears form state on close (no manual clear-on-close needed elsewhere)", () => {
    const source = readFile("components/account/SecuritySection.tsx");
    expect(source).toMatch(/activeDialog === "password" &&/);
    expect(source).toMatch(/setActiveDialog\(null\)/);
  });
});

describe("Password visibility toggles (Change Password)", () => {
  const source = readFile("components/account/ChangePasswordForm.tsx");
  const stripped = stripComments(source);

  it("imports the shared PasswordVisibilityToggle rather than inventing a one-off toggle", () => {
    expect(source).toMatch(/from ["']@\/components\/ui\/PasswordVisibilityToggle["']/);
  });

  it("current/new/confirm each own a separate visibility flag -- never one shared toggle", () => {
    expect(source).toMatch(/isCurrentPasswordVisible/);
    expect(source).toMatch(/isNewPasswordVisible/);
    expect(source).toMatch(/isConfirmPasswordVisible/);
    expect(stripped).not.toMatch(/isPasswordVisible\b/);
  });

  it("never persists visibility state to localStorage/sessionStorage", () => {
    expect(stripped).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("Sign out other devices uses the native scoped signOut, never affecting the current device", () => {
  const source = readFile("components/account/SecuritySection.tsx");

  it("calls auth.signOut({ scope: 'others' })", () => {
    expect(source).toMatch(/auth\.signOut\(\{\s*scope:\s*["']others["']\s*\}\)/);
  });

  it("SecuritySection itself never calls signOut with scope 'global' -- that only happens inside ChangePasswordForm", () => {
    const signOutCalls = source.match(/auth\.signOut\([^)]*\)/g) ?? [];
    expect(signOutCalls.length).toBe(1);
    expect(signOutCalls[0]).toMatch(/scope:\s*["']others["']/);
  });

  it("requires a confirmation dialog (reuses the existing ConfirmDialog) before calling signOut", () => {
    expect(source).toMatch(/from ["']@\/components\/seller\/ConfirmDialog["']/);
    expect(source).toMatch(/title="Sign out other devices\?"/);
  });

  it("remains an independent, purely manual action -- SecuritySection never opens it automatically", () => {
    expect(source).not.toMatch(/useEffect/);
  });
});

describe("Existing Sign out (normal) is completely untouched", () => {
  it("lib/auth/actions.ts's signOutAction is unchanged: plain supabase.auth.signOut() with no scope, still redirects home", () => {
    const source = readFile("lib/auth/actions.ts");
    expect(source).toMatch(/await supabase\.auth\.signOut\(\);/);
    expect(source).not.toMatch(/scope/);
    expect(source).toMatch(/redirect\("\/"\)/);
  });

  it("app/account/page.tsx's Account section still submits to signOutAction via a plain form, unchanged", () => {
    const source = readFile("app/account/page.tsx");
    expect(source).toMatch(/form action=\{signOutAction\}/);
  });
});

describe("Account page section order and marketplace links are preserved", () => {
  const source = readFile("app/account/page.tsx");

  it("Security section is rendered between the profile form and the Marketplace section", () => {
    const profileFormIndex = source.indexOf("<AccountProfileForm");
    const securityIndex = source.indexOf("<SecuritySection");
    const marketplaceIndex = source.indexOf('<h2 className="text-sm font-semibold text-ink">Marketplace</h2>');
    expect(profileFormIndex).toBeGreaterThan(-1);
    expect(securityIndex).toBeGreaterThan(profileFormIndex);
    expect(marketplaceIndex).toBeGreaterThan(securityIndex);
  });

  it("SecuritySection is rendered with no email prop -- it no longer needs the account email at all", () => {
    expect(source).toMatch(/<SecuritySection\s*\/>/);
  });

  it("marketplace links are unchanged: My Orders/Customer Orders/My Shop/My Listings/Favorites", () => {
    expect(source).toMatch(/href="\/orders"[\s\S]{0,500}My Orders/);
    expect(source).toMatch(/href="\/seller\/orders"[\s\S]{0,500}Customer Orders/);
    expect(source).toMatch(/href="\/seller\/shop"[\s\S]{0,500}My Shop/);
    expect(source).toMatch(/href="\/seller\/listings"[\s\S]{0,500}My Listings/);
    expect(source).toMatch(/href="\/favorites"[\s\S]{0,500}Favorites/);
  });

  it("Request account deletion still links only to /support, no invented query param", () => {
    expect(source).toMatch(/href="\/support"/);
    expect(source).not.toMatch(/\/support\?/);
  });
});

describe("Contact section: email stays read-only/private, with a Support link for email-change help", () => {
  const source = readFile("components/account/AccountProfileForm.tsx");

  it("still renders the email as plain read-only text, never an editable input", () => {
    expect(source).toMatch(/\{email\}/);
    expect(source).not.toMatch(/<input[^>]*value=\{email\}/);
  });

  it("email is still tagged Private", () => {
    const emailBlockStart = source.indexOf("Email <PrivacyTag");
    expect(emailBlockStart).toBeGreaterThan(-1);
    const emailBlock = source.slice(emailBlockStart, emailBlockStart + 400);
    expect(emailBlock).toMatch(/level="private"/);
  });

  it("offers a Contact Support link pointing at the existing /support flow, no invented query param", () => {
    expect(source).toMatch(/href="\/support"[\s\S]{0,300}Contact Support/);
    expect(source).not.toMatch(/\/support\?/);
  });

  it("never calls auth.updateUser({ email }) itself", () => {
    expect(stripComments(source)).not.toMatch(/updateUser\(\s*\{\s*email:/);
  });
});

describe("Mobile bottom navigation remains untouched by this slice", () => {
  it("MobileBottomNav still has exactly 5 tabs and is not imported by any security file", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    const tabCount = (source.match(/<li className="flex-1">/g) ?? []).length;
    expect(tabCount).toBe(5);

    for (const file of SECURITY_FILES) {
      expect(stripComments(readFile(file))).not.toMatch(/MobileBottomNav/);
    }
  });
});

describe("Profile/Location/Contact behavior from the prior slice is untouched", () => {
  it("AccountProfileForm still owns display_name/first_name/last_name/bio/mobile/location via update_my_profile", () => {
    const source = readFile("components/account/AccountProfileForm.tsx");
    expect(source).toMatch(/updateMyProfile/);
    expect(source).not.toMatch(/auth\.updateUser|auth\.reauthenticate|auth\.signOut/);
  });

  it("AccountProfileForm and the Security components remain fully independent -- neither imports the other", () => {
    const profileFormSource = readFile("components/account/AccountProfileForm.tsx");
    expect(profileFormSource).not.toMatch(/SecuritySection|SecurityDialog|ChangePasswordForm/);

    const securitySectionSource = stripComments(readFile("components/account/SecuritySection.tsx"));
    expect(securitySectionSource).not.toMatch(/AccountProfileForm/);
  });
});
