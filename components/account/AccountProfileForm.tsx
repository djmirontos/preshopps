"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { AvatarPicker } from "@/components/account/AvatarPicker";
import { ShopLocationFields, type ShopLocationValue } from "@/components/seller/ShopLocationFields";
import { deleteUploadedImage } from "@/lib/image-processing/upload-image";
import { updateMyProfile, UPDATE_MY_PROFILE_ERROR_MESSAGES } from "@/lib/account/update-my-profile";
import { isPlausibleMobileNumber } from "@/lib/account/validate-mobile-number";
import type { MyProfile } from "@/lib/account/get-my-profile";
import type { LocationRef } from "@/lib/marketplace/reference-data";

const NAME_MAX_LENGTH = 50;
const BIO_MAX_LENGTH = 300;

type Props = {
  userId: string;
  email: string;
  initialProfile: MyProfile;
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
};

type FieldErrors = {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  mobile?: string;
};

/** Small, consistent privacy indicator -- deliberately one plain style
 * for both states (no color-coding) so a form with several of these
 * doesn't turn into a noisy badge wall, per this task's own "don't
 * overdo it" instruction. */
function PrivacyTag({ level }: { level: "public" | "private" }) {
  return (
    <span className="ml-1.5 rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
      {level === "public" ? "Public" : "Private"}
    </span>
  );
}

/** The last CONFIRMED/saved state of every field update_my_profile writes
 * other than the avatar (which has its own confirmed `avatarPath` state,
 * tracked separately below since it can change independently of these).
 * Deliberately a plain, already-normalized snapshot -- never re-validated
 * before use, since it only ever gets here by having already passed
 * validation on a prior successful save (or by being the server's own
 * initial load, which is authoritative by construction). */
type ConfirmedProfileFields = {
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  mobileNumber: string | null;
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
};

/**
 * The one stateful piece of the redesigned /account page -- Profile,
 * Location, and Contact sections plus a single "Save Changes" action.
 * Marketplace links and the Sign out / Request account deletion section
 * stay in app/account/page.tsx itself (plain server-rendered links/
 * forms, no new client state needed for those).
 *
 * Two separate pieces of state exist for every text/location field:
 * the editable DRAFT (displayName/firstName/.../location, what the
 * inputs are bound to) and the CONFIRMED snapshot (`confirmed`, the
 * last values actually persisted). "Save Changes" is the only action
 * that reads the draft and, on success, promotes it to `confirmed`.
 * Avatar changes never read the draft at all -- because
 * update_my_profile always needs a complete set of fields (it isn't a
 * partial-patch endpoint), an avatar-only change persists the new/null
 * avatar path together with the CONFIRMED values for everything else,
 * so it can never silently save an unrelated unsaved edit sitting in
 * the draft, and an invalid draft value can never block it either.
 */
