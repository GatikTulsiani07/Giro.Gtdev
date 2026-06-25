import { describe, expect, it } from "vitest";

import { generateArchitectureReport } from "../services/repository/architectureReportGenerator.js";

describe("architecture report generator", () => {
  it("generates markdown architecture report", () => {
    const report = generateArchitectureReport({
      repositoryId: "demo/repo",
      layers: [{ name: "routes" }, { name: "services" }],
      components: [{ name: "auth" }, { name: "repository" }],
      relations: [{ from: "routes", to: "services", type: "depends_on" }],
    } as never);

    expect(report).toContain("# Architecture Report");
    expect(report).toContain("Layers: 2");
    expect(report).toContain("Components: 2");
    expect(report).toContain("Relations: 1");
    expect(report).toContain("- routes");
    expect(report).toContain("- auth");
  });
});