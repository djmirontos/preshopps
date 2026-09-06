import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FavoritesProvider, useFavorites } from "@/components/favorites/FavoritesProvider";

function Probe({ id }: { id: string }) {
  const { isFavorited } = useFavorites();
  return <span>{String(isFavorited(id))}</span>;
}

function Toggle({ id }: { id: string }) {
  const { isFavorited, addFavoriteId, removeFavoriteId } = useFavorites();
  return (
    <div>
      <span>{String(isFavorited(id))}</span>
      <button onClick={() => addFavoriteId(id)}>add</button>
      <button onClick={() => removeFavoriteId(id)}>remove</button>
    </div>
  );
}

describe("FavoritesProvider", () => {
  it("exposes the given favorited ids via isFavorited to consumers", () => {
    render(
      <FavoritesProvider favoritedIds={["listing-1", "listing-2"]}>
        <Probe id="listing-1" />
      </FavoritesProvider>,
    );
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("correctly reports an id that was not favorited", () => {
    render(
      <FavoritesProvider favoritedIds={["listing-1"]}>
        <Probe id="listing-99" />
      </FavoritesProvider>,
    );
    expect(screen.getByText("false")).toBeInTheDocument();
  });

  it("defaults to isFavorited() === false (nothing favorited) when rendered with no provider", () => {
    render(<Probe id="listing-1" />);
    expect(screen.getByText("false")).toBeInTheDocument();
  });

  it("lets many consumers under one provider share the same resolved state (no per-consumer fetch)", () => {
    render(
      <FavoritesProvider favoritedIds={["listing-1", "listing-2", "listing-3"]}>
        <Probe id="listing-1" />
        <Probe id="listing-2" />
        <Probe id="listing-99" />
      </FavoritesProvider>,
    );
    const results = screen.getAllByText(/true|false/).map((el) => el.textContent);
    expect(results).toEqual(["true", "true", "false"]);
  });

  it("updates the shared Set (and every consumer) after addFavoriteId", () => {
    render(
      <FavoritesProvider favoritedIds={[]}>
        <Toggle id="listing-1" />
      </FavoritesProvider>,
    );
    expect(screen.getByText("false")).toBeInTheDocument();
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("updates the shared Set (and every consumer) after removeFavoriteId", () => {
    render(
      <FavoritesProvider favoritedIds={["listing-1"]}>
        <Toggle id="listing-1" />
      </FavoritesProvider>,
    );
    expect(screen.getByText("true")).toBeInTheDocument();
    fireEvent.click(screen.getByText("remove"));
    expect(screen.getByText("false")).toBeInTheDocument();
  });

  it("keeps two independent consumers of the same listing id synchronized after a mutation", () => {
    render(
      <FavoritesProvider favoritedIds={[]}>
        <Toggle id="listing-1" />
        <Probe id="listing-1" />
      </FavoritesProvider>,
    );
    const [toggleStatus, probeStatus] = screen.getAllByText(/true|false/);
    expect(toggleStatus.textContent).toBe("false");
    expect(probeStatus.textContent).toBe("false");

    fireEvent.click(screen.getByText("add"));

    const updated = screen.getAllByText(/true|false/);
    expect(updated[0].textContent).toBe("true");
    expect(updated[1].textContent).toBe("true");
  });
});
