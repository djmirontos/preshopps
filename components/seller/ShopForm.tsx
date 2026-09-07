"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShopLocationFields, type ShopLocationValue } from "@/components/seller/ShopLocationFields";
import { ShopLogoPicker } from "@/components/seller/ShopLogoPicker";
import {
  createShop,
  updateShop,
  CREATE_SHOP_ERROR_MESSAGES,
  UPDATE_SHOP_ERROR_MESSAGES,
  type ShopFormInput,
} from "@/lib/seller/shop-actions";
import { deleteUploadedImage } from "@/lib/image-processing/upload-image";
import { slugify } from "@/lib/seller/slugify";
import type { LocationRef } from "@/lib/marketplace/reference-data";
import type { ShopStatus } from "@/lib/seller/get-my-shop-profile";

const NAME_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 1000;
const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Props = {
  mode: "create" | "edit";
  ownerId: string;
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
  initialName?: string;
  initialDescription?: string | null;
  initialLocation?: ShopLocationValue;
  initialMessengerLink?: string | null;
  initialLogoPath?: string | null;
  initialLogoUrl?: string;
  initialStatus?: ShopStatus;
  currentSlug?: string;
};

const EMPTY_LOCATION: ShopLocationValue = { provinceId: null, cityId: null, barangayId: null };

/**
 * One form for both "no shop yet" (create) and "already have a shop"
 * (edit) -- mirrors ReviewFormClient's own create/edit dual-mode shape.
 * Logo cleanup mirrors ReviewFormClient's image cleanup exactly, just for
 * a single nullable path instead of an array: on mutation failure, only a
 * logo uploaded *this session* is best-effort deleted; on mutation
 * success, a previously-persisted logo that is no longer the final logo
 * (removed or replaced) is best-effort deleted only after the RPC
 * confirms success, and a cleanup failure never turns a successful save
 * into a visible error.
 */
