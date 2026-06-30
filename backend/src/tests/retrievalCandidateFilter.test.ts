import { describe, expect, it } from "vitest";

import { filterRetrievalCandidates } from "../services/retrieval/candidateFilter.js";

describe("retrieval candidate filter", () => {
  it("filters, sorts, and limits candidates", () => {
    const result = filterRetrievalCandidates(
      [
        { filePath: "b.ts", content: "B", score: 0.9 },
        { filePath: "a.ts", content: "A", score: 0.9 },
        { filePath: "c.ts", content: "C", score: 0.4 },
      ],
      {
        minScore: 0.5,
        maxCandidates: 1,
      },
    );

    expect(result).toEqual([
      { filePath: "a.ts", content: "A", score: 0.9 },
    ]);
  });
});