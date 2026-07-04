import { describe, expect, it } from "vitest";

import { buildRetrievalScoreBreakdown } from "../services/retrieval/retrievalScoreBreakdown.js";

describe("retrieval score breakdown", () => {
  it("calculates total score", () => {
    const breakdown = buildRetrievalScoreBreakdown({
      semantic: 0.5,
      keyword: 0.2,
      symbol: 0.1,
      graph: 0.2,
    });

    expect(breakdown.total).toBeCloseTo(1.0);
    expect(breakdown.semantic).toBe(0.5);
    expect(breakdown.graph).toBe(0.2);
  });
});