import { describe, expect, it } from "vitest";

import { buildRetrievalPrompt } from "../services/retrieval/promptBuilder.js";

describe("retrieval prompt builder", () => {
  it("builds prompt with context and question", () => {
    const prompt = buildRetrievalPrompt({
      context: "File: src/app.ts\nexport const app = true;",
      question: "What does this repo do?",
    });

    expect(prompt).toContain("Repository Context:");
    expect(prompt).toContain("File: src/app.ts");
    expect(prompt).toContain("Question:");
    expect(prompt).toContain("What does this repo do?");
  });
});