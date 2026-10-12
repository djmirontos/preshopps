type Props = {
  initialPaths: string[];
  initialUrls: string[];
};

/**
 * PILOT RESTRICTION (owner-approved scope cut for pilot launch): photo
 * upload and removal are temporarily disabled for reviews. This component
 * no longer has an Add Photo control, a file input, a Remove control, or
 * any upload/delete call of any kind -- it only displays a review's own
 * already-existing photos (if any), read-only. It is not the enforcement
 * boundary: create_review/update_review (0118_pilot_disable_new_review_
 * photos.sql) independently reject any newly-attached photo path
 * server-side, so hiding this control is a UX convenience only. A buyer
 * with zero existing photos (every new review) sees no Photos section at
 * all; a buyer editing a review that already has photos still sees them,
 * unchanged, while freely editing rating/text (ReviewFormClient passes
 * the exact same initialPaths straight through to update_review on
 * submit -- nothing here can add, remove, or reorder them). No image is
 * ever deleted by this component.
 */
export function ReviewImagePicker({ initialPaths, initialUrls }: Props) {
  if (initialPaths.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="text-sm font-medium text-ink">Photos</p>
      <div className="mt-2 flex gap-3">
        {initialPaths.map((path, index) => (
          <div key={path} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[10px] border border-border bg-canvas">
            {initialUrls[index] && (
              // next/image requires a configured remote loader or static
              // import, neither of which fits these Storage-backed public
              // URLs any better here than it did in the original picker --
              // a plain <img> is used deliberately for this preview tile.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={initialUrls[index]} alt="" className="h-full w-full object-contain" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
