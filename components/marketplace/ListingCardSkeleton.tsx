export function ListingCardSkeleton() {
  return (
    <div className="w-[44%] shrink-0 snap-start sm:w-[30%] lg:w-auto" aria-hidden="true">
      <div className="aspect-[4/5] w-full animate-pulse rounded-[14px] bg-divider" />
      <div className="mt-2 space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-divider" />
        <div className="h-4 w-full animate-pulse rounded bg-divider" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-divider" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-divider" />
      </div>
    </div>
  );
}
