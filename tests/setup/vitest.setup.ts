import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.mts does not enable `test.globals`, so @testing-library/react's
// own auto-cleanup (which hooks into a global afterEach) never registers.
// Without this, multiple render() calls across `it` blocks in one file
// accumulate in the DOM instead of resetting between tests.
afterEach(() => {
  cleanup();
});
