import { describe, expect, it } from "vitest";

import {
  detectLayerViolations,
} from "./architectureLayerViolationDetector.js";

describe("architecture layer violation detector", () => {
  it("detects controller to repository violations", () => {
    const result = detectLayerViolations([
      {
        source: "userController.ts",
        target: "userRepository.ts",
      },
    ]);

    expect(result.length).toBe(1);
    expect(result[0]?.reason).toContain("Controller");
  });

  it("returns empty array when no violations exist", () => {
    const result = detectLayerViolations([
      {
        source: "userService.ts",
        target: "userRepository.ts",
      },
    ]);

    expect(result.length).toBe(0);
  });
});