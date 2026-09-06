import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SearchEmptyState } from "@/components/search/SearchEmptyState";

describe("SearchEmptyState", () => {
  it("shows the true-empty-marketplace copy when there is no query and no active filters", () => {
    render(<SearchEmptyState query={null} hasActiveFilters={false} clearFiltersHref="/search" />);
    expect(screen.getByText("No listings yet.")).toBeInTheDocument();
    expect(
      screen.getByText("New items will appear here as sellers start listing."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No listings match your filters.")).not.toBeInTheDocument();
    // Nothing to clear and nothing to browse away from.
    expect(screen.queryByRole("link", { name: /clear filters/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /browse all listings/i })).not.toBeInTheDocument();
  });

  it("shows the filters-specific copy when a real filter is active", () => {
    render(
      <SearchEmptyState query={null} hasActiveFilters clearFiltersHref="/search?category=cars" />,
    );
    expect(screen.getByText("No listings match your filters.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clear filters/i })).toHaveAttribute(
      "href",
      "/search?category=cars",
    );
    expect(screen.getByRole("link", { name: /browse all listings/i })).toBeInTheDocument();
  });

  it("names the query in the heading when a query is the only thing active", () => {
    render(
      <SearchEmptyState query="galaxy fold" hasActiveFilters={false} clearFiltersHref="/search?q=galaxy+fold" />,
    );
    expect(screen.getByText("No results for “galaxy fold”.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /clear filters/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse all listings/i })).toBeInTheDocument();
  });

  it("combines both: filters-empty heading with the query named as a supporting line", () => {
    render(
      <SearchEmptyState
        query="galaxy fold"
        hasActiveFilters
        clearFiltersHref="/search?q=galaxy+fold&category=electronics"
      />,
    );
    expect(screen.getByText("No listings match your filters.")).toBeInTheDocument();
    expect(screen.getByText("No results for “galaxy fold”.")).toBeInTheDocument();
  });
});
