"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Props = {
  images: string[];
  title: string;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onClose: () => void;
};

const SWIPE_THRESHOLD_PX = 40;

/**
 * Full-screen photo viewer opened from ListingGallery's main image (or a
 * thumbnail). Deliberately controlled by ListingGallery's own `selected`
 * state rather than keeping a second copy here -- there is exactly one
 * "which image is active" value for the whole listing, shared by the
 * gallery and this overlay, per the approved "extend, don't duplicate"
 * constraint. Same accessible-overlay conventions as ComposeMessageDialog/
 * AuthGate (role=dialog, aria-modal, focus trap, Escape-to-close, focus
 * return to whatever triggered it), extended with ArrowLeft/ArrowRight
 * navigation and a minimal touch-swipe handler -- no carousel/lightbox
 * dependency.
 */
export function ListingLightbox({ images, title, selectedIndex, onSelectedIndexChange, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const isFirst = selectedIndex === 0;
  const isLast = selectedIndex === images.length - 1;

  function showPrevious() {
    if (!isFirst) onSelectedIndexChange(selectedIndex - 1);
  }

  function showNext() {
    if (!isLast) onSelectedIndexChange(selectedIndex + 1);
  }

  // Read through a ref inside the keydown handler (rather than depending on
  // selectedIndex/onSelectedIndexChange in the effect below) so the
  // mount/unmount-only effect never tears down and re-runs on every
  // arrow-key press -- that would otherwise re-capture
  // document.activeElement mid-session and needlessly bounce focus.
  const latest = useRef({ showPrevious, showNext, onClose });
  useEffect(() => {
    latest.current = { showPrevious, showNext, onClose };
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        latest.current.onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        latest.current.showPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        latest.current.showNext();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const deltaX = endX - touchStartX.current;
    touchStartX.current = null;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return;
    if (deltaX < 0) {
      showNext();
    } else {
      showPrevious();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} photos`}
        tabIndex={-1}
        className="flex h-full w-full flex-col outline-none"
      >
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          {images.length > 1 ? (
            <p className="text-sm font-medium text-white/80">
              {selectedIndex + 1} / {images.length}
            </p>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo viewer"
            className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        <div
          className="relative min-h-0 flex-1"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="relative h-full w-full">
            <Image
              key={images[selectedIndex]}
              src={images[selectedIndex]}
              alt={`${title} - photo ${selectedIndex + 1} of ${images.length}`}
              fill
              sizes="100vw"
              className="object-contain"
            />
          </div>

          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={showPrevious}
                disabled={isFirst}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-30 sm:left-4"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={showNext}
                disabled={isLast}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-30 sm:right-4"
              >
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        {images.length > 1 && (
          <div
            role="tablist"
            aria-label="Listing photos"
            className="flex gap-2 overflow-x-auto px-4 py-3 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
          >
            {images.map((src, index) => (
              <button
                key={src}
                type="button"
                role="tab"
                aria-selected={index === selectedIndex}
                aria-label={`Show photo ${index + 1} of ${images.length}`}
                onClick={() => onSelectedIndexChange(index)}
                className={cn(
                  "relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                  index === selectedIndex ? "border-white" : "border-transparent opacity-60",
                )}
              >
                <Image src={src} alt="" fill sizes="64px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
