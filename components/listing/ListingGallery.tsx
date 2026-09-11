"use client";

import { useState } from "react";
import Image from "next/image";
import { Package } from "lucide-react";
import { cn } from "@/lib/cn";
import { ListingLightbox } from "@/components/listing/ListingLightbox";

type Props = {
  images: string[];
  title: string;
};

/**
 * Server-rendered initial markup (the first image paints without any JS),
 * with thumbnail selection as the one purely-local client interaction --
 * no carousel library, just CSS scroll-snap + next/image, per the approved
 * constraint. `selected` is the single source of truth for "which image is
 * active," shared with ListingLightbox (opened on click) rather than
 * duplicated into a second piece of state there.
 */
export function ListingGallery({ images, title }: Props) {
  const [selected, setSelected] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/5] w-full items-center justify-center rounded-[14px] bg-divider">
        <Package className="h-12 w-12 text-ink-muted/60" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsLightboxOpen(true)}
        aria-label={`View full-size photo, image ${selected + 1} of ${images.length}`}
        className="relative aspect-[4/5] w-full cursor-zoom-in overflow-hidden rounded-[14px] bg-divider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Image
          key={images[selected]}
          src={images[selected]}
          alt={title}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
        />
      </button>

      {images.length > 1 && (
        <div
          role="tablist"
          aria-label="Listing images"
          className="mt-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((src, index) => (
            <button
              key={src}
              type="button"
              role="tab"
              aria-selected={index === selected}
              aria-label={`Show image ${index + 1} of ${images.length}`}
              onClick={() => setSelected(index)}
              className={cn(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                index === selected ? "border-brand-link" : "border-transparent",
              )}
            >
              <Image src={src} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {isLightboxOpen && (
        <ListingLightbox
          images={images}
          title={title}
          selectedIndex={selected}
          onSelectedIndexChange={setSelected}
          onClose={() => setIsLightboxOpen(false)}
        />
      )}
    </div>
  );
}
