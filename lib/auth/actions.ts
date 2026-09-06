"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Server Action: Server Actions (unlike plain Server Components) can
 * write cookies, so this is the correct place to clear the Supabase
 * session -- letting the client library manage the cookies rather than
 * touching them directly. */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
