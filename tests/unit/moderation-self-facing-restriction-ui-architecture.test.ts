import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips // line comments and /* block comments *\/ so a static
 * assertion about actual code can't false-positive on a comment's own
 * prose discussing (by name) the exact pattern being asserted against --
 * same technique already established in floating-messenger-slice-
 * architecture.test.ts and buy-now-architecture.test.ts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readCode(relativePath: string): string {
  return stripComments(readFile(relativePath));
}

/** Every file this A2.1 self-facing restriction-visibility slice touches or
 * adds. Kept as one explicit list here so the privacy/architecture
 * checklist below reads as a single audit trail, matching the established
 * convention used by realtime-slice-2/3 and floating-messenger-slice's own
 * equivalent lists. */
const A2_1_FILES = [
  "lib/moderation/get-my-active-restrictions.ts",
  "lib/moderation/restriction-copy.ts",
  "components/account/AccountStatusSection.tsx",
  "components/moderation/AccountSuspendedBanner.tsx",
  "app/account/page.tsx",
  "app/layout.tsx",
  "lib/notifications/get-my-notifications.ts",
  "lib/notifications/notification-copy.ts",
];

describe("A2.1 self-facing restriction UI -- never touches the admin-only surface", () => {
  it("no A2.1 file's actual code references get_admin_user_restrictions", () => {
    for (const file of A2_1_FILES) {
      expect(readCode(file)).not.toMatch(/get_admin_user_restrictions/);
    }
  });

  it("no A2.1 file's actual code references moderation_actions", () => {
    for (const file of A2_1_FILES) {
      expect(readCode(file)).not.toMatch(/moderation_actions/);
    }
  });

  it("no A2.1 file's actual code references admin-only restriction fields (issued_by, lifted_by, and their display-name variants)", () => {
    for (const file of A2_1_FILES) {
      const code = readCode(file);
      expect(code).not.toMatch(/issued_by/);
      expect(code).not.toMatch(/issued_by_display_name/);
      expect(code).not.toMatch(/lifted_by/);
      expect(code).not.toMatch(/lifted_by_display_name/);
      expect(code).not.toMatch(/issuedBy/);
      expect(code).not.toMatch(/liftedBy/);
    }
  });

  it("no A2.1 file's actual code queries user_restrictions directly (public.user_restrictions or a bare .from(\"user_restrictions\"))", () => {
    for (const file of A2_1_FILES) {
      const code = readCode(file);
      expect(code).not.toMatch(/from\(["']user_restrictions["']\)/);
      expect(code).not.toMatch(/public\.user_restrictions/);
    }
  });

  it("the self-facing wrapper calls get_my_active_restrictions and only that RPC", () => {
    const code = readCode("lib/moderation/get-my-active-restrictions.ts");
    expect(code).toMatch(/\.rpc\(\s*["']get_my_active_restrictions["']\s*\)/);
    const rpcCalls = code.match(/\.rpc\(/g) ?? [];
    expect(rpcCalls).toHaveLength(1);
  });

  it("no A2.1 file's actual code accepts a caller-supplied user/target id to fetch another user's restrictions", () => {
    for (const file of A2_1_FILES) {
      expect(readCode(file)).not.toMatch(/p_user_id/);
    }
  });
});

describe("A2.1 -- no service-role key/client anywhere in the browser-facing code", () => {
  it("no A2.1 file references a service-role key", () => {
    for (const file of A2_1_FILES) {
      const source = readFile(file).toLowerCase();
      expect(source).not.toContain("service_role");
      expect(source).not.toContain("service-role");
    }
  });
});

describe("A2.1 -- MyActiveRestriction never carries a disallowed field", () => {
  it("the wrapper's own typed model has exactly restrictionId/restrictionType/reason/createdAt -- no expiry, moderator identity, or severity", () => {
    const source = readFile("lib/moderation/get-my-active-restrictions.ts");
    const typeMatch = source.match(/export type MyActiveRestriction = \{([\s\S]*?)\};/);
    expect(typeMatch).not.toBeNull();
    const body = typeMatch![1];
    expect(body).toMatch(/restrictionId: string;/);
    expect(body).toMatch(/restrictionType: RestrictionType;/);
    expect(body).toMatch(/reason: string;/);
    expect(body).toMatch(/createdAt: string;/);
    expect(body).not.toMatch(/expires|expiry|severity|moderator/i);
    // Exactly four fields -- count property lines.
    const fieldLines = body.split("\n").map((line) => line.trim()).filter((line) => line.endsWith(";"));
    expect(fieldLines).toHaveLength(4);
  });
});

describe("A2.1 -- migration scope", () => {
  it("no new migration file was created for this slice -- 0100 remains the next unused number", () => {
    for (const file of A2_1_FILES) {
      expect(file.startsWith("supabase/migrations/")).toBe(false);
    }
  });
});
