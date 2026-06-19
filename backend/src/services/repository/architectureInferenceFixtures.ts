export interface ArchitectureFixture {
    repositoryId: string;
    expectedLayers: readonly string[];
    expectedComponents: readonly string[];
  }
  
  export const ARCHITECTURE_INFERENCE_FIXTURES: readonly ArchitectureFixture[] = [
    {
      repositoryId: "sample-backend",
      expectedLayers: [
        "routes",
        "services",
        "middleware",
        "config",
      ],
      expectedComponents: [
        "authentication",
        "repository",
        "retrieval",
        "indexing",
        "graph",
      ],
    },
  ];