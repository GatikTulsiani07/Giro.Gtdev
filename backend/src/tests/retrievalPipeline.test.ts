import { describe, expect, it } from "vitest";

import { buildRetrievalPipeline } from "../services/retrieval/retrievalPipeline.js";

describe("retrieval pipeline", () => {
  it("builds retrieval context", () => {
    const context =
      buildRetrievalPipeline(
        [
          {
            filePath: "a.ts",
            content: "AAAAA",
            score: 0.9,
          },
          {
            filePath: "a.ts",
            content: "AAAAA",
            score: 0.8,
          },
          {
            filePath: "b.ts",
            content: "BBBBB",
            score: 0.7,
          },
        ],
        {
          minScore: 0.5,
          maxCandidates: 5,
          maxCharacters: 100,
        },
      );

    expect(context.chunkCount).toBe(2);
    expect(context.files).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });
});