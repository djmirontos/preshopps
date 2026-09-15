import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips //, /* *\/ comments so a "must NOT contain X" assertion can't
 * false-positive on a comment merely explaining (by name) the thing
 * being asserted absent. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const RECOVERY_FILES = [
  "components/auth/ForgotPasswordForm.tsx",
  "components/auth/ResetPasswordForm.tsx",
  "lib/auth/recovery-errors.ts",
];

describe("Forgot Password recovery-code slice adds no backend/migration change", () => {
  it("no migration newer than 0092 exists -- this is a frontend/auth-only slice (0093 is a later, separately-approved migration)", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newer = migrationFiles.filter((f) => f > "0092_account_profile_management.sql");
    expect(newer).toEqual(["0093_seller_order_messaging.sql"]);
  });

  it("no recovery file references a database table, RPC name, or storage bucket", () => {
    for (const file of RECOVERY_FILES) {
      const source = stripComments(readFile(file));
      expect(source).not.toMatch(/\.from\(\s*["'][a-z_]+["']\s*\)/);
      expect(source).not.toMatch(/\.rpc\(/);
      expect(source).not.toMatch(/\.storage\./);
    }
  });

  it("no recovery file uses service_role or an admin Auth API", () => {
    for (const file of RECOVERY_FILES) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source).not.toMatch(/auth\.admin\./);
    }
  });

  it("no custom OTP table/RPC is introduced -- verifyOtp is the native Supabase call", () => {
    const source = readFile("components/auth/ForgotPasswordForm.tsx");
    expect(source).toMatch(/auth\.verifyOtp\(/);
    expect(source).not.toMatch(/otp_codes|recovery_codes|verification_codes/i);
  });
});

describe("ForgotPasswordForm: email is transient, never persisted", () => {
  const source = stripComments(readFile("components/auth/ForgotPasswordForm.tsx"));

  it("never writes to localStorage/sessionStorage/cookies", () => {
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/document\.cookie\s*=/);
  });

  it("never puts the email into a URL/query param", () => {
    expect(source).not.toMatch(/searchParams\.(set|append)\(["']email/i);
    expect(source).not.toMatch(/[?&]email=/);
  });
});

describe("ForgotPasswordForm: a genuine request failure keeps the user on step 1", () => {
  const source = readFile("components/auth/ForgotPasswordForm.tsx");

  it("checks resetPasswordForEmail's own error before advancing to step 2", () => {
    const callIndex = source.indexOf("await supabase.auth.resetPasswordForEmail(email.trim()");
    expect(callIndex).toBeGreaterThan(-1);
    const setStepCodeIndex = source.indexOf('setStep("code")');
    const errorCheckIndex = source.indexOf("if (error) {", callIndex);
    expect(errorCheckIndex).toBeGreaterThan(callIndex);
    expect(errorCheckIndex).toBeLessThan(setStepCodeIndex);
  });

  it("uses mapRecoveryRequestError for both the initial request and resend, never a hardcoded rate-limit-only guess", () => {
    const mapperCallCount = (source.match(/mapRecoveryRequestError\(/g) ?? []).length;
    expect(mapperCallCount).toBe(2);
  });

  it("never advances to step 2 or clears requestError inside the error branch", () => {
    const errorBranch = source.slice(source.indexOf("if (error) {"), source.indexOf("return;\n    }", source.indexOf("if (error) {")));
    expect(errorBranch).not.toMatch(/setStep\("code"\)/);
  });
});

describe("lib/auth/recovery-errors.ts: request-failure mapper never echoes the raw message", () => {
  const source = readFile("lib/auth/recovery-errors.ts");

  it("exports RECOVERY_REQUEST_FAILED_MESSAGE and mapRecoveryRequestError", () => {
    expect(source).toMatch(/export const RECOVERY_REQUEST_FAILED_MESSAGE =/);
    expect(source).toMatch(/export function mapRecoveryRequestError/);
  });

  it("mapRecoveryRequestError only ever returns one of the two fixed strings, never error.message directly", () => {
    const fnStart = source.indexOf("export function mapRecoveryRequestError");
    const fnBody = source.slice(fnStart, source.indexOf("\n}", fnStart));
    expect(fnBody).not.toMatch(/return\s+message\b/);
    expect(fnBody).not.toMatch(/error\.message/);
  });
});

describe("ForgotPasswordForm: step 2 uses the native recovery OTP, not current_password", () => {
  const source = readFile("components/auth/ForgotPasswordForm.tsx");

  it("verifyOtp is called with type 'recovery'", () => {
    expect(source).toMatch(/type:\s*"recovery"/);
  });

  it("the final password update never includes current_password", () => {
    const updateUserCallIndex = source.indexOf("auth.updateUser({ password: newPassword })");
    expect(updateUserCallIndex).toBeGreaterThan(-1);
    expect(stripComments(source)).not.toMatch(/current_password/);
  });
});

describe("ForgotPasswordForm: success is a mandatory global sign-out, no auto-retry", () => {
  const source = readFile("components/auth/ForgotPasswordForm.tsx");
  const stripped = stripComments(source);

  it("calls signOut({ scope: 'global' })", () => {
    expect(source).toMatch(/auth\.signOut\(\{\s*scope:\s*["']global["']\s*\}\)/);
  });

  it("never auto-retries the sign-out call", () => {
    expect(stripped).not.toMatch(/retry|attempt.*\+\+|for\s*\(.*signOut/i);
  });

  it("no console call ever includes the password, code, or a raw session/user value", () => {
    const consoleCalls = stripped.match(/console\.(log|error|warn|info)\([^)]*\)/g) ?? [];
    for (const call of consoleCalls) {
      expect(call).not.toMatch(/\b(newPassword|confirmPassword|code)\b/);
      expect(call).not.toMatch(/\bdata\.session\b|\bdata\.user\b/);
    }
  });
});

describe("Existing /reset-password link-based fallback remains functional", () => {
  it("app/reset-password/page.tsx still exists and renders ResetPasswordForm", () => {
    const source = readFile("app/reset-password/page.tsx");
    expect(source).toMatch(/ResetPasswordForm/);
  });

  it("ResetPasswordForm still relies on detectSessionInUrl/onAuthStateChange for old links, unchanged", () => {
    const source = readFile("components/auth/ResetPasswordForm.tsx");
    expect(source).toMatch(/onAuthStateChange/);
    expect(source).toMatch(/PASSWORD_RECOVERY/);
    expect(source).toMatch(/getSession\(\)/);
  });

  it("still shows a safe invalid/expired state with a link back to /forgot-password", () => {
    const source = readFile("components/auth/ResetPasswordForm.tsx");
    expect(source).toMatch(/This password reset link is invalid or has expired\./);
    expect(source).toMatch(/href="\/forgot-password"/);
  });

  it("a successful link-based reset now also follows the approved global-signout policy", () => {
    const source = readFile("components/auth/ResetPasswordForm.tsx");
    expect(source).toMatch(/auth\.signOut\(\{\s*scope:\s*["']global["']\s*\}\)/);
    expect(source).toMatch(/router\.push\("\/sign-in"\)/);
  });

  it("a failed sign-out after the link-based reset shows safe guidance instead of falsely redirecting", () => {
    const source = readFile("components/auth/ResetPasswordForm.tsx");
    expect(source).toMatch(/RECOVERY_SIGN_OUT_FAILED_MESSAGE/);
  });

  it("recovery-link detection/updateUser/global-signout/redirect calls are otherwise unchanged by the visibility-toggle addition", () => {
    const source = readFile("components/auth/ResetPasswordForm.tsx");
    expect(source).toMatch(/auth\.updateUser\(\{\s*password\s*\}\)/);
    expect((source.match(/auth\.signOut\(/g) ?? []).length).toBe(1);
    expect((source.match(/router\.push\(/g) ?? []).length).toBe(1);
  });
});

describe("ResetPasswordForm: password visibility toggles (legacy link-based fallback)", () => {
  const source = readFile("components/auth/ResetPasswordForm.tsx");
  const stripped = stripComments(source);

  it("imports the shared PasswordVisibilityToggle rather than inventing a one-off toggle", () => {
    expect(source).toMatch(/from ["']@\/components\/ui\/PasswordVisibilityToggle["']/);
  });

  it("New password and Confirm new password each own a separate visibility flag", () => {
    expect(source).toMatch(/isNewPasswordVisible/);
    expect(source).toMatch(/isConfirmPasswordVisible/);
    expect(stripped).not.toMatch(/isPasswordVisible\b/);
  });

  it("preserves autocomplete=\"new-password\" on both fields", () => {
    const newPasswordCount = (source.match(/autoComplete="new-password"/g) ?? []).length;
    expect(newPasswordCount).toBe(2);
  });

  it("visibility resets to hidden in the same success block that clears the password values", () => {
    const successBlockStart = source.indexOf("setPassword(\"\");");
    expect(successBlockStart).toBeGreaterThan(-1);
    const successBlock = source.slice(successBlockStart, successBlockStart + 300);
    expect(successBlock).toMatch(/setIsNewPasswordVisible\(false\)/);
    expect(successBlock).toMatch(/setIsConfirmPasswordVisible\(false\)/);
  });

  it("never persists visibility state to localStorage/sessionStorage", () => {
    expect(stripped).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("/auth/confirm and email/password Account Security behavior are untouched by this slice", () => {
  it("app/auth/confirm/route.ts has no diff-worthy recovery-specific change -- still handles signup/recovery only", () => {
    const source = readFile("app/auth/confirm/route.ts");
    expect(source).toMatch(/SUPPORTED_EMAIL_OTP_TYPES = \["signup", "recovery"\]/);
  });

  it("ChangePasswordForm.tsx (Account Security) is not imported by any recovery file", () => {
    for (const file of RECOVERY_FILES) {
      expect(stripComments(readFile(file))).not.toMatch(/ChangePasswordForm|SecuritySection/);
    }
  });
});

describe("ForgotPasswordForm: per-step copy owned by the form itself (AuthCard moved out of the page)", () => {
  const source = readFile("components/auth/ForgotPasswordForm.tsx");

  it("app/forgot-password/page.tsx no longer renders a static AuthCard -- ForgotPasswordForm owns it", () => {
    const pageSource = readFile("app/forgot-password/page.tsx");
    expect(stripComments(pageSource)).not.toMatch(/AuthCard/);
    expect(pageSource).toMatch(/<ForgotPasswordForm \/>/);
  });

  it("step 1 keeps its exact title and subtitle", () => {
    expect(source).toMatch(/title = "Forgot your password\?"/);
    expect(source).toMatch(/"Enter your email and we'll send you a password reset code\."/);
  });

  it("step 2 uses the new title and subtitle, never the removed generic success line", () => {
    expect(source).toMatch(/title = "Check your email"/);
    expect(source).toMatch(/"Enter the 6-digit password reset code we sent to your email\."/);
    expect(stripComments(source)).not.toMatch(/If an account exists for that email/);
  });

  it("step 2 never renders the raw email back to the user", () => {
    const codeStepStart = source.indexOf('title = "Check your email"');
    const codeStepEnd = source.indexOf("} else {", codeStepStart);
    expect(codeStepStart).toBeGreaterThan(-1);
    expect(codeStepEnd).toBeGreaterThan(codeStepStart);

    const codeStepBlock = source.slice(codeStepStart, codeStepEnd);
    expect(codeStepBlock).not.toMatch(/\{email\}/);
  });

  it("step 3 uses the new title and subtitle", () => {
    expect(source).toMatch(/title = "Create a new password"/);
    expect(source).toMatch(/"Choose a new password for your Preshopps account\."/);
  });
});

describe("Password visibility toggles (recovery step 3)", () => {
  const source = readFile("components/auth/ForgotPasswordForm.tsx");
  const stripped = stripComments(source);

  it("imports the shared PasswordVisibilityToggle rather than inventing a one-off toggle", () => {
    expect(source).toMatch(/from ["']@\/components\/ui\/PasswordVisibilityToggle["']/);
  });

  it("New password and Confirm new password each own a separate visibility flag", () => {
    expect(source).toMatch(/isNewPasswordVisible/);
    expect(source).toMatch(/isConfirmPasswordVisible/);
    // Never a single shared flag driving both fields' `type` at once.
    expect(stripped).not.toMatch(/isPasswordVisible\b/);
  });

  it("visibility resets to hidden in the same success block that clears the password values", () => {
    const successBlockStart = source.indexOf("setNewPassword(\"\");");
    expect(successBlockStart).toBeGreaterThan(-1);
    const successBlock = source.slice(successBlockStart, successBlockStart + 400);
    expect(successBlock).toMatch(/setIsNewPasswordVisible\(false\)/);
    expect(successBlock).toMatch(/setIsConfirmPasswordVisible\(false\)/);
  });

  it("never persists visibility state to localStorage/sessionStorage", () => {
    expect(stripped).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("components/ui/PasswordVisibilityToggle.tsx: accessible, form-safe toggle button", () => {
  const source = readFile("components/ui/PasswordVisibilityToggle.tsx");

  it("is a real type=\"button\", never type=\"submit\"", () => {
    expect(source).toMatch(/type="button"/);
    expect(source).not.toMatch(/type="submit"/);
  });

  it("builds a field-specific accessible label rather than a generic 'Show password' only", () => {
    expect(source).toMatch(/`Hide \$\{fieldLabel\}`/);
    expect(source).toMatch(/`Show \$\{fieldLabel\}`/);
  });

  it("uses the project's Eye/EyeOff icons from lucide-react", () => {
    expect(source).toMatch(/from ["']lucide-react["']/);
    expect(source).toMatch(/\bEye\b/);
    expect(source).toMatch(/\bEyeOff\b/);
  });

  it("never touches the input's value -- only ever changes visibility state", () => {
    expect(source).not.toMatch(/onChange|value=/);
  });

  it("never persists anything to localStorage/sessionStorage", () => {
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("Mobile-first controls", () => {
  const source = readFile("components/auth/ForgotPasswordForm.tsx");

  it("every input is full-width", () => {
    const inputMatches = source.match(/className=\{?INPUT_CLASS\}?/g) ?? [];
    expect(inputMatches.length).toBeGreaterThan(0);
    expect(source).toMatch(/const INPUT_CLASS =\s*\n\s*"h-12 w-full/);
  });

  it("the recovery code input uses a numeric keyboard via the shared OtpCodeInput", () => {
    expect(source).toMatch(/from ["']@\/components\/auth\/OtpCodeInput["']/);
  });
});
