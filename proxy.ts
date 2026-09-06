import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16 renamed the middleware.ts file convention to proxy.ts (the
// exported function must be named `proxy`, not `middleware`) -- this is
// the current, non-deprecated form for this project's Next.js version.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets and image optimization -- everything else
    // (including every page route) goes through the session refresh.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
