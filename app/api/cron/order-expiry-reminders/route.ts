import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCronSecret } from "@/lib/email/env";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Cron-invoked, secret-protected only. Calls
 * enqueue_pending_order_expiry_reminders (PRD 21.7's ~24h-before-72h
 * seller reminder) via the service-role client -- all eligibility and
 * idempotency logic lives in that SQL function; this route is a dumb,
 * replaceable trigger with zero business logic, matching
 * ARCHITECTURE.md 19's own "do not introduce a complex queue system"
 * guidance and 0024's own established scheduler precedent.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("enqueue_pending_order_expiry_reminders", { p_limit: 200 });
    if (error) {
      throw new Error(error.message);
    }
    return NextResponse.json({ enqueued: Array.isArray(data) ? data.length : 0 });
  } catch (err) {
    console.error("order-expiry-reminders cron route failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
