import { describe, expect, it } from "vitest";

import { runArchitectureAnalysis } from "../services/repository/architectureRunner.js";

describe("architecture runner", () => {
  it("runs architecture analysis and returns architecture plus report", () => {
    const result = runArchitectureAnalysis("demo/repo", ".");

    expect(result).toHaveProperty("architecture");
    expect(result).toHaveProperty("report");
    expect(result.architecture).toBeDefined();
    expect(result.report).toBeDefined();
  });
});