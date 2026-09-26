"use client";

import { useRef, useState } from "react";
import { Share2, Link2 } from "lucide-react";
import { getAppUrl } from "@/lib/env";
import { notifyError, notifySuccess } from "@/lib/notifications/toast";

type Props = {
  /** The listing's authoritative route identity (public_code) -- never a
   * title-derived slug guess and never read from the current URL's own
   * query/tracking params, so the shared/copied link is always the
   * canonical /item/{publicCode} route regardless of how this page was
   * reached. */
  publicCode: string;
  title: string;
};

const buttonClass =
  "inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

async function writeToClipboard(url: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guest-visible, no-auth-required Share + Copy Link pair for the public
 * listing detail page. Both build the URL the same way, from getAppUrl()
 * (this codebase's existing NEXT_PUBLIC_APP_URL-backed helper, already
 * used client-side elsewhere -- see SignUpForm/ForgotPasswordForm) plus
 * the authoritative publicCode prop -- never window.location.href/search,
 * which could carry tracking params, and never the title.
 *
 * Share calls navigator.share when available. A user dismissing the
 * native share sheet throws AbortError -- a normal cancellation, not a
 * failure, so it shows no toast at all and never falls back to copying.
 * A successful native share shows no toast either: the OS's own share
 * sheet already gave the user its own completion feedback, and this
 * codebase's own LAUNCH UX S1.2 policy is to avoid a toast that would
 * only repeat confirmation the UI already visibly gave. When native
 * share is unavailable, Share falls back to the same clipboard-copy path
 * as Copy Link, with the same accurate success/failure feedback.
 *
 * Copy Link always attempts a clipboard copy, even on a device that also
 * supports native sharing -- it never calls navigator.share.
 *
 * Neither button is ever hidden for missing browser support: clicking
 * still runs the real capability check and reports a truthful failure
 * (never a false success) if nothing worked.
 */
export function ShareActions({ publicCode, title }: Props) {
  const [isSharing, setIsSharing] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  // Synchronous in-flight guards, checked and set BEFORE any await. A
  // useState value is only guaranteed to reflect its own update once
  // React has committed a re-render -- two clicks dispatched within the
  // same batch (no commit in between; verified empirically, not assumed)
  // would both read the same stale, pre-update state and both pass the
  // check. A ref's .current mutation is visible to the very next line of
  // synchronous code, regardless of any render/commit timing, so it is
  // the actual concurrency guard; isSharing/isCopying remain solely for
  // the button's own disabled-presentation state below.
  const isSharingRef = useRef(false);
  const isCopyingRef = useRef(false);

  function buildUrl(): string {
    return `${getAppUrl()}/item/${publicCode}`;
  }

  async function handleShare() {
    if (isSharingRef.current) return;
    isSharingRef.current = true;
    setIsSharing(true);
    try {
      const url = buildUrl();
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
      const copied = await writeToClipboard(url);
      if (copied) {
        notifySuccess("Link copied");
      } else {
        notifyError("Couldn't share this listing. Please copy the link manually.");
      }
    } catch (err) {
      // AbortError: the user closed/cancelled the native share sheet --
      // a normal dismissal, not a failure. navigator.share() rejects with
      // a real DOMException here, which does NOT extend Error in
      // browsers/jsdom, so this checks `name` directly rather than
      // `err instanceof Error` (which would silently miss it and fall
      // through to the generic failure toast below). Every other thrown
      // error (permission denied, no user gesture, etc.) is genuine.
      if (typeof err === "object" && err !== null && "name" in err && err.name === "AbortError") return;
      notifyError("Couldn't share this listing. Please try again.");
    } finally {
      isSharingRef.current = false;
      setIsSharing(false);
    }
  }

  async function handleCopyLink() {
    if (isCopyingRef.current) return;
    isCopyingRef.current = true;
    setIsCopying(true);
    const copied = await writeToClipboard(buildUrl());
    if (copied) {
      notifySuccess("Link copied");
    } else {
      notifyError("Couldn't copy the link. Please copy it manually.");
    }
    isCopyingRef.current = false;
    setIsCopying(false);
  }

  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => void handleShare()} disabled={isSharing} className={buttonClass}>
        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
        Share
      </button>
      <button type="button" onClick={() => void handleCopyLink()} disabled={isCopying} className={buttonClass}>
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        Copy link
      </button>
    </div>
  );
}
