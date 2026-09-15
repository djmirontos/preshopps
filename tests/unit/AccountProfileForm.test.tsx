import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MyProfile } from "@/lib/account/get-my-profile";

const { updateMyProfileMock, uploadImageMock, deleteUploadedImageMock } = vi.hoisted(() => ({
  updateMyProfileMock: vi.fn(),
  uploadImageMock: vi.fn(),
  deleteUploadedImageMock: vi.fn(),
}));

vi.mock("@/lib/account/update-my-profile", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account/update-my-profile")>("@/lib/account/update-my-profile");
  return { ...actual, updateMyProfile: updateMyProfileMock };
});

vi.mock("@/lib/image-processing/upload-image", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-processing/upload-image")>("@/lib/image-processing/upload-image");
  return { ...actual, uploadImage: uploadImageMock, deleteUploadedImage: deleteUploadedImageMock };
});

import { AccountProfileForm } from "@/components/account/AccountProfileForm";

function makeProfile(overrides: Partial<MyProfile> = {}): MyProfile {
  return {
    id: "user-1",
    displayName: "Anne",
    avatarStoragePath: null,
    avatarUrl: undefined,
    firstName: null,
    lastName: null,
    bio: null,
    mobileNumber: null,
    provinceId: null,
    cityId: null,
    barangayId: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const PROVINCES = [{ id: 1, name: "Misamis Occidental" }];

function renderForm(overrides: Partial<Parameters<typeof AccountProfileForm>[0]> = {}) {
  return render(
    <AccountProfileForm
      userId="user-1"
      email="buyer@example.com"
      initialProfile={makeProfile()}
      provinces={PROVINCES}
      initialCities={[]}
      initialBarangays={[]}
      loadCities={vi.fn().mockResolvedValue([])}
      loadBarangays={vi.fn().mockResolvedValue([])}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMyProfileMock.mockResolvedValue({ ok: true, updatedAt: "2026-01-02T00:00:00.000Z" });
  deleteUploadedImageMock.mockResolvedValue(true);
  if (!("createObjectURL" in URL)) {
    // @ts-expect-error -- test-environment polyfill
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  }
});

describe("AccountProfileForm -- current email is shown read-only and privately", () => {
  it("renders the authenticated user's email as plain text, not an editable input", () => {
    renderForm({ email: "buyer@example.com" });
    expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /email/i })).not.toBeInTheDocument();
  });

  it("labels email as Private", () => {
    renderForm();
    const emailLabel = screen.getByText("Email").closest("p")!;
    expect(emailLabel).toHaveTextContent("Private");
  });
});

describe("AccountProfileForm -- display name", () => {
  it("renders the current display name and lets it be edited", () => {
    renderForm({ initialProfile: makeProfile({ displayName: "Anne" }) });
    const input = screen.getByLabelText(/display name/i);
    expect(input).toHaveValue("Anne");
    fireEvent.change(input, { target: { value: "Anne's Closet" } });
    expect(input).toHaveValue("Anne's Closet");
  });

  it("is labeled Public", () => {
    renderForm();
    const label = screen.getByText("Display name").closest("label")!;
    expect(label).toHaveTextContent("Public");
  });

  it("rejects a blank display name on save with a safe message", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Enter a display name.")).toBeInTheDocument();
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a display name over 50 characters", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "x".repeat(51) } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Display name must be 50 characters or fewer.")).toBeInTheDocument();
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });
});

describe("AccountProfileForm -- first/last name", () => {
  it("are optional and labeled Private", () => {
    renderForm();
    expect(screen.getByText("First name").closest("label")).toHaveTextContent("Private");
    expect(screen.getByText("Last name").closest("label")).toHaveTextContent("Private");
  });

  it("first name over 50 characters is rejected", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "x".repeat(51) } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("First name must be 50 characters or fewer.")).toBeInTheDocument();
  });

  it("last name over 50 characters is rejected", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "x".repeat(51) } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Last name must be 50 characters or fewer.")).toBeInTheDocument();
  });

  it("blank first/last name save as null, not empty strings", async () => {
    renderForm({ initialProfile: makeProfile({ firstName: "Anne", lastName: "Cruz" }) });
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    const call = updateMyProfileMock.mock.calls[0][0];
    expect(call.firstName).toBeNull();
    expect(call.lastName).toBeNull();
  });
});

