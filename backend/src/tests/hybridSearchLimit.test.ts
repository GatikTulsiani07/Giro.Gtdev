import { describe, expect, it } from "vitest";

import {
  resolveHybridFetchLimit,
  resolveHybridSearchLimit,
} from "../services/retrieval/hybridSearch.js";

describe("hybrid search limits", () => {
  it("uses default search limit", () => {
    expect(resolveHybridSearchLimit()).toBe(10);
  });

  it("clamps search limit", () => {
    expect(resolveHybridSearchLimit(0)).toBe(1);
    expect(resolveHybridSearchLimit(100)).toBe(50);
  });

  it("derives fetch limit from effective limit", () => {
    expect(resolveHybridFetchLimit(5)).toBe(15);
    expect(resolveHybridFetchLimit(100)).toBe(150);
  });
});