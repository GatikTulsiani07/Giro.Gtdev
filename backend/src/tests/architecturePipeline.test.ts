import { describe, expect, it } from "vitest";

import { buildArchitectureInput } from "../services/repository/architecturePipeline.js";

describe("architecture pipeline", () => {
  it("builds architecture input from repository path", () => {
    const result = buildArchitectureInput(".");

    expect(Array.isArray(result.files)).toBe(true);
    expect(Array.isArray(result.ignored)).toBe(true);
  });
});