describe("AccountProfileForm -- bio", () => {
  it("is optional, labeled Public, and shows a live character count", () => {
    renderForm();
    expect(screen.getByText("Bio").closest("label")).toHaveTextContent("Public");
    expect(screen.getByText("0/300")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/bio/i), { target: { value: "Hello there" } });
    expect(screen.getByText("11/300")).toBeInTheDocument();
  });

  it("rejects a bio over 300 characters", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/bio/i), { target: { value: "x".repeat(301) } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Bio must be 300 characters or fewer.")).toBeInTheDocument();
  });
});

describe("AccountProfileForm -- location stays private", () => {
  it("renders province/city/barangay fields with no public-facing indicator", () => {
    renderForm();
    expect(screen.getByText("Province")).toBeInTheDocument();
    expect(screen.getByText("City / Municipality")).toBeInTheDocument();
    expect(screen.getByText(/never shown on your profile/i)).toBeInTheDocument();
  });

  it("changing province resets city/barangay (delegated to the existing ShopLocationFields cascading behavior)", async () => {
    const loadCities = vi.fn().mockResolvedValue([{ id: 10, name: "Tangub City" }]);
    renderForm({ provinces: PROVINCES, loadCities });

    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "1" } });

    await waitFor(() => expect(loadCities).toHaveBeenCalledWith(1));
  });

  it("saves the selected province/city/barangay via update_my_profile", async () => {
    const loadCities = vi.fn().mockResolvedValue([{ id: 10, name: "Tangub City" }]);
    renderForm({ provinces: PROVINCES, loadCities });

    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByLabelText("City / Municipality")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("City / Municipality"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    const call = updateMyProfileMock.mock.calls[0][0];
    expect(call.provinceId).toBe(1);
    expect(call.cityId).toBe(10);
  });
});

describe("AccountProfileForm -- mobile number", () => {
  it("is optional and labeled Private", () => {
    renderForm();
    expect(screen.getByText("Mobile number").closest("label")).toHaveTextContent("Private");
  });

  it("accepts a PH local-format number", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "09171234567" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(screen.queryByText(/enter a valid mobile number/i)).not.toBeInTheDocument();
  });

  it("accepts an E.164-shaped number", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "+639171234567" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(screen.queryByText(/enter a valid mobile number/i)).not.toBeInTheDocument();
  });

  it("rejects an obviously malformed number before ever calling the RPC", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Enter a valid mobile number.")).toBeInTheDocument();
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });
});

describe("AccountProfileForm -- avatar save flow", () => {
  function selectAvatarFile() {
    const file = new File(["fake-bytes"], "avatar.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/upload profile photo/i), { target: { files: [file] } });
  }

  it("uses the authenticated user's own id for the avatar path", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm({ userId: "user-1" });

    selectAvatarFile();

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledWith("avatar-images", "user-1", "avatar", expect.any(File), expect.any(Function)));
  });

  it("calls update_my_profile with the new avatar path immediately after upload succeeds", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm();

    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(updateMyProfileMock.mock.calls[0][0].avatarStoragePath).toBe("avatar-images/user-1/avatar/a.jpg");
  });

  it("best-effort deletes the previous avatar object only after the profile save succeeds", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/new.jpg" });
    renderForm({ initialProfile: makeProfile({ avatarStoragePath: "avatar-images/user-1/avatar/old.jpg", avatarUrl: "https://x/old.jpg" }) });

    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("avatar-images/user-1/avatar/old.jpg"));
  });

  it("removing the avatar saves avatarStoragePath: null, then cleans up the old object", async () => {
    renderForm({ initialProfile: makeProfile({ avatarStoragePath: "avatar-images/user-1/avatar/old.jpg", avatarUrl: "https://x/old.jpg" }) });

    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(updateMyProfileMock.mock.calls[0][0].avatarStoragePath).toBeNull();
    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("avatar-images/user-1/avatar/old.jpg"));
  });

  it("a failed avatar save does not delete the previous object and shows the shared save-error banner", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/new.jpg" });
    updateMyProfileMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    renderForm({ initialProfile: makeProfile({ avatarStoragePath: "avatar-images/user-1/avatar/old.jpg", avatarUrl: "https://x/old.jpg" }) });

    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(await screen.findByText("We couldn't save your changes. Please try again.")).toBeInTheDocument();
    expect(deleteUploadedImageMock).not.toHaveBeenCalledWith("avatar-images/user-1/avatar/old.jpg");
  });

  it("rejects an unsupported avatar file type with a safe message, never calling update_my_profile", async () => {
    uploadImageMock.mockResolvedValue({ ok: false, code: "UNSUPPORTED_FILE_TYPE" });
    renderForm();

    selectAvatarFile();

    expect(await screen.findByText(/jpg, png, or webp/i)).toBeInTheDocument();
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });
});

