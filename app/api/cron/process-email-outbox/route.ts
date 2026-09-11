import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processEmailOutbox } from "@/lib/email/process-email-outbox";
import { getCronSecret } from "@/lib/email/env";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Cron-invoked, secret-protected only -- never reachable by a browser
 * session. Drains a bounded batch of due/stale email_outbox rows via the
 * service-role client. No browser can invoke this: the CRON_SECRET check
 * fails closed (401) whenever the secret is unset or does not match.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleClient();
    const result = await processEmailOutbox({ supabase });
    return NextResponse.json(result);
  } catch (err) {
    console.error("process-email-outbox cron route failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
