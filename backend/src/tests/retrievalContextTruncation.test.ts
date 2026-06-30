import { describe, expect, it } from "vitest";

import { truncateRetrievalContext } from "../services/retrieval/contextTruncation.js";

describe("retrieval context truncation", () => {
  it("truncates context to max characters", () => {
    expect(truncateRetrievalContext("abcdefghij", 5)).toBe("abcde");
  });

  it("returns original context when under budget", () => {
    expect(truncateRetrievalContext("abc", 5)).toBe("abc");
  });

  it("returns empty string for zero budget", () => {
    expect(truncateRetrievalContext("abc", 0)).toBe("");
  });
});