describe("AccountProfileForm -- avatar actions persist the CONFIRMED snapshot, never the unsaved draft", () => {
  function selectAvatarFile() {
    const file = new File(["fake-bytes"], "avatar.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/upload profile photo/i), { target: { files: [file] } });
  }

  it("an unsaved display-name edit is NOT sent when the avatar changes", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm({ initialProfile: makeProfile({ displayName: "Anne" }) });

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "Unsaved Name" } });
    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(updateMyProfileMock.mock.calls[0][0].displayName).toBe("Anne");
  });

  it("unsaved first/last name edits are NOT sent when the avatar changes", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm({ initialProfile: makeProfile({ firstName: "Anne", lastName: "Cruz" }) });

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Unsaved First" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Unsaved Last" } });
    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(updateMyProfileMock.mock.calls[0][0].firstName).toBe("Anne");
    expect(updateMyProfileMock.mock.calls[0][0].lastName).toBe("Cruz");
  });

  it("an unsaved bio edit is NOT sent when the avatar changes", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm({ initialProfile: makeProfile({ bio: "Original bio" }) });

    fireEvent.change(screen.getByLabelText(/bio/i), { target: { value: "Unsaved bio" } });
    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(updateMyProfileMock.mock.calls[0][0].bio).toBe("Original bio");
  });

  it("an unsaved mobile-number edit is NOT sent when the avatar changes", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm({ initialProfile: makeProfile({ mobileNumber: "+639171111111" }) });

    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "09179999999" } });
    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(updateMyProfileMock.mock.calls[0][0].mobileNumber).toBe("+639171111111");
  });

  it("an unsaved location edit is NOT sent when the avatar changes", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    const loadCities = vi.fn().mockResolvedValue([{ id: 10, name: "Tangub City" }]);
    renderForm({ initialProfile: makeProfile({ provinceId: null, cityId: null, barangayId: null }), provinces: PROVINCES, loadCities });

    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "1" } });
    await waitFor(() => expect(loadCities).toHaveBeenCalled());
    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(updateMyProfileMock.mock.calls[0][0].provinceId).toBeNull();
  });

  it("invalid unsaved form state (e.g. a too-long display name) does NOT block avatar replacement", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm();

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "x".repeat(51) } });
    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(screen.queryByText("Display name must be 50 characters or fewer.")).not.toBeInTheDocument();
  });

  it("invalid unsaved form state does NOT block avatar removal", async () => {
    renderForm({ initialProfile: makeProfile({ avatarStoragePath: "avatar-images/user-1/avatar/old.jpg", avatarUrl: "https://x/old.jpg" }) });

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(updateMyProfileMock.mock.calls[0][0].avatarStoragePath).toBeNull();
    expect(screen.queryByText("Enter a display name.")).not.toBeInTheDocument();
  });

  it("draft edits remain visible in their inputs after a successful avatar change", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm({ initialProfile: makeProfile({ displayName: "Anne" }) });

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "Still Unsaved" } });
    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Still Unsaved");
  });

  it("a normal Save Changes click persists the draft values and updates the confirmed snapshot for later avatar actions", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderForm({ initialProfile: makeProfile({ displayName: "Anne" }) });

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "Anne's Closet" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalledTimes(1));
    expect(updateMyProfileMock.mock.calls[0][0].displayName).toBe("Anne's Closet");

    // A subsequent avatar-only action now persists the newly-confirmed
    // display name, proving Save Changes actually promoted the draft.
    selectAvatarFile();
    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalledTimes(2));
    expect(updateMyProfileMock.mock.calls[1][0].displayName).toBe("Anne's Closet");
  });

  it("a failed avatar save preserves both the old confirmed avatar and every draft edit", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/new.jpg" });
    updateMyProfileMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    renderForm({
      initialProfile: makeProfile({
        displayName: "Anne",
        avatarStoragePath: "avatar-images/user-1/avatar/old.jpg",
        avatarUrl: "https://x/old.jpg",
      }),
    });

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "Unsaved Name" } });
    selectAvatarFile();

    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalled());
    expect(await screen.findByText("We couldn't save your changes. Please try again.")).toBeInTheDocument();
    // Draft edit is untouched...
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Unsaved Name");
    // ...and the old confirmed avatar was never deleted.
    expect(deleteUploadedImageMock).not.toHaveBeenCalledWith("avatar-images/user-1/avatar/old.jpg");
  });
});

