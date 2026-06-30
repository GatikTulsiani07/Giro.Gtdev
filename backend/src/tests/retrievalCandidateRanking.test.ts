import { describe, expect, it } from "vitest";

import { rankRetrievalCandidates } from "../services/retrieval/candidateRanking.js";

describe("retrieval candidate ranking", () => {
  it("ranks by score then content length", () => {
    const ranked = rankRetrievalCandidates([
      {
        filePath: "b.ts",
        content: "1234",
        score: 0.8,
      },
      {
        filePath: "a.ts",
        content: "123456789",
        score: 0.8,
      },
      {
        filePath: "c.ts",
        content: "1",
        score: 0.9,
      },
    ]);

    expect(ranked[0]?.filePath).toBe("c.ts");
    expect(ranked[1]?.filePath).toBe("a.ts");
    expect(ranked[2]?.filePath).toBe("b.ts");
  });
});