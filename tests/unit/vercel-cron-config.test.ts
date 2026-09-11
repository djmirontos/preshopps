import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("vercel.json -- no platform Cron schedule remains for email processing; Supabase Cron is the sole scheduler", () => {
  const raw = readFile("vercel.json");
  const config: Record<string, unknown> = JSON.parse(raw);

  it("is valid, parseable JSON", () => {
    expect(config).toBeTypeOf("object");
  });

  it("contains no crons key at all -- Vercel Cron is no longer used for email scheduling", () => {
    expect(config).not.toHaveProperty("crons");
  });

  it("never mentions the two email-processing paths in any residual config", () => {
    expect(raw).not.toMatch(/process-email-outbox|order-expiry-reminders/);
  });

  it("does not configure a once-daily cron as a downgraded replacement", () => {
    // A once-daily-only fallback was explicitly rejected by this task's
    // own instruction ("Do NOT downgrade transactional email processing
    // to once daily") -- confirm no crons array of any frequency exists.
    expect(raw).not.toMatch(/"crons"\s*:/);
  });
});