describe("AccountProfileForm -- Save Changes button", () => {
  it("shows a saving state and disables itself while a save is in flight", async () => {
    let resolveSave: (value: { ok: true; updatedAt: string }) => void = () => {};
    updateMyProfileMock.mockImplementation(() => new Promise((resolve) => (resolveSave = resolve)));
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled());

    resolveSave({ ok: true, updatedAt: "2026-01-02T00:00:00.000Z" });
    await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled());
  });

  it("prevents a double-submit -- rapid double click only calls the RPC the number of times clicks actually register while not disabled", async () => {
    let resolveSave: (value: { ok: true; updatedAt: string }) => void = () => {};
    updateMyProfileMock.mockImplementation(() => new Promise((resolve) => (resolveSave = resolve)));
    renderForm();

    const button = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button); // no-op: disabled

    resolveSave({ ok: true, updatedAt: "2026-01-02T00:00:00.000Z" });
    await waitFor(() => expect(updateMyProfileMock).toHaveBeenCalledTimes(1));
  });

  it("shows a generic save-failure message, never a raw backend error", async () => {
    updateMyProfileMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("We couldn't save your changes. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/postgres|rpc|sql/i)).not.toBeInTheDocument();
  });

  it("preserves entered values after a recoverable save error", async () => {
    updateMyProfileMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    renderForm();

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "Anne's Closet" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await screen.findByText("We couldn't save your changes. Please try again.");
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Anne's Closet");
  });
});

describe("AccountProfileForm -- suspension: public-field restriction", () => {
  it("shows the exact friendly copy when update_my_profile returns PUBLIC_PROFILE_LOCKED", async () => {
    updateMyProfileMock.mockResolvedValue({ ok: false, code: "PUBLIC_PROFILE_LOCKED" });
    renderForm();

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Your public profile details can't be changed while your account is under review.")).toBeInTheDocument();
  });

  it("does not clear the private fields the user had already typed when locked out of public fields", async () => {
    updateMyProfileMock.mockResolvedValue({ ok: false, code: "PUBLIC_PROFILE_LOCKED" });
    renderForm();

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Anne" } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await screen.findByText("Your public profile details can't be changed while your account is under review.");
    expect(screen.getByLabelText(/first name/i)).toHaveValue("Anne");
  });
});

describe("AccountProfileForm -- never surfaces raw backend detail", () => {
  it("maps every known error code to safe copy, never the raw RPC error message", async () => {
    updateMyProfileMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Your account isn't available right now.")).toBeInTheDocument();
  });
});
