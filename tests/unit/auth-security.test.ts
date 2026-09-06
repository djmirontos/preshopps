import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AUTH_SOURCE_FILES = [
  "lib/auth/session.ts",
  "lib/auth/actions.ts",
  "lib/auth/safe-redirect.ts",
  "lib/auth/errors.ts",
  "lib/auth/use-is-authenticated.ts",
  "lib/supabase/proxy.ts",
  "proxy.ts",
  "app/auth/confirm/route.ts",
  "app/sign-in/page.tsx",
  "app/sign-up/page.tsx",
  "app/forgot-password/page.tsx",
  "app/reset-password/page.tsx",
  "app/account/page.tsx",
  "components/auth/SignInForm.tsx",
  "components/auth/SignUpForm.tsx",
  "components/auth/ForgotPasswordForm.tsx",
  "components/auth/ResetPasswordForm.tsx",
  "components/auth/AuthGate.tsx",
  "components/auth/AccountMenu.tsx",
  "components/auth/AuthStatusProvider.tsx",
];

function readAuthFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("auth security review (source scan)", () => {
  it("never references a service-role key anywhere in the new auth code", () => {
    for (const file of AUTH_SOURCE_FILES) {
      const source = readAuthFile(file);
      expect(source, `${file} must not reference service_role`).not.toMatch(/service_role/i);
      expect(source, `${file} must not reference SUPABASE_SERVICE_ROLE`).not.toMatch(
        /SUPABASE_SERVICE_ROLE/,
      );
    }
  });

  it("never manually writes an auth token to localStorage/sessionStorage", () => {
    for (const file of AUTH_SOURCE_FILES) {
      const source = readAuthFile(file);
      expect(source, `${file} must not touch localStorage`).not.toMatch(/localStorage\s*\.\s*setItem/);
      expect(source, `${file} must not touch sessionStorage`).not.toMatch(
        /sessionStorage\s*\.\s*setItem/,
      );
    }
  });

  it("never logs a password or access/refresh token", () => {
    for (const file of AUTH_SOURCE_FILES) {
      const source = readAuthFile(file);
      expect(source, `${file} must not console.log a password`).not.toMatch(
        /console\.\w+\([^)]*password/i,
      );
      expect(source, `${file} must not console.log a token`).not.toMatch(/console\.\w+\([^)]*token/i);
    }
  });

  it("never puts credentials/tokens directly in a URL or query string", () => {
    for (const file of AUTH_SOURCE_FILES) {
      const source = readAuthFile(file);
      expect(source, `${file} must not embed a password in a URL`).not.toMatch(
        /[?&]password=/i,
      );
    }
  });

  it("the proxy (session refresh) never adds logic between client creation and getUser()", () => {
    const source = readAuthFile("lib/supabase/proxy.ts");
    const clientIndex = source.indexOf("createServerClient(");
    const getUserIndex = source.indexOf(".auth.getUser()");
    expect(clientIndex).toBeGreaterThan(-1);
    expect(getUserIndex).toBeGreaterThan(clientIndex);
  });

  it("getSafeNextPath is the only thing used to build a next= redirect anywhere auth pages read it", () => {
    for (const file of ["app/sign-in/page.tsx", "app/sign-up/page.tsx", "app/auth/confirm/route.ts"]) {
      const source = readAuthFile(file);
      expect(source, `${file} must validate next via getSafeNextPath`).toContain("getSafeNextPath");
    }
  });

  it("the shared auth-status hook does not create its own Supabase client or subscription", () => {
    const source = readAuthFile("lib/auth/use-is-authenticated.ts");
    expect(source, "must not import the Supabase client directly").not.toMatch(
      /@\/lib\/supabase\/client/,
    );
    expect(source, "must not install its own onAuthStateChange subscription").not.toMatch(
      /onAuthStateChange/,
    );
    expect(source, "must not call getUser/getSession directly").not.toMatch(/\.auth\.getUser\(/);
  });

  it("FavoriteButton reads auth status from the shared context, not its own subscription", () => {
    // FavoriteButton legitimately imports the Supabase client now (to call
    // the real add_favorite/remove_favorite RPCs), but must still get its
    // guest/authenticated status from the shared AuthStatusProvider context
    // rather than creating a second, per-button getUser/getSession/
    // onAuthStateChange subscription -- the exact N+1-subscription problem
    // useIsAuthenticated was introduced to solve.
    const source = readFileSync(
      path.join(process.cwd(), "components/marketplace/FavoriteButton.tsx"),
      "utf-8",
    );
    expect(source, "must use the shared useIsAuthenticated hook").toContain("useIsAuthenticated");
    expect(source, "must not call getUser/getSession directly").not.toMatch(/\.auth\.getUser\(|\.auth\.getSession\(/);
    expect(source, "must not install its own onAuthStateChange subscription").not.toMatch(/onAuthStateChange/);
  });

  it("FavoriteButton's mutation calls never pass a client-supplied user id", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/marketplace/FavoriteButton.tsx"),
      "utf-8",
    );
    expect(source, "must call the existing add_favorite/remove_favorite RPCs").toMatch(
      /rpc\(\s*["']add_favorite["']/,
    );
    expect(source).toMatch(/rpc\(\s*["']remove_favorite["']/);
    // Only the listing id is ever sent -- the caller's identity comes from
    // the RPC's own auth.uid(), never a user_id argument from the client.
    expect(source, "must never send a user_id/p_user_id argument").not.toMatch(/user_id\s*:/);
  });

  it("the confirm callback never blindly forwards to next without a verified credential", () => {
    const source = readAuthFile("app/auth/confirm/route.ts");
    expect(source).toContain("exchangeCodeForSession");
    expect(source).toContain("verifyOtp");
    expect(source).toContain("auth_error=invalid_link");
  });
});
