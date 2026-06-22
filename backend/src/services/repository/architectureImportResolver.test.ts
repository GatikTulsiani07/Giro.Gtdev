import { describe, expect, it } from "vitest";

import { resolveArchitectureImport } from "./architectureImportResolver.js";

describe("architecture import resolver", () => {
  it("keeps external imports unchanged", () => {
    const result = resolveArchitectureImport(
      "src/routes/architecture.ts",
      "hono",
    );

    expect(result).toEqual({
      sourceFile: "src/routes/architecture.ts",
      rawImport: "hono",
      resolvedImport: "hono",
      isRelative: false,
    });
  });

  it("resolves relative imports from the source file directory", () => {
    const result = resolveArchitectureImport(
      "src/routes/architecture.ts",
      "../services/repository/architectureAnalysisFacade.js",
    );

    expect(result).toEqual({
      sourceFile: "src/routes/architecture.ts",
      rawImport: "../services/repository/architectureAnalysisFacade.js",
      resolvedImport:
        "src/services/repository/architectureAnalysisFacade.js",
      isRelative: true,
    });
  });
});