export function AccountProfileForm({ userId, email, initialProfile, provinces, initialCities, initialBarangays, loadCities, loadBarangays }: Props) {
  const displayNameId = useId();
  const firstNameId = useId();
  const lastNameId = useId();
  const bioId = useId();
  const mobileId = useId();
  const provinceErrorId = useId();
  const cityErrorId = useId();

  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [firstName, setFirstName] = useState(initialProfile.firstName ?? "");
  const [lastName, setLastName] = useState(initialProfile.lastName ?? "");
  const [bio, setBio] = useState(initialProfile.bio ?? "");
  const [mobileNumber, setMobileNumber] = useState(initialProfile.mobileNumber ?? "");
  const [location, setLocation] = useState<ShopLocationValue>({
    provinceId: initialProfile.provinceId,
    cityId: initialProfile.cityId,
    barangayId: initialProfile.barangayId,
  });

  // The last-saved snapshot every avatar-only action reads from -- only
  // ever updated by a successful explicit "Save Changes" (see
  // handleSaveChangesClick), never by an avatar action itself.
  const [confirmed, setConfirmed] = useState<ConfirmedProfileFields>({
    displayName: initialProfile.displayName,
    firstName: initialProfile.firstName,
    lastName: initialProfile.lastName,
    bio: initialProfile.bio,
    mobileNumber: initialProfile.mobileNumber,
    provinceId: initialProfile.provinceId,
    cityId: initialProfile.cityId,
    barangayId: initialProfile.barangayId,
  });

  const [avatarPath, setAvatarPath] = useState<string | null>(initialProfile.avatarStoragePath);
  // Never updated after mount: AvatarPicker only reads `initialUrl` once
  // (on mount / on a failure-triggered remount, both of which correctly
  // want the last CONFIRMED avatar, i.e. this original value) -- see
  // performAvatarSave's own comment for why a successful save doesn't
  // need to recompute a new one.
  const [avatarUrl] = useState<string | undefined>(initialProfile.avatarUrl);
  const [avatarResetKey, setAvatarResetKey] = useState(0);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const bioTooLong = bio.length > BIO_MAX_LENGTH;

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const trimmedDisplayName = displayName.trim();

    if (trimmedDisplayName.length === 0) {
      errors.displayName = "Enter a display name.";
    } else if (trimmedDisplayName.length > NAME_MAX_LENGTH) {
      errors.displayName = "Display name must be 50 characters or fewer.";
    }

    if (firstName.trim().length > NAME_MAX_LENGTH) {
      errors.firstName = "First name must be 50 characters or fewer.";
    }
    if (lastName.trim().length > NAME_MAX_LENGTH) {
      errors.lastName = "Last name must be 50 characters or fewer.";
    }
    if (bio.trim().length > BIO_MAX_LENGTH) {
      errors.bio = "Bio must be 300 characters or fewer.";
    }

    const trimmedMobile = mobileNumber.trim();
    if (trimmedMobile.length > 0 && !isPlausibleMobileNumber(trimmedMobile)) {
      errors.mobile = "Enter a valid mobile number.";
    }

    return errors;
  }

  /**
   * The ONLY write path avatar actions ever use. Deliberately reads
   * `confirmed`, never the draft state -- an unsaved, possibly-invalid
   * edit sitting in displayName/firstName/.../location must never block
   * this call and must never be persisted by it. No client-side
   * validation runs here at all: `confirmed` was already valid the
   * moment it was set (either the server's own initial load, or a prior
   * successful "Save Changes"), so re-validating it would be redundant.
   * On failure, the just-uploaded object is the caller's (AvatarPicker's)
   * responsibility to clean up -- this function only reports success/
   * failure and bumps the reset key so the picker reverts its own
   * display back to the still-unchanged confirmed avatar.
   */
  async function performAvatarSave(avatarOverride: string | null): Promise<boolean> {
    setIsSaving(true);
    setSubmitError(null);

    const result = await updateMyProfile({
      displayName: confirmed.displayName,
      avatarStoragePath: avatarOverride,
      firstName: confirmed.firstName,
      lastName: confirmed.lastName,
      bio: confirmed.bio,
      mobileNumber: confirmed.mobileNumber,
      provinceId: confirmed.provinceId,
      cityId: confirmed.cityId,
      barangayId: confirmed.barangayId,
    });

    setIsSaving(false);

    if (!result.ok) {
      setSubmitError(UPDATE_MY_PROFILE_ERROR_MESSAGES[result.code]);
      setAvatarResetKey((key) => key + 1);
      return false;
    }

    setSubmitError(null);

    const previousPath = avatarPath;
    setAvatarPath(avatarOverride);

    if (previousPath && previousPath !== avatarOverride) {
      void deleteUploadedImage(previousPath).catch((err) => {
        console.error("Avatar cleanup failed:", err instanceof Error ? err.message : err);
      });
    }

    return true;
  }

  /**
   * The ONLY write path for display_name/first_name/last_name/bio/
   * mobile_number/location -- reads the current draft, validates it,
   * and on success promotes it to `confirmed` (so the next avatar-only
   * action persists these newly-saved values instead of the old ones).
   * Never touches avatarPath.
   */
  async function handleSaveChangesClick() {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSaving(true);
    setSubmitError(null);

    const nextConfirmed: ConfirmedProfileFields = {
      displayName: displayName.trim(),
      firstName: firstName.trim() || null,
      lastName: lastName.trim() || null,
      bio: bio.trim() || null,
      mobileNumber: mobileNumber.trim() || null,
      provinceId: location.provinceId,
      cityId: location.cityId,
      barangayId: location.barangayId,
    };

    const result = await updateMyProfile({ ...nextConfirmed, avatarStoragePath: avatarPath });

    setIsSaving(false);

    if (!result.ok) {
      setSubmitError(UPDATE_MY_PROFILE_ERROR_MESSAGES[result.code]);
      return;
    }

    setSubmitError(null);
    setSavedAt(Date.now());
    setConfirmed(nextConfirmed);
  }

  /** Clears the transient "Saved" indicator the moment any field is
   * edited again, so it never lingers as a false claim about the
   * current (now-unsaved) form state. */
  function markDirty() {
    if (savedAt !== null) setSavedAt(null);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[14px] border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">Profile</h2>
        <p className="mt-1 text-xs text-ink-secondary">Your photo, display name, and bio are visible to other Preshopps users. Your real name stays private.</p>

        <div className="mt-4 space-y-4">
          <div>
            <p className="flex items-center text-sm font-medium text-ink">
              Photo <PrivacyTag level="public" />
            </p>
            <div className="mt-2">
              <AvatarPicker
                key={avatarResetKey}
                ownerId={userId}
                initialPath={avatarPath}
                initialUrl={avatarUrl}
                disabled={isSaving}
                onUploaded={(path) => performAvatarSave(path)}
                onRemoved={() => performAvatarSave(null)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={displayNameId} className="flex items-center text-sm font-medium text-ink">
                Display name <PrivacyTag level="public" />
              </label>
              <input
                id={displayNameId}
                type="text"
                value={displayName}
                onChange={(event) => { setDisplayName(event.target.value); markDirty(); }}
                maxLength={NAME_MAX_LENGTH + 20}
                aria-invalid={Boolean(fieldErrors.displayName)}
                className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <p className={`mt-1 text-xs ${fieldErrors.displayName ? "text-danger" : "text-ink-muted"}`}>
                {fieldErrors.displayName ?? `${displayName.length}/${NAME_MAX_LENGTH}`}
              </p>
            </div>

            <div>
              <label htmlFor={firstNameId} className="flex items-center text-sm font-medium text-ink">
                First name <PrivacyTag level="private" />
              </label>
              <input
                id={firstNameId}
                type="text"
                value={firstName}
                onChange={(event) => { setFirstName(event.target.value); markDirty(); }}
                maxLength={NAME_MAX_LENGTH + 20}
                aria-invalid={Boolean(fieldErrors.firstName)}
                className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                placeholder="Optional"
              />
              {fieldErrors.firstName && <p className="mt-1 text-xs text-danger">{fieldErrors.firstName}</p>}
            </div>

            <div>
              <label htmlFor={lastNameId} className="flex items-center text-sm font-medium text-ink">
                Last name <PrivacyTag level="private" />
              </label>
              <input
                id={lastNameId}
                type="text"
                value={lastName}
                onChange={(event) => { setLastName(event.target.value); markDirty(); }}
                maxLength={NAME_MAX_LENGTH + 20}
                aria-invalid={Boolean(fieldErrors.lastName)}
                className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                placeholder="Optional"
              />
              {fieldErrors.lastName && <p className="mt-1 text-xs text-danger">{fieldErrors.lastName}</p>}
            </div>
          </div>

          <div>
            <label htmlFor={bioId} className="flex items-center text-sm font-medium text-ink">
              Bio <PrivacyTag level="public" />
            </label>
            <textarea
              id={bioId}
              value={bio}
              onChange={(event) => { setBio(event.target.value); markDirty(); }}
              rows={3}
              maxLength={BIO_MAX_LENGTH + 100}
              aria-invalid={bioTooLong}
              className="mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              placeholder="Tell other Preshopps users a little about yourself. Optional."
            />
            <p className={`mt-1 text-xs ${bioTooLong || fieldErrors.bio ? "text-danger" : "text-ink-muted"}`}>
              {fieldErrors.bio ?? `${bio.length}/${BIO_MAX_LENGTH}`}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[14px] border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">Location</h2>
        <p className="mt-1 text-xs text-ink-secondary">Private. Never shown on your profile or anywhere else.</p>

        <div className="mt-4">
          <ShopLocationFields
            provinces={provinces}
            initialCities={initialCities}
            initialBarangays={initialBarangays}
            initialValue={location}
            loadCities={loadCities}
            loadBarangays={loadBarangays}
            onChange={(next) => { setLocation(next); markDirty(); }}
            provinceErrorId={provinceErrorId}
            cityErrorId={cityErrorId}
          />
        </div>
      </section>

      <section className="rounded-[14px] border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">Contact</h2>

        <div className="mt-4 space-y-4">
          <div>
            <p className="flex items-center text-sm font-medium text-ink">
              Email <PrivacyTag level="private" />
            </p>
            <p className="mt-1.5 h-11 flex items-center rounded-[10px] border border-border bg-canvas px-3 text-sm text-ink-secondary">{email}</p>
            <p className="mt-1 text-xs text-ink-muted">
              From your sign-in. Never shown publicly. Need to change your email?{" "}
              <Link href="/support" className="font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                Contact Support
              </Link>
              .
            </p>
          </div>

          <div>
            <label htmlFor={mobileId} className="flex items-center text-sm font-medium text-ink">
              Mobile number <PrivacyTag level="private" />
            </label>
            <input
              id={mobileId}
              type="tel"
              value={mobileNumber}
              onChange={(event) => { setMobileNumber(event.target.value); markDirty(); }}
              aria-invalid={Boolean(fieldErrors.mobile)}
              className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              placeholder="09XXXXXXXXX"
            />
            <p className={`mt-1 text-xs ${fieldErrors.mobile ? "text-danger" : "text-ink-muted"}`}>
              {fieldErrors.mobile ?? "Optional. Never shown publicly."}
            </p>
          </div>
        </div>
      </section>

      {submitError && <p className="text-sm text-danger">{submitError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveChangesClick}
          disabled={isSaving}
          className="h-11 rounded-[10px] bg-brand-action px-5 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save Changes"}
        </button>
        {savedAt !== null && !isSaving && !submitError && <span className="text-sm text-ink-secondary">Saved</span>}
      </div>
    </div>
  );
}