export function ShopForm({
  mode,
  ownerId,
  provinces,
  initialCities,
  initialBarangays,
  loadCities,
  loadBarangays,
  initialName = "",
  initialDescription = null,
  initialLocation = EMPTY_LOCATION,
  initialMessengerLink = null,
  initialLogoPath = null,
  initialLogoUrl,
  initialStatus = "active",
  currentSlug,
}: Props) {
  const router = useRouter();
  const nameErrorId = useId();
  const slugErrorId = useId();
  const provinceErrorId = useId();
  const cityErrorId = useId();

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [location, setLocation] = useState<ShopLocationValue>(initialLocation);
  const [messengerLink, setMessengerLink] = useState(initialMessengerLink ?? "");
  const [logoPath, setLogoPath] = useState<string | null>(initialLogoPath);
  const [logoUploading, setLogoUploading] = useState(false);
  const [status, setStatus] = useState<ShopStatus>(initialStatus);
  const [slug, setSlug] = useState(() => slugify(initialName));
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; slug?: string; province?: string; city?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nameTooLong = name.length > NAME_MAX_LENGTH;
  const descriptionTooLong = description.length > DESCRIPTION_MAX_LENGTH;
  const noLocationDataYet = provinces.length === 0;

  function handleNameChange(nextName: string) {
    setName(nextName);
    // Auto-generate the "Shop URL" preview from the name until the seller
    // deliberately edits the slug field themselves -- once touched, their
    // own value is never silently overwritten by further name edits.
    if (mode === "create" && !slugManuallyEdited) {
      setSlug(slugify(nextName));
    }
  }

  function handleSlugChange(nextSlug: string) {
    setSlugManuallyEdited(true);
    setSlug(nextSlug);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const errors: typeof fieldErrors = {};
    if (name.trim().length === 0) errors.name = "Please enter a shop name.";
    if (mode === "create") {
      const normalizedSlug = slug.trim().toLowerCase();
      if (normalizedSlug.length === 0) {
        errors.slug = "Please enter a shop URL.";
      } else if (!SLUG_FORMAT.test(normalizedSlug)) {
        errors.slug = "Shop URL must be lowercase letters, numbers, and hyphens only.";
      }
    }
    if (!noLocationDataYet) {
      if (location.provinceId === null) errors.province = "Please choose a province.";
      if (location.cityId === null) errors.city = "Please choose a city or municipality.";
    }
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0 || nameTooLong || descriptionTooLong || logoUploading || noLocationDataYet) {
      return;
    }

    setIsSubmitting(true);
    const input: ShopFormInput = {
      name: name.trim(),
      description: description.trim().length > 0 ? description.trim() : null,
      provinceId: location.provinceId,
      cityId: location.cityId,
      barangayId: location.barangayId,
      messengerLink: messengerLink.trim().length > 0 ? messengerLink.trim() : null,
      logoStoragePath: logoPath,
    };

    if (mode === "create") {
      const result = await createShop(input, slug.trim().toLowerCase());
      setIsSubmitting(false);
      if (!result.ok) {
        setSubmitError(CREATE_SHOP_ERROR_MESSAGES[result.code]);
        if (logoPath && logoPath !== initialLogoPath) {
          await deleteUploadedImage(logoPath).catch(() => {});
        }
        return;
      }
    } else {
      const result = await updateShop(input, status);
      setIsSubmitting(false);
      if (!result.ok) {
        setSubmitError(UPDATE_SHOP_ERROR_MESSAGES[result.code]);
        if (logoPath && logoPath !== initialLogoPath) {
          await deleteUploadedImage(logoPath).catch(() => {});
        }
        return;
      }
    }

    // Best-effort only, after confirmed success -- never lets a cleanup
    // problem make an already-successful save look failed.
    try {
      if (initialLogoPath && initialLogoPath !== logoPath) {
        await deleteUploadedImage(initialLogoPath);
      }
    } catch (err) {
      console.error("Post-save shop logo cleanup threw:", err instanceof Error ? err.message : err);
    }

    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <section>
        <h2 className="text-sm font-semibold text-ink">Shop details</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="shop-name" className="text-sm font-medium text-ink">
              Shop name
            </label>
            <input
              id="shop-name"
              type="text"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              maxLength={NAME_MAX_LENGTH + 40}
              aria-describedby={nameErrorId}
              aria-invalid={Boolean(fieldErrors.name) || nameTooLong}
              className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              placeholder="Anne's Closet"
            />
            <p id={nameErrorId} className={`mt-1 text-xs ${fieldErrors.name || nameTooLong ? "text-danger" : "text-ink-muted"}`}>
              {fieldErrors.name ?? (nameTooLong ? `Please shorten your shop name to ${NAME_MAX_LENGTH} characters or fewer.` : `${name.length}/${NAME_MAX_LENGTH}`)}
            </p>
          </div>

          {mode === "create" && (
            <div>
              <label htmlFor="shop-slug" className="text-sm font-medium text-ink">
                Shop URL
              </label>
              <input
                id="shop-slug"
                type="text"
                value={slug}
                onChange={(event) => handleSlugChange(event.target.value)}
                aria-describedby={slugErrorId}
                aria-invalid={Boolean(fieldErrors.slug)}
                className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                placeholder="annes-closet"
              />
              <p id={slugErrorId} className={`mt-1 text-xs ${fieldErrors.slug ? "text-danger" : "text-ink-muted"}`}>
                {fieldErrors.slug ?? `preshopps.com/shop/${slug || "…"}`}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="shop-description" className="text-sm font-medium text-ink">
              Description <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id="shop-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              placeholder="Tell buyers a little about your shop."
            />
            <p className={`mt-1 text-xs ${descriptionTooLong ? "text-danger" : "text-ink-muted"}`}>
              {descriptionTooLong ? `Please shorten your description to ${DESCRIPTION_MAX_LENGTH} characters or fewer.` : `${description.length}/${DESCRIPTION_MAX_LENGTH}`}
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink">Location</h2>
        <div className="mt-3">
          <ShopLocationFields
            provinces={provinces}
            initialCities={initialCities}
            initialBarangays={initialBarangays}
            initialValue={location}
            loadCities={loadCities}
            loadBarangays={loadBarangays}
            onChange={setLocation}
            provinceErrorId={provinceErrorId}
            cityErrorId={cityErrorId}
          />
          {fieldErrors.province && (
            <p id={provinceErrorId} className="mt-1.5 text-sm text-danger">
              {fieldErrors.province}
            </p>
          )}
          {fieldErrors.city && (
            <p id={cityErrorId} className="mt-1.5 text-sm text-danger">
              {fieldErrors.city}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink">Contact</h2>
        <div className="mt-3">
          <label htmlFor="shop-messenger" className="text-sm font-medium text-ink">
            Messenger link <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="shop-messenger"
            type="url"
            value={messengerLink}
            onChange={(event) => setMessengerLink(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            placeholder="https://m.me/yourshop"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink">Branding</h2>
        <div className="mt-3">
          <ShopLogoPicker
            ownerId={ownerId}
            initialPath={initialLogoPath}
            initialUrl={initialLogoUrl}
            onPathChange={setLogoPath}
            onUploadingChange={setLogoUploading}
          />
        </div>
      </section>

      {mode === "edit" && (
        <section>
          <h2 className="text-sm font-semibold text-ink">Availability</h2>
          <div role="radiogroup" aria-label="Shop availability" className="mt-3 flex gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={status === "active"}
              onClick={() => setStatus("active")}
              className={`h-11 flex-1 rounded-[10px] border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                status === "active" ? "border-brand-action bg-brand-action text-brand-action-text" : "border-border text-ink hover:bg-canvas"
              }`}
            >
              Active
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={status === "away"}
              onClick={() => setStatus("away")}
              className={`h-11 flex-1 rounded-[10px] border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                status === "away" ? "border-brand-action bg-brand-action text-brand-action-text" : "border-border text-ink hover:bg-canvas"
              }`}
            >
              Away
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            {status === "active" ? "Your shop is normally visible to buyers." : "Your shop stays visible, but marked as away."}
          </p>
        </section>
      )}

      {noLocationDataYet && (
        <p className="text-sm text-ink-secondary">
          {mode === "create" ? "Shop creation" : "Saving changes"} requires location data that hasn&rsquo;t been set up yet. Please check back later.
        </p>
      )}

      {submitError && <p className="text-sm text-danger">{submitError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting || logoUploading || noLocationDataYet}
          className="h-11 rounded-[10px] bg-brand-action px-5 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : logoUploading ? "Uploading logo…" : mode === "create" ? "Create Shop" : "Save Changes"}
        </button>

        {mode === "edit" && currentSlug && (
          <Link href={`/shop/${currentSlug}`} className="text-sm font-medium text-brand-link hover:underline">
            View your shop
          </Link>
        )}
      </div>
    </form>
  );
}
