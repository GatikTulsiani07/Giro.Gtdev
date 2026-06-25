import { describe, expect, it } from "vitest";

import { analyzeArchitectureLayers } from "../services/repository/architectureLayerAnalysis.js";

describe("architecture layer analysis", () => {
  it("analyzes repository layers", () => {
    const result = analyzeArchitectureLayers(
      "demo/repo",
      [
        "src/routes/index.ts",
        "src/services/auth.ts",
        "src/database/user.ts",
      ],
      [],
    );

    expect(result).toBeDefined();
    expect(result.repositoryId).toBe("demo/repo");
    expect(Array.isArray(result.matches)).toBe(true);
  });
});