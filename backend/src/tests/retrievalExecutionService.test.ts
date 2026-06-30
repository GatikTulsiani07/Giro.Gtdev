import { describe, expect, it } from "vitest";

import { executeRetrieval } from "../services/retrieval/retrievalExecutionService.js";

describe("retrieval execution service", () => {
  it("builds a prompt from repository candidates", () => {
    const result = executeRetrieval({
      candidates: [
        {
          filePath: "src/app.ts",
          content: "export const app = true;",
          score: 0.9,
        },
      ],
      question: "What does this repository do?",
      minScore: 0.5,
      maxCandidates: 5,
      maxCharacters: 1000,
    });

    expect(result.chunkCount).toBe(1);
    expect(result.files).toEqual(["src/app.ts"]);
    expect(result.prompt).toContain("What does this repository do?");
    expect(result.prompt).toContain("export const app = true;");
  });
});