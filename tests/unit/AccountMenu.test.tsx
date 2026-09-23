import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { signOutActionMock } = vi.hoisted(() => ({
  signOutActionMock: vi.fn(),
}));

vi.mock("@/lib/auth/actions", () => ({
  signOutAction: signOutActionMock,
}));

import { AccountMenu } from "@/components/auth/AccountMenu";

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
}

describe("AccountMenu -- desktop dropdown direct shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is closed by default -- no menu items rendered until the trigger is clicked", () => {
    render(<AccountMenu email="buyer@example.com" />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows the signed-in email at the top when the menu is open", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
  });

  it("renders no email row when email is null", () => {
    render(<AccountMenu email={null} />);
    openMenu();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("contains My Orders using the existing buyer-orders route", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "My Orders" })).toHaveAttribute("href", "/orders");
  });

  it("contains Customer Orders using the existing seller-orders route", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Customer Orders" })).toHaveAttribute("href", "/seller/orders");
  });

  it("contains My Shop pointing at /seller/shop", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "My Shop" })).toHaveAttribute("href", "/seller/shop");
  });

  it("contains My Listings pointing at /seller/listings", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "My Listings" })).toHaveAttribute("href", "/seller/listings");
  });

  it("contains Favorites pointing at /favorites", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Favorites" })).toHaveAttribute("href", "/favorites");
  });

  it("contains Account pointing at /account", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/account");
  });

  it("contains Sign out as a submit control, not a link", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    const signOut = screen.getByRole("menuitem", { name: "Sign out" });
    expect(signOut.tagName).toBe("BUTTON");
    expect(signOut).toHaveAttribute("type", "submit");
  });

  it("renders the seven items in the exact locked order: My Orders, Customer Orders, My Shop, My Listings, Favorites, Account, Sign out", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items).toEqual(["My Orders", "Customer Orders", "My Shop", "My Listings", "Favorites", "Account", "Sign out"]);
  });

  it("clicking a link item closes the menu", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "My Orders" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger (unchanged behavior)", () => {
    render(<AccountMenu email="buyer@example.com" />);
    const trigger = screen.getByRole("button", { name: "Account" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside click (unchanged behavior)", () => {
    render(
      <div>
        <AccountMenu email="buyer@example.com" />
        <button type="button">Outside</button>
      </div>,
    );
    openMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not close on a click inside the menu panel itself (e.g. clicking Sign out)", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("submits the existing signOutAction form unchanged", () => {
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();
    const form = screen.getByRole("menuitem", { name: "Sign out" }).closest("form");
    expect(form).toHaveAttribute("action");
  });

  it("keeps the existing trigger accessibility attributes (aria-haspopup, aria-expanded)", () => {
    render(<AccountMenu email="buyer@example.com" />);
    const trigger = screen.getByRole("button", { name: "Account" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});

describe("AccountMenu -- Sign out submission (via the shared SignOutForm)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clicking Sign out calls signOutAction", async () => {
    signOutActionMock.mockResolvedValue({ error: null });
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(signOutActionMock).toHaveBeenCalled());
  });

  it("a successful sign-out shows no error -- the confirmation itself is shown later, on the destination page", async () => {
    signOutActionMock.mockResolvedValue({ error: null });
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(signOutActionMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed sign-out shows a useful inline error and never a success -- the Sign out control stays available to retry", async () => {
    signOutActionMock.mockResolvedValue({ error: "We couldn't sign you out. Please try again." });
    render(<AccountMenu email="buyer@example.com" />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't sign you out. Please try again.");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });
});
