import { describe, expect, it } from "vitest";

import { applyRetrievalTokenBudget } from "../services/retrieval/tokenBudgetManager.js";

describe("retrieval token budget manager", () => {
  it("keeps candidates within character budget", () => {
    const result = applyRetrievalTokenBudget(
      [
        { filePath: "a.ts", content: "12345", score: 0.9 },
        { filePath: "b.ts", content: "12345", score: 0.8 },
        { filePath: "c.ts", content: "12345", score: 0.7 },
      ],
      { maxCharacters: 10 },
    );

    expect(result).toEqual([
      { filePath: "a.ts", content: "12345", score: 0.9 },
      { filePath: "b.ts", content: "12345", score: 0.8 },
    ]);
  